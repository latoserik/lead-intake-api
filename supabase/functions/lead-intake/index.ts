/**
 * POST /lead-intake
 *
 * Accepts a contact-form submission, classifies it with an LLM, stores it in
 * Supabase and notifies a webhook when the lead is urgent.
 *
 * See README.md for the request/response contract.
 */

import { CORS_HEADERS, jsonResponse } from "./http.ts";
import { validateLeadInput } from "./validation.ts";

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
  console.log(`[${requestId}] accepted lead from ${lead.email}`);

  // Duplicate check, LLM classification, persistence and notification are
  // added in the following steps.
  return jsonResponse(501, {
    error: "not_implemented",
    message: "A feldolgozás még nincs kész.",
  });
});
