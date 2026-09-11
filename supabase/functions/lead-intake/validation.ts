/**
 * Validates the request body. Collects every problem instead of stopping at
 * the first one, so the form can be fixed in one go.
 */

export interface LeadInput {
  name: string;
  email: string;
  company: string | null;
  message: string;
}

export type FieldErrorCode =
  | "missing"
  | "wrong_type"
  | "empty"
  | "too_long"
  | "invalid_format";

export interface FieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
}

export type ValidationResult =
  | { ok: true; value: LeadInput }
  | { ok: false; errors: FieldError[] };

const MAX_LENGTH = {
  name: 200,
  email: 254, // RFC 5321 maximum address length
  company: 200,
  message: 5000,
} as const;

/**
 * Catches the obviously malformed addresses. This is not RFC 5322; the only
 * real check is sending a mail to the address.
 */
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function readRequiredString(
  body: Record<string, unknown>,
  field: keyof typeof MAX_LENGTH,
  errors: FieldError[],
): string | null {
  const value = body[field];

  if (value === undefined || value === null) {
    errors.push({
      field,
      code: "missing",
      message: `A '${field}' mező kötelező.`,
    });
    return null;
  }

  if (typeof value !== "string") {
    errors.push({
      field,
      code: "wrong_type",
      message: `A '${field}' mezőnek szövegnek kell lennie.`,
    });
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    errors.push({
      field,
      code: "empty",
      message: `A '${field}' mező nem lehet üres.`,
    });
    return null;
  }

  if (trimmed.length > MAX_LENGTH[field]) {
    errors.push({
      field,
      code: "too_long",
      message: `A '${field}' mező legfeljebb ${MAX_LENGTH[field]} karakter lehet.`,
    });
    return null;
  }

  return trimmed;
}

export function validateLeadInput(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{
        field: "body",
        code: "wrong_type",
        message: "A kérés törzsének JSON objektumnak kell lennie.",
      }],
    };
  }

  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];

  const name = readRequiredString(body, "name", errors);
  const email = readRequiredString(body, "email", errors);
  const message = readRequiredString(body, "message", errors);

  // Emails are compared case-insensitively, so normalise before the format
  // check and before the uniqueness lookup.
  const normalisedEmail = email?.toLowerCase() ?? null;
  if (normalisedEmail !== null && !EMAIL_PATTERN.test(normalisedEmail)) {
    errors.push({
      field: "email",
      code: "invalid_format",
      message: "Az 'email' mező nem érvényes email cím.",
    });
  }

  // company is optional: undefined, null and "" all mean "not provided".
  let company: string | null = null;
  const rawCompany = body.company;
  if (rawCompany !== undefined && rawCompany !== null) {
    if (typeof rawCompany !== "string") {
      errors.push({
        field: "company",
        code: "wrong_type",
        message: "A 'company' mezőnek szövegnek kell lennie.",
      });
    } else if (rawCompany.trim().length > MAX_LENGTH.company) {
      errors.push({
        field: "company",
        code: "too_long",
        message: `A 'company' mező legfeljebb ${MAX_LENGTH.company} karakter lehet.`,
      });
    } else {
      company = rawCompany.trim() || null;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name: name!,
      email: normalisedEmail!,
      company,
      message: message!,
    },
  };
}
