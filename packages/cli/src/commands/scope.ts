import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { ApiError } from "../client.ts";
import { parseTypeName } from "./info.ts";

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.VALIDATION);
}

function parseSpec(spec: string): { type: string; name: string } {
  try {
    const ref = parseTypeName(spec);
    return { type: ref.type, name: ref.name };
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
}

export async function runScope(
  ctx: AppContext,
  spec: string,
  opts: { visibility?: string; team?: string; reason?: string },
): Promise<void> {
  const { type, name } = parseSpec(spec);
  const visibility = opts.visibility;
  if (visibility !== "org" && visibility !== "team") {
    throw invalid("--visibility must be org or team");
  }
  if (visibility === "team" && !opts.team) {
    throw invalid("visibility team requires --team <name>");
  }
  const body: Record<string, unknown> = { visibility };
  if (visibility === "team") body.owner_team = opts.team;
  else body.owner_team = null;
  if (opts.reason) body.reason = opts.reason;

  const { client } = requireClient(ctx);
  const res = await client.request(
    "PUT",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/scope`,
    { body },
  );
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else {
    const data = res.data as { visibility: string; owner_team: string | null };
    ctx.out.write(data.visibility === "team" ? `scope team · ${data.owner_team}` : "scope org");
  }
  setExit(EXIT.OK);
}

export async function runLabelsSet(
  ctx: AppContext,
  spec: string,
  labelsCsv: string,
): Promise<void> {
  const { type, name } = parseSpec(spec);
  if (labelsCsv === undefined) throw invalid("labels list is required");
  const labels =
    labelsCsv.trim() === ""
      ? []
      : labelsCsv
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
  const { client } = requireClient(ctx);
  const res = await client.request(
    "PUT",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/labels`,
    { body: { labels } },
  );
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else {
    const data = res.data as { labels: string[] };
    ctx.out.write(data.labels.length ? data.labels.join(", ") : "(no labels)");
  }
  setExit(EXIT.OK);
}
