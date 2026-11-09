import {
  AgentDeclarationError,
  isArtifactType,
  parseAgentDeclarations,
  type AgentDeclaration,
} from "@skillforge/core";
import { collectPublishFiles } from "../bundle.ts";
import { ApiError } from "../client.ts";
import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";

export type PublishFlags = {
  type?: string;
  name?: string;
  description?: string;
  version?: string;
  changelog?: string;
  provenance?: string;
  visibility?: string;
  team?: string;
  /** artifact-agent-compat: `claude-code>=2.1,codex`. */
  agents?: string;
};

type Issue = { code?: string; message?: string; path?: string; severity?: string };

function parseProvenance(
  raw: string | undefined,
): { source: string; ref: string | null } | undefined {
  if (!raw || raw.length === 0) return undefined;
  const idx = raw.indexOf(":");
  if (idx < 0) return { source: raw, ref: null };
  return { source: raw.slice(0, idx), ref: raw.slice(idx + 1) || null };
}

function printIssues(ctx: AppContext, errors: Issue[], warnings: Issue[]): void {
  for (const e of errors) {
    const code = e.code ?? "ERROR";
    const msg = e.message ?? "";
    ctx.out.write(`${code} ${msg}`.trim());
  }
  for (const w of warnings) {
    const code = w.code ?? "WARNING";
    const msg = w.message ?? "";
    ctx.out.write(`${code} ${msg}`.trim());
  }
}

function buildBody(inputPath: string, flags: PublishFlags): Record<string, unknown> {
  const files = collectPublishFiles(inputPath);
  const body: Record<string, unknown> = { files };
  if (flags.type) body.type = flags.type;
  if (flags.name) body.name = flags.name;
  if (flags.description) body.description = flags.description;
  if (flags.version) body.version = flags.version;
  if (flags.changelog) body.changelog = flags.changelog;
  const prov = parseProvenance(flags.provenance);
  if (prov) body.provenance = prov;
  if (flags.visibility) body.visibility = flags.visibility;
  if (flags.team) body.owner_team = flags.team;
  if (flags.agents !== undefined) body.agents = checkedAgents(flags);
  return body;
}

/**
 * `--agents` is checked before anything is sent: unknown agents and bad versions fail here (exit 1, as the server's
 * 400 would). Whether the type installs into each agent is checked by the server, which knows the detected type.
 */
function checkedAgents(flags: PublishFlags): AgentDeclaration[] {
  const type = flags.type && isArtifactType(flags.type) ? flags.type : "skill";
  try {
    return parseAgentDeclarations(flags.agents, type);
  } catch (e) {
    if (e instanceof AgentDeclarationError)
      throw new ApiError(`--agents: ${e.message}`, EXIT.VALIDATION);
    throw e;
  }
}

function printValidateSuccess(
  ctx: AppContext,
  data: {
    ok?: boolean;
    artifact?: { type?: string; name?: string };
    next_version?: string;
  },
  flags: PublishFlags,
  clientUrl: string,
): void {
  const type = data.artifact?.type ?? flags.type ?? "?";
  const name = data.artifact?.name ?? flags.name ?? "?";
  const ver = data.next_version ?? "?";
  ctx.out.write(`${type}/${name}@${ver}`);
  ctx.out.write(`${clientUrl}/artifacts/${type}/${name}`);
}

function printValidateHuman(
  ctx: AppContext,
  res: { ok: boolean; status: number; data: unknown },
  flags: PublishFlags,
  clientUrl: string,
): void {
  const data = (res.data ?? {}) as {
    ok?: boolean;
    errors?: Issue[];
    warnings?: Issue[];
    conflicts?: string[];
    artifact?: { type?: string; name?: string };
    next_version?: string;
  };
  printIssues(ctx, data.errors ?? [], data.warnings ?? []);
  if (data.conflicts && data.conflicts.length > 0) {
    for (const c of data.conflicts) ctx.out.write(String(c));
  }
  if (res.ok && data.ok) {
    printValidateSuccess(ctx, data, flags, clientUrl);
  }
}

function assertPublishVisibility(flags: PublishFlags): void {
  if (flags.visibility === "team" && !flags.team) {
    throw new ApiError("visibility team requires --team <name>", EXIT.VALIDATION);
  }
  if (flags.visibility && flags.visibility !== "org" && flags.visibility !== "team") {
    throw new ApiError("--visibility must be org or team", EXIT.VALIDATION);
  }
}

function printPublishFailure(ctx: AppContext, res: { data: unknown }): void {
  const data = (res.data ?? {}) as {
    error?: string;
    errors?: Issue[];
    warnings?: Issue[];
    message?: string;
  };
  printIssues(ctx, data.errors ?? [], data.warnings ?? []);
  if (data.error && data.error !== "not_owner") ctx.out.write(data.error);
  if (data.message) ctx.out.write(data.message);
}

export async function runValidate(
  ctx: AppContext,
  inputPath: string,
  flags: PublishFlags,
): Promise<void> {
  const { client } = requireClient(ctx);
  const body = buildBody(inputPath, flags);
  const res = await client.request("POST", "/api/v1/artifacts/validate", { body });

  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    printValidateHuman(ctx, res, flags, client.url);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw client.errorFromResult(res);
    const data = (res.data ?? {}) as { errors?: Issue[]; conflicts?: string[] };
    if (!ctx.out.json) printIssues(ctx, data.errors ?? [], []);
    setExit(res.status === 409 ? EXIT.CONFLICT : EXIT.VALIDATION);
    return;
  }

  const data = (res.data ?? {}) as { ok?: boolean; conflicts?: string[]; errors?: Issue[] };
  if (data.conflicts && data.conflicts.length > 0) {
    setExit(EXIT.CONFLICT);
    return;
  }
  if (data.ok === false || (data.errors && data.errors.length > 0)) {
    setExit(EXIT.VALIDATION);
    return;
  }
  setExit(EXIT.OK);
}

export async function runPublish(
  ctx: AppContext,
  inputPath: string,
  flags: PublishFlags,
): Promise<void> {
  assertPublishVisibility(flags);
  const { client } = requireClient(ctx);
  const body = buildBody(inputPath, flags);
  const res = await client.request("POST", "/api/v1/artifacts", { body });

  if (res.status === 201) {
    const data = res.data as {
      artifact: { type: string; name: string };
      version: { version: string; provenance?: unknown };
      warnings?: Issue[];
    };
    if (ctx.out.json) {
      ctx.out.printJson(res.data);
    } else {
      printIssues(ctx, [], data.warnings ?? []);
      ctx.out.write(`${data.artifact.type}/${data.artifact.name}@${data.version.version}`);
      ctx.out.write(`${client.url}/artifacts/${data.artifact.type}/${data.artifact.name}`);
    }
    setExit(EXIT.OK);
    return;
  }

  // In --json mode handleError prints the error body exactly once.
  if (!ctx.out.json) {
    printPublishFailure(ctx, res);
  }

  throw client.errorFromResult(res);
}
