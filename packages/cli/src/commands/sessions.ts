import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ApiError } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { fetchAllArtifacts } from "./list.ts";
import { getAdapter, type SessionFact } from "../sessions/index.ts";

const BATCH = 1000;

export type SessionsImportFlags = {
  harness?: string;
  root?: string;
  since?: string;
  dryRun?: boolean;
};

function defaultRoot(): string {
  const env = process.env.SKILLFORGE_SESSIONS_ROOT;
  if (env && env.trim()) return path.resolve(env.trim());
  return path.join(os.homedir(), ".claude", "projects");
}

function resolveRoot(flags: SessionsImportFlags): string {
  if (flags.root) return path.resolve(flags.root);
  return defaultRoot();
}

type Uploaded = {
  accepted: number;
  duplicates: number;
  unknown: number;
  rejected: number;
};

function emptyUploaded(): Uploaded {
  return { accepted: 0, duplicates: 0, unknown: 0, rejected: 0 };
}

function addUploaded(a: Uploaded, b: Uploaded): Uploaded {
  return {
    accepted: a.accepted + b.accepted,
    duplicates: a.duplicates + b.duplicates,
    unknown: a.unknown + b.unknown,
    rejected: a.rejected + b.rejected,
  };
}

function requireSessionsClient(
  ctx: AppContext,
): { client: ReturnType<typeof requireClient>["client"]; token: string | undefined } | null {
  try {
    const r = requireClient(ctx);
    return { client: r.client, token: r.token };
  } catch (e) {
    if (e instanceof ApiError) {
      ctx.out.error(e.message);
      setExit(e.exitCode);
      return null;
    }
    throw e;
  }
}

function collectSessionFacts(
  files: string[],
  adapter: {
    parse: (file: string) => {
      sessions: number;
      invocations: number;
      skipped_lines: number;
      facts: SessionFact[];
    };
  },
  skillNames: Set<string>,
  sinceMs: number | null,
): {
  sessions: number;
  invocations: number;
  skipped_lines: number;
  skipped_unknown: number;
  facts: SessionFact[];
} {
  let sessions = 0;
  let invocations = 0;
  let skipped_lines = 0;
  let skipped_unknown = 0;
  const facts: SessionFact[] = [];

  for (const file of files) {
    const parsed = adapter.parse(file);
    sessions += parsed.sessions;
    invocations += parsed.invocations;
    skipped_lines += parsed.skipped_lines;
    for (const f of parsed.facts) {
      if (sinceMs !== null) {
        const t = Date.parse(f.used_at);
        if (!Number.isFinite(t) || t < sinceMs) continue;
      }
      if (!skillNames.has(f.skill)) {
        skipped_unknown++;
        continue;
      }
      facts.push({
        skill: f.skill,
        session_key: f.session_key,
        used_at: f.used_at,
        verification: f.verification,
        ...(f.basis ? { basis: f.basis } : {}),
      });
    }
  }
  return { sessions, invocations, skipped_lines, skipped_unknown, facts };
}

function printDryRun(
  ctx: AppContext,
  filesCount: number,
  collected: {
    sessions: number;
    invocations: number;
    skipped_lines: number;
    skipped_unknown: number;
    facts: SessionFact[];
  },
): void {
  const uploaded = emptyUploaded();
  if (ctx.out.json) {
    ctx.out.printJson({
      files: filesCount,
      sessions: collected.sessions,
      invocations: collected.invocations,
      facts: collected.facts,
      skipped_unknown: collected.skipped_unknown,
      skipped_lines: collected.skipped_lines,
      uploaded,
    });
  } else {
    ctx.out.write(
      `files=${filesCount} sessions=${collected.sessions} invocations=${collected.invocations} facts=${collected.facts.length} skipped_unknown=${collected.skipped_unknown} skipped_lines=${collected.skipped_lines}`,
    );
  }
}

async function uploadSessionFacts(
  client: ReturnType<typeof requireClient>["client"],
  harness: string,
  facts: SessionFact[],
): Promise<Uploaded> {
  let uploaded = emptyUploaded();
  for (let i = 0; i < facts.length; i += BATCH) {
    const batch = facts.slice(i, i + BATCH);
    const res = await client.request("POST", "/api/v1/me/session-facts", {
      body: { source: harness, facts: batch },
    });
    if (!res.ok) {
      throw client.errorFromResult(res);
    }
    const data = res.data as Uploaded;
    uploaded = addUploaded(uploaded, {
      accepted: Number(data.accepted ?? 0),
      duplicates: Number(data.duplicates ?? 0),
      unknown: Number(data.unknown ?? 0),
      rejected: Number(data.rejected ?? 0),
    });
  }
  return uploaded;
}

export async function runSessionsImport(
  ctx: AppContext,
  flags: SessionsImportFlags,
): Promise<void> {
  const harness = flags.harness ?? "claude-code";
  const adapter = getAdapter(harness);
  if (!adapter) {
    ctx.out.error(`unknown harness: ${harness}`);
    setExit(EXIT.INVALID_INPUT);
    return;
  }

  const root = resolveRoot(flags);
  if (!fs.existsSync(root)) {
    ctx.out.error(`sessions root not found: ${root}`);
    setExit(EXIT.NOT_FOUND);
    return;
  }

  const resolved = requireSessionsClient(ctx);
  if (!resolved) return;
  const { client } = resolved;

  if (!resolved.token && !client.cookie) {
    // Token may come from config via requireClient; if still missing, try a probe later on upload.
  }

  const sinceMs =
    flags.since && Number.isFinite(Date.parse(flags.since)) ? Date.parse(flags.since) : null;

  let skillNames: Set<string>;
  try {
    const arts = await fetchAllArtifacts(client, { type: "skill" });
    skillNames = new Set(arts.map((a) => a.name));
  } catch (e) {
    if (e instanceof ApiError) {
      ctx.out.error(e.message);
      setExit(e.exitCode);
      return;
    }
    throw e;
  }

  const files = adapter.findFiles(root);
  const collected = collectSessionFacts(files, adapter, skillNames, sinceMs);

  if (flags.dryRun) {
    printDryRun(ctx, files.length, collected);
    setExit(EXIT.OK);
    return;
  }

  const uploaded = await uploadSessionFacts(client, harness, collected.facts);

  // Empty facts: still success with zeros.
  const summary = {
    files: files.length,
    sessions: collected.sessions,
    invocations: collected.invocations,
    facts: collected.facts.length,
    skipped_unknown: collected.skipped_unknown,
    skipped_lines: collected.skipped_lines,
    uploaded,
  };
  if (ctx.out.json) {
    ctx.out.printJson(summary);
  } else {
    ctx.out.write(
      `files=${summary.files} sessions=${summary.sessions} facts=${summary.facts} uploaded accepted=${uploaded.accepted} duplicates=${uploaded.duplicates}`,
    );
  }
  setExit(EXIT.OK);
}
