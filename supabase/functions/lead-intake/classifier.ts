/**
 * Classifies an incoming lead with the Anthropic Messages API.
 *
 * The call forces a tool use, so the model has to answer through the tool's
 * JSON schema instead of free text we would need to parse.
 *
 * We check the answer against the same rules anyway. The model is an external
 * service, so nothing it returns goes to the database unchecked.
 */

import { fetchWithTimeout } from "./http.ts";
import type { AppConfig } from "./config.ts";
import type { LeadInput } from "./validation.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "besorolas";
const MAX_ATTEMPTS = 2; // initial call + one retry
const RETRY_DELAY_MS = 500;
const MAX_SUMMARY_LENGTH = 300;

export const CATEGORIES = ["arajanlat", "hibabejelentes", "altalanos"] as const;
export const PRIORITIES = [1, 2, 3] as const;

export type Priority = typeof PRIORITIES[number];

export interface Classification {
  category: string;
  priority: Priority;
  summary: string | null;
  classified: boolean;
}

/** Used when the classification cannot be trusted, so the lead is still stored. */
export const FALLBACK_CLASSIFICATION: Classification = {
  category: "ismeretlen",
  priority: 2,
  summary: null,
  classified: false,
};

const SYSTEM_PROMPT =
  `Egy magyar cég kapcsolatfelvételi űrlapjára érkező megkereséseket sorolsz be. Mindig a ${TOOL_NAME} eszközt hívd meg.

category:
- arajanlat: a küldő árat, ajánlatot, díjszabást, együttműködést vagy megrendelést kér
- hibabejelentes: valami nem működik, hibás, leállt, reklamáció
- altalanos: minden más (érdeklődés, információkérés, állásjelentkezés, egyéb)

priority:
- 1 (sürgős): éles rendszer áll, pénzügyi kár fenyeget, határidő 24-48 órán belül, vagy a küldő kifejezetten sürget
- 2 (normál): üzletileg releváns, de nincs időnyomás
- 3 (alacsony): általános érdeklődés, ráér

summary: pontosan egy tömör magyar mondat arról, mit kér a küldő.`;

const CLASSIFICATION_TOOL = {
  name: TOOL_NAME,
  description: "A megkeresés besorolása.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES },
      priority: { type: "integer", enum: PRIORITIES },
      summary: { type: "string" },
    },
    required: ["category", "priority", "summary"],
  },
} as const;

function buildUserMessage(lead: LeadInput): string {
  const company = lead.company ? `\nCég: ${lead.company}` : "";
  return `Feladó neve: ${lead.name}${company}\n\nÜzenet:\n${lead.message}`;
}

/**
 * Checks the model's answer against the same rules as the schema. Returns null
 * if anything is off; the caller treats that as a failed attempt.
 */
export function parseClassification(payload: unknown): Classification | null {
  if (typeof payload !== "object" || payload === null) return null;

  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;

  const toolUse = content.find((block): block is { input?: unknown } =>
    typeof block === "object" && block !== null &&
    (block as { type?: unknown }).type === "tool_use" &&
    (block as { name?: unknown }).name === TOOL_NAME
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) return null;

  const input = toolUse.input as Record<string, unknown>;

  const category = input.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as typeof CATEGORIES[number])) {
    return null;
  }

  const priority = input.priority;
  if (
    typeof priority !== "number" || !Number.isInteger(priority) ||
    !PRIORITIES.includes(priority as Priority)
  ) {
    return null;
  }

  const summary = input.summary;
  if (typeof summary !== "string" || summary.trim().length === 0) return null;

  return {
    category,
    priority: priority as Priority,
    summary: summary.trim().slice(0, MAX_SUMMARY_LENGTH),
    classified: true,
  };
}

/** 401/403/400 will fail the same way on a retry; 429 and 5xx may not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Never throws: on any failure it returns FALLBACK_CLASSIFICATION so the caller
 * can store the lead anyway.
 */
export async function classifyLead(
  lead: LeadInput,
  config: AppConfig,
  requestId: string,
): Promise<Classification> {
  if (!config.anthropicApiKey) {
    console.error(`[${requestId}] ANTHROPIC_API_KEY is not set, storing lead unclassified`);
    return FALLBACK_CLASSIFICATION;
  }

  const body = JSON.stringify({
    model: config.anthropicModel,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFICATION_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: buildUserMessage(lead) }],
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": config.anthropicApiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body,
      }, config.llmTimeoutMs);

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        console.error(
          `[${requestId}] LLM attempt ${attempt} failed: HTTP ${response.status} ${detail}`,
        );
        if (!isRetryableStatus(response.status)) break;
      } else {
        const classification = parseClassification(await response.json());
        if (classification) return classification;
        console.error(`[${requestId}] LLM attempt ${attempt} returned an unusable response`);
      }
    } catch (error) {
      // Includes the AbortError raised by our own timeout.
      console.error(`[${requestId}] LLM attempt ${attempt} threw:`, error);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }

  console.error(`[${requestId}] classification failed, falling back to unclassified`);
  return FALLBACK_CLASSIFICATION;
}
