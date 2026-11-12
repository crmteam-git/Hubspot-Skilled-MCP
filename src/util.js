// Helpers for shaping MCP tool results.
export const ok = (data) => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});

export const fail = (err) => ({
  isError: true,
  content: [{ type: "text", text: err?.message || String(err) }],
});

/** Wrap a handler so thrown errors become MCP error results instead of crashing. */
export const safe = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

/** Parse a value that may be a JSON string or an object already. */
export function parseJsonArg(value, name) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`"${name}" must be valid JSON.`);
  }
}
