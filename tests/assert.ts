/**
 * Minimal assertion helper.
 *
 * Deliberately dependency-free so `deno test` runs without network access.
 */
export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(
      `${message ?? "assertion failed"}\n  actual:   ${a}\n  expected: ${b}`,
    );
  }
}
