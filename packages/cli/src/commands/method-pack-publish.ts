import { readFileSync, statSync } from "node:fs";
import { ApiError } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";

/**
 * `skillforge pack publish <file> [--dry-run]` and `skillforge pack show <name>[@version]` (pack-authoring): a method
 * pack is published or only checked from a JSON file with the pack body, and shown with who published it.
 */
const MAX_FILE = 256 * 1024;

type MethodPackProblem = {
  role: string | null;
  type?: string;
  name?: string;
  version?: string;
  code: string;
  message: string;
};

type MethodPackVersionView = {
  version: string;
  title: string;
  description?: string;
  published_by: string;
  published_at: string;
  roles: Array<{
    name: string;
    description?: string;
    items: Array<{ type: string; name: string; version: string }>;
  }>;
};

const invalid = (message: string) => new ApiError(message, EXIT.VALIDATION);

function readPackFile(file: string): Record<string, unknown> {
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw invalid(`not a file: ${file}`);
    size = st.size;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw invalid(`file not found: ${file}`);
  }
  if (size > MAX_FILE) throw invalid(`file exceeds 256 KiB: ${file}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw invalid("file is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw invalid("the file must hold a JSON object");
  return parsed as Record<string, unknown>;
}

function problemLine(p: MethodPackProblem): string {
  if (p.role === null) return `pack: ${p.code} — ${p.message}`;
  return `${p.role} ${p.type}/${p.name}@${p.version}: ${p.code} — ${p.message}`;
}

function printProblems(ctx: AppContext, problems: MethodPackProblem[]): void {
  for (const p of problems) ctx.out.write(problemLine(p));
}

/** Problems of a check (200 with ok=false) or of a publish refusal (422); none for a success. */
function problemsOf(ok: boolean, raw: unknown): MethodPackProblem[] {
  const data = (raw ?? {}) as { ok?: boolean; problems?: MethodPackProblem[] };
  if (ok && data.ok !== false) return [];
  return data.problems ?? [];
}

export async function runMethodPackPublish(
  ctx: AppContext,
  file: string,
  flags: { dryRun?: boolean },
): Promise<void> {
  const body = readPackFile(file);
  if (typeof body.name !== "string" || typeof body.version !== "string")
    throw invalid("the file needs name and version");
  const label = `${body.name}@${body.version}`;
  const { client } = requireClient(ctx);
  const res = await client.request("POST", flags.dryRun ? "/api/v1/packs/check" : "/api/v1/packs", {
    body,
  });
  const problems = problemsOf(res.ok, res.data);
  if (!res.ok && problems.length === 0) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else if (problems.length > 0) printProblems(ctx, problems);
  else ctx.out.write(flags.dryRun ? `Pack ${label}: ok` : `Published pack ${label}`);
  setExit(problems.length > 0 ? EXIT.VALIDATION : EXIT.OK);
}

function splitSpec(spec: string): { name: string; version: string | null } {
  const [name = "", version] = spec.split("@");
  return { name, version: version ?? null };
}

export async function runMethodPackShow(ctx: AppContext, spec: string): Promise<void> {
  const { client } = requireClient(ctx);
  const { name, version } = splitSpec(spec);
  const res = await client.request("GET", `/api/v1/packs/${encodeURIComponent(name)}`);
  if (!res.ok) throw client.errorFromResult(res);
  const pack = (
    res.data as { pack: { name: string; owner: string }; latest: MethodPackVersionView | null }
  ).pack;
  let view = (res.data as { latest: MethodPackVersionView | null }).latest;
  if (version) {
    const vr = await client.request(
      "GET",
      `/api/v1/packs/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
    );
    if (!vr.ok) throw client.errorFromResult(vr);
    view = (vr.data as { version: MethodPackVersionView }).version;
  }
  if (!view) throw new ApiError(`pack ${name} has no published version`, EXIT.NOT_FOUND);
  if (ctx.out.json) {
    ctx.out.printJson({ name: pack.name, owner: pack.owner, ...view });
  } else {
    ctx.out.write(`${view.title} (${pack.name}@${view.version})`);
    ctx.out.write(
      `owner: ${pack.owner} · published by ${view.published_by} at ${view.published_at}`,
    );
    for (const role of view.roles) {
      ctx.out.write(
        `role ${role.name}: ${role.items.map((i) => `${i.type}/${i.name}@${i.version}`).join(", ")}`,
      );
    }
  }
  setExit(EXIT.OK);
}
