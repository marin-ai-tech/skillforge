/**
 * One rule for a boolean query flag on every route: `true` and `1` are yes; `false`, `0` and an empty value are no;
 * an absent flag takes the fallback. Anything else (another case, `yes`, an array from a repeated parameter) is
 * malformed: null, and the route answers 400 `bad_request`.
 */
export function parseQueryFlag(raw: unknown, fallback = false): boolean | null {
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0" || raw === "") return false;
  return null;
}
