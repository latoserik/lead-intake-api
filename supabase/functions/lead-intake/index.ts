/**
 * POST /lead-intake
 *
 * Accepts a contact-form submission, classifies it with an LLM, stores it in
 * Supabase and notifies a webhook when the lead is urgent.
 *
 * See README.md for the request/response contract.
 */

import { CORS_HEADERS, jsonResponse } from "./http.ts";
import { loadConfig, MissingConfigError } from "./config.ts";
import { validateLeadInput } from "./validation.ts";
import { createDbClient, emailAlreadyExists } from "./repository.ts";

/** Guard against absurdly large bodies before parsing them. */
const MAX_BODY_BYTES = 64 * 1024;

Deno.serve(async (req: Request): Promise<Response> => {
  // Correlates every log line of a single request.
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, {
      error: "method_not_allowed",
      message: "A végpont csak POST kérést fogad.",
    });
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Misconfiguration is our fault, not the caller's: log it and answer with
    // a 500 that does not leak which variable is missing.
    console.error(`[${requestId}] configuration error:`, error);
    if (error instanceof MissingConfigError) {
      return jsonResponse(500, {
        error: "server_misconfigured",
        message: "A szolgáltatás nincs megfelelően konfigurálva.",
      });
    }
    throw error;
  }

  const contentLength = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, {
      error: "payload_too_large",
      message: `A kérés törzse legfeljebb ${MAX_BODY_BYTES} bájt lehet.`,
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, {
      error: "invalid_json",
      message: "A kérés törzse nem érvényes JSON.",
    });
  }

  const validation = validateLeadInput(rawBody);
  if (!validation.ok) {
    return jsonResponse(400, {
      error: "validation_failed",
      message: "A kérés érvénytelen mezőket tartalmaz.",
      fields: validation.errors,
    });
  }

  const lead = validation.value;
  const db = createDbClient(config);

  // Cheap pre-check: an obvious duplicate should not cost us an LLM call.
  // If the lookup itself fails we carry on - the unique constraint on
  // leads.email is the authoritative check and is handled at insert time.
  try {
    if (await emailAlreadyExists(db, lead.email, config.dbTimeoutMs)) {
      return jsonResponse(409, {
        error: "duplicate_email",
        message: "Ezzel az email címmel már érkezett megkeresés.",
        field: "email",
      });
    }
  } catch (error) {
    console.warn(`[${requestId}] duplicate pre-check failed, continuing:`, error);
  }

  console.log(`[${requestId}] accepted lead from ${lead.email}`);

  // LLM classification, persistence and notification are added next.
  return jsonResponse(501, {
    error: "not_implemented",
    message: "A feldolgozás még nincs kész.",
  });
});
