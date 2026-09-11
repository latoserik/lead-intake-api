import { assertEquals } from "./assert.ts";
import { parseClassification } from "../supabase/functions/lead-intake/classifier.ts";

/** Shapes a minimal Anthropic Messages API response around a tool_use block. */
function apiResponse(input: unknown, name = "besorolas") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "toolu_1", name, input }],
  };
}

Deno.test("parses a well-formed tool call", () => {
  const result = parseClassification(apiResponse({
    category: "hibabejelentes",
    priority: 1,
    summary: "  A fizetési oldal hibát dob.  ",
  }));

  assertEquals(result, {
    category: "hibabejelentes",
    priority: 1,
    summary: "A fizetési oldal hibát dob.",
    classified: true,
  });
});

Deno.test("truncates an over-long summary", () => {
  const result = parseClassification(apiResponse({
    category: "altalanos",
    priority: 3,
    summary: "a".repeat(500),
  }));
  assertEquals(result?.summary?.length, 300);
});

Deno.test("rejects a category outside the allowed set", () => {
  for (const category of ["egyeb", "ARAJANLAT", "", "ismeretlen", 1]) {
    assertEquals(
      parseClassification(apiResponse({ category, priority: 2, summary: "x" })),
      null,
      `category=${JSON.stringify(category)}`,
    );
  }
});

Deno.test("rejects a priority outside 1-3", () => {
  for (const priority of [0, 4, 2.5, "1", null, true]) {
    assertEquals(
      parseClassification(apiResponse({ category: "altalanos", priority, summary: "x" })),
      null,
      `priority=${JSON.stringify(priority)}`,
    );
  }
});

Deno.test("rejects a missing or blank summary", () => {
  for (const summary of [undefined, null, "", "   ", 42]) {
    assertEquals(
      parseClassification(apiResponse({ category: "altalanos", priority: 2, summary })),
      null,
      `summary=${JSON.stringify(summary)}`,
    );
  }
});

Deno.test("rejects a plain text answer with no tool call", () => {
  assertEquals(
    parseClassification({
      content: [{ type: "text", text: '{"category":"altalanos","priority":2,"summary":"x"}' }],
    }),
    null,
  );
});

Deno.test("rejects a tool call with an unexpected name", () => {
  assertEquals(
    parseClassification(
      apiResponse({ category: "altalanos", priority: 2, summary: "x" }, "valami_mas"),
    ),
    null,
  );
});

Deno.test("rejects malformed payloads", () => {
  for (const payload of [null, undefined, "szoveg", 42, [], {}, { content: "nem tomb" }]) {
    assertEquals(parseClassification(payload), null, JSON.stringify(payload));
  }
});

Deno.test("rejects an error response body", () => {
  assertEquals(
    parseClassification({ type: "error", error: { type: "overloaded_error", message: "..." } }),
    null,
  );
});
