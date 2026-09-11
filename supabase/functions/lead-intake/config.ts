/**
 * Reads the environment variables.
 *
 * Only the Supabase credentials are required. Without the Anthropic key or the
 * webhook URL the function still answers: the lead gets stored, just
 * unclassified or without a notification.
 */

export interface AppConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  webhookUrl: string | null;
  llmTimeoutMs: number;
  webhookTimeoutMs: number;
  dbTimeoutMs: number;
}

export class MissingConfigError extends Error {
  constructor(public readonly variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingConfigError";
  }
}

/** Small and cheap; this classification does not need a bigger model. */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new MissingConfigError(name);
  return value;
}

function optionalEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value : null;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    anthropicApiKey: optionalEnv("ANTHROPIC_API_KEY"),
    anthropicModel: optionalEnv("ANTHROPIC_MODEL") ?? DEFAULT_MODEL,
    webhookUrl: optionalEnv("WEBHOOK_URL"),
    llmTimeoutMs: positiveIntEnv("LLM_TIMEOUT_MS", 10_000),
    webhookTimeoutMs: positiveIntEnv("WEBHOOK_TIMEOUT_MS", 5_000),
    dbTimeoutMs: positiveIntEnv("DB_TIMEOUT_MS", 5_000),
  };
}
