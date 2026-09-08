import { assertEquals } from "./assert.ts";
import { validateLeadInput } from "../supabase/functions/lead-intake/validation.ts";

function errorCodes(raw: unknown): string[] {
  const result = validateLeadInput(raw);
  if (result.ok) return [];
  return result.errors.map((e) => `${e.field}:${e.code}`).sort();
}

Deno.test("accepts a valid payload and normalises it", () => {
  const result = validateLeadInput({
    name: "  Kovács Anna  ",
    email: "  Anna.Kovacs@Example.COM ",
    company: "  Acme Kft.  ",
    message: " Kérnék egy árajánlatot. ",
  });

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.name, "Kovács Anna");
  assertEquals(result.value.email, "anna.kovacs@example.com");
  assertEquals(result.value.company, "Acme Kft.");
  assertEquals(result.value.message, "Kérnék egy árajánlatot.");
});

Deno.test("company is optional and normalises to null", () => {
  for (const company of [undefined, null, "", "   "]) {
    const result = validateLeadInput({
      name: "A",
      email: "a@b.hu",
      message: "Szia",
      ...(company === undefined ? {} : { company }),
    });
    assertEquals(result.ok, true, `company=${JSON.stringify(company)}`);
    if (result.ok) assertEquals(result.value.company, null);
  }
});

Deno.test("reports every missing required field at once", () => {
  assertEquals(errorCodes({}), ["email:missing", "message:missing", "name:missing"]);
});

Deno.test("rejects wrong types", () => {
  assertEquals(
    errorCodes({ name: 42, email: "a@b.hu", message: "x", company: 7 }),
    ["company:wrong_type", "name:wrong_type"],
  );
});

Deno.test("rejects blank required fields", () => {
  assertEquals(
    errorCodes({ name: "   ", email: "a@b.hu", message: "\n\t " }),
    ["message:empty", "name:empty"],
  );
});

Deno.test("rejects malformed email addresses", () => {
  const invalid = ["nincs-kukac", "a@b", "a@@b.hu", "a b@c.hu", "@b.hu", "a@.hu", "a@b."];
  for (const email of invalid) {
    assertEquals(
      errorCodes({ name: "A", email, message: "x" }),
      ["email:invalid_format"],
      `expected ${email} to be rejected`,
    );
  }
});

Deno.test("accepts realistic email addresses", () => {
  const valid = ["a@b.hu", "anna.kovacs+lead@sub.example.co.uk", "x_y-z%1@example-site.com"];
  for (const email of valid) {
    assertEquals(errorCodes({ name: "A", email, message: "x" }), [], `expected ${email} to pass`);
  }
});

Deno.test("enforces maximum field lengths", () => {
  assertEquals(
    errorCodes({ name: "a".repeat(201), email: "a@b.hu", message: "b".repeat(5001) }),
    ["message:too_long", "name:too_long"],
  );
});

Deno.test("rejects a body that is not a JSON object", () => {
  assertEquals(errorCodes([]), ["body:wrong_type"]);
  assertEquals(errorCodes("szoveg"), ["body:wrong_type"]);
  assertEquals(errorCodes(null), ["body:wrong_type"]);
});
