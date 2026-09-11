/**
 * Database access.
 *
 * The client uses the service_role key, which bypasses RLS. The leads table
 * has RLS on with no policies and no grants for anon / authenticated, so this
 * is the only way to reach it.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AppConfig } from "./config.ts";
import type { LeadInput } from "./validation.ts";
import type { Classification } from "./classifier.ts";

/** PostgreSQL error code for a unique constraint violation. */
export const UNIQUE_VIOLATION = "23505";

export function createDbClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Checks whether this email is already in the table.
 *
 * If the lookup itself fails the caller carries on: the unique constraint on
 * leads.email catches duplicates anyway. This query only saves an LLM call.
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

/** The subset of the row returned to the caller on success. */
export interface StoredLead {
  id: string;
  category: string;
  priority: number;
  summary: string | null;
  classified: boolean;
  created_at: string;
}

/** Raised when the unique constraint on leads.email rejects the insert. */
export class DuplicateEmailError extends Error {
  constructor() {
    super("a lead with this email already exists");
    this.name = "DuplicateEmailError";
  }
}

/**
 * Stores the lead. The unique index on leads.email catches duplicates that the
 * pre-check above can miss when two requests arrive at the same time.
 */
export async function insertLead(
  client: SupabaseClient,
  lead: LeadInput,
  classification: Classification,
  timeoutMs: number,
): Promise<StoredLead> {
  const { data, error } = await client
    .from("leads")
    .insert({
      name: lead.name,
      email: lead.email,
      company: lead.company,
      message: lead.message,
      category: classification.category,
      priority: classification.priority,
      summary: classification.summary,
      classified: classification.classified,
    })
    .select("id, category, priority, summary, classified, created_at")
    // abortSignal must come before single(): single() narrows the builder to a
    // type that no longer exposes it.
    .abortSignal(AbortSignal.timeout(timeoutMs))
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new DuplicateEmailError();
    throw new Error(`lead insert failed (${error.code ?? "unknown"}): ${error.message}`);
  }

  return data as StoredLead;
}
