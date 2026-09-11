/**
 * Urgent-lead notification.
 *
 * Fire-and-report-only: a webhook failure must never fail the request. The
 * lead is already stored by the time this runs; the notification is a
 * convenience, not part of the contract with the caller.
 *
 * The payload is shaped for a Discord webhook. Swapping to Slack or Make.com
 * means rewriting buildPayload() and nothing else.
 */

import { fetchWithTimeout } from "./http.ts";
import type { AppConfig } from "./config.ts";
import type { LeadInput } from "./validation.ts";
import type { StoredLead } from "./repository.ts";

/** Discord caps an embed field value at 1024 characters. */
const MAX_FIELD_LENGTH = 1000;
const DISCORD_RED = 0xED4245;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function buildPayload(lead: LeadInput, stored: StoredLead): unknown {
  const title = lead.company ? `${lead.name} — ${lead.company}` : lead.name;

  return {
    username: "Lead Intake",
    content: "🚨 **Sürgős lead érkezett**",
    embeds: [{
      title,
      description: stored.summary ?? "_Nincs összefoglaló (az osztályozás nem sikerült)._",
      color: DISCORD_RED,
      timestamp: stored.created_at,
      fields: [
        { name: "Email", value: lead.email, inline: true },
        { name: "Kategória", value: stored.category, inline: true },
        { name: "Prioritás", value: `${stored.priority} (sürgős)`, inline: true },
        { name: "Üzenet", value: truncate(lead.message, MAX_FIELD_LENGTH) },
        { name: "Lead azonosító", value: stored.id },
      ],
    }],
  };
}

/**
 * Sends the notification. Never throws: every failure is logged and swallowed.
 */
export async function notifyUrgentLead(
  lead: LeadInput,
  stored: StoredLead,
  config: AppConfig,
  requestId: string,
): Promise<void> {
  if (!config.webhookUrl) {
    console.warn(`[${requestId}] WEBHOOK_URL is not set, skipping urgent notification`);
    return;
  }

  try {
    const response = await fetchWithTimeout(config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildPayload(lead, stored)),
    }, config.webhookTimeoutMs);

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      console.error(
        `[${requestId}] webhook returned HTTP ${response.status}: ${detail}`,
      );
      return;
    }

    console.log(`[${requestId}] urgent notification sent for lead ${stored.id}`);
  } catch (error) {
    // Includes the AbortError raised by our own timeout.
    console.error(`[${requestId}] webhook call failed:`, error);
  }
}
