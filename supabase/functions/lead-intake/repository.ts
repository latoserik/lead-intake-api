/**
 * Database access.
 *
 * The client is built with the service_role key, which bypasses RLS. The
 * `leads` table has RLS enabled with no policies and no grants for anon /
 * authenticated, so this is the only way in.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AppConfig } from "./config.ts";

/** PostgreSQL error code for a unique constraint violation. */
export const UNIQUE_VIOLATION = "23505";

export function createDbClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Tells whether a lead with this email was already recorded.
 *
 * The caller treats a failure here as "unknown" rather than as an error: the
 * unique constraint on `leads.email` is the authoritative check, this lookup
 * only saves us an LLM call on an obvious duplicate.
 */
export async function emailAlreadyExists(
  client: SupabaseClient,
  email: string,
  timeoutMs: number,
): Promise<boolean> {
  const { data, error } = await client
    .from("leads")
    .select("id")
    .eq("email", email)
    .limit(1)
    .abortSignal(AbortSignal.timeout(timeoutMs));

  if (error) {
    throw new Error(`duplicate lookup failed: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}
