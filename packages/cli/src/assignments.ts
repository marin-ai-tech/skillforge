import type { SkillforgeClient } from "./client.ts";

/** team-availability: what the user's teams require, install by default, or keep unavailable. */
export type Assignments = {
  required: Array<{ type: string; name: string; team: string }>;
  default: Array<{ type: string; name: string; team: string }>;
  unavailable: Array<{ type: string; name: string; team: string }>;
};

const NONE: Assignments = { required: [], default: [], unavailable: [] };

/** Empty for an older registry or an anonymous client: availability only adds to what a user chose. */
export async function fetchAssignments(client: SkillforgeClient): Promise<Assignments> {
  const res = await client.request("GET", "/api/v1/me/assignments");
  return res.ok ? (res.data as Assignments) : NONE;
}

export const keyOf = (a: { type: string; name: string }) => `${a.type}/${a.name}`;
