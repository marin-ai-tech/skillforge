import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";

export type ListFlags = {
  type?: string;
  status?: string;
  tag?: string;
  limit?: string;
  q?: string;
  team?: string;
  owner?: string;
  label?: string;
  visibility?: string;
};

type ArtifactSummary = {
  type: string;
  name: string;
  description: string;
  status: string;
  latest_version: string | null;
  download_count?: number;
  tags?: string[];
};

function qs(flags: ListFlags & { offset?: number; q?: string }): string {
  const p = new URLSearchParams();
  if (flags.type) p.set("type", flags.type);
  if (flags.status) p.set("status", flags.status);
  if (flags.tag) p.set("tag", flags.tag);
  if (flags.team) p.set("team", flags.team);
  if (flags.owner) p.set("owner", flags.owner);
  if (flags.label) p.set("label", flags.label);
  if (flags.visibility) p.set("visibility", flags.visibility);
  if (flags.q) p.set("q", flags.q);
  if (flags.limit) p.set("limit", flags.limit);
  if (flags.offset !== undefined) p.set("offset", String(flags.offset));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function runList(ctx: AppContext, flags: ListFlags): Promise<void> {
  const { client } = requireClient(ctx);
  const res = await client.request("GET", `/api/v1/artifacts${qs(flags)}`);
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { items: ArtifactSummary[]; total: number };

  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    const rows = data.items.map((a) => [
      a.type,
      a.name,
      a.latest_version ?? "-",
      a.status,
      (a.description ?? "").slice(0, 60),
    ]);
    ctx.out.printTable(["type", "name", "version", "status", "description"], rows);
  }
  setExit(EXIT.OK);
}

export async function runSearch(ctx: AppContext, query: string, flags: ListFlags): Promise<void> {
  return runList(ctx, { ...flags, q: query });
}

export async function fetchAllArtifacts(
  client: import("../client.ts").SkillforgeClient,
  flags: ListFlags,
): Promise<ArtifactSummary[]> {
  const limit = 200;
  let offset = 0;
  const items: ArtifactSummary[] = [];
  for (;;) {
    const res = await client.request(
      "GET",
      `/api/v1/artifacts${qs({ ...flags, limit: String(limit), offset })}`,
    );
    if (!res.ok) throw client.errorFromResult(res);
    const data = res.data as { items: ArtifactSummary[]; total: number };
    items.push(...data.items);
    offset += data.items.length;
    if (offset >= data.total || data.items.length === 0) break;
  }
  return items;
}
