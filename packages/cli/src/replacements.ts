import type { SkillforgeClient } from "./client.ts";

/** artifact-replacement: successors of the given installed keys, as old key -> new key. */
export async function successorsOf(
  client: SkillforgeClient,
  keys: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const key of keys) {
    const res = await client.request("GET", `/api/v1/artifacts/${key}`);
    const next = res.ok
      ? (res.data as { artifact?: { replaced_by?: string | null } }).artifact?.replaced_by
      : null;
    if (next) out.set(key, next);
  }
  return out;
}
