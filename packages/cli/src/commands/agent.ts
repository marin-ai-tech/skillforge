import fs from "node:fs";
import path from "node:path";
import { EXIT } from "../exit.ts";
import {
  IMPORT_RUNTIMES,
  artifactUploadPaths,
  isImportRuntime,
  isRuntimeId,
  runtimeDef,
} from "@skillforge/core";
import type { AppContext } from "../context.ts";
import { collectMcp, mcpReport, mcpRuntimes, type McpScanBody } from "../mcp-scan.ts";
import { requireClient, setExit } from "../context.ts";

const MAX_FILES = 2000;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const LIMITS_MESSAGE = "Agent directory exceeds limits (2000 files / 32 MiB)";

type Collected = {
  files: Array<{ path: string; content_base64: string }>;
  lock: unknown | null;
  /** Files of the folder that are not part of any artifact; never sent, only reported locally. */
  notSent: string[];
};

type Listed = { paths: Map<string, string>; lock: unknown | null };

/** Relative path → absolute path of every file under root, except node_modules/.git and the lock file. */
function listAgentDir(root: string): Listed | { error: string } {
  const paths = new Map<string, string>();
  // The scanner knows a Reckon skill by `.reckon/skills/<name>.md`; scanned from inside `.reckon`, the paths keep
  // that folder, as an upload of the folder in the web does (fix-reckon-agent-scan).
  const prefix = path.basename(root) === ".reckon" ? ".reckon/" : "";
  let lock: unknown | null = null;
  function walk(current: string): string | null {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    for (const ent of entries) {
      const abs = path.join(current, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        const err = walk(abs);
        if (err) return err;
      } else if (ent.isFile() && ent.name === ".skillforge-lock.json") {
        lock = readLock(abs);
      } else if (ent.isFile()) {
        paths.set(prefix + path.relative(root, abs).split(path.sep).join("/"), abs);
      }
    }
    return null;
  }
  const err = walk(root);
  return err ? { error: err } : { paths, lock };
}

function readLock(abs: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Collects an agent folder for a snapshot. Only files that form artifacts are read and sent
 * (`artifactUploadPaths`, the server scanner's rule); secrets next to them stay on the machine.
 */
function collectAgentDir(dir: string): Collected | { error: string } {
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { error: `Directory not found: ${dir}` };
  }
  const listed = listAgentDir(root);
  if ("error" in listed) return listed;
  const { upload, notSent } = artifactUploadPaths([...listed.paths.keys()]);
  if (upload.length > MAX_FILES) return { error: LIMITS_MESSAGE };
  const files: Array<{ path: string; content_base64: string }> = [];
  let total = 0;
  for (const rel of upload) {
    const buf = fs.readFileSync(listed.paths.get(rel)!);
    total += buf.byteLength;
    if (total > MAX_TOTAL_BYTES) return { error: LIMITS_MESSAGE };
    files.push({ path: rel, content_base64: buf.toString("base64") });
  }
  return { files, lock: listed.lock, notSent };
}

function formatLocal(item: { local?: { version?: string | null; digest?: string } }): string {
  const v = item.local?.version;
  if (v) return v;
  const d = item.local?.digest;
  if (d && d.length >= 12) return d.slice(0, 12);
  return "-";
}

function formatRegistry(item: { registry?: { latest_version?: string | null } | null }): string {
  return item.registry?.latest_version ?? "-";
}

function printCompare(
  ctx: AppContext,
  data: {
    summary: {
      local_only: number;
      in_sync: number;
      outdated: number;
      modified: number;
      registry_only: number;
    };
    items: Array<{
      key: string;
      status: string;
      local?: { version?: string | null; digest?: string };
      registry?: { latest_version?: string | null } | null;
    }>;
  },
): void {
  const s = data.summary;
  ctx.out.write(
    `summary: local_only=${s.local_only} in_sync=${s.in_sync} outdated=${s.outdated} modified=${s.modified} registry_only=${s.registry_only}`,
  );
  const rows = data.items.map((i) => [i.key, i.status, formatLocal(i), formatRegistry(i)]);
  ctx.out.printTable(["type/name", "status", "local", "registry"], rows);
}

/** Flags of `agent scan` that fail before anything is read: name, runtime, and `--mcp` support. */
function scanFlagsError(flags: { name?: string; runtime?: string; mcp?: boolean }): string | null {
  if (!flags.name) return "Missing --name <agent>";
  if (flags.runtime !== undefined && !isImportRuntime(flags.runtime)) {
    return `unknown runtime "${flags.runtime}"; known runtimes: ${IMPORT_RUNTIMES.join(", ")}`;
  }
  const runtime = flags.runtime ?? "claude-code";
  if (flags.mcp && !mcpRuntimes().includes(runtime)) {
    return `--mcp is not supported for runtime "${runtime}"; MCP configs are read for: ${mcpRuntimes().join(", ")}`;
  }
  return null;
}

function scanTarget(dir: string | undefined, runtime: string | undefined): string {
  if (dir && dir.length > 0) return dir;
  if (runtime && isRuntimeId(runtime)) return runtimeDef(runtime).project_dir;
  return ".claude";
}

export async function runAgentScan(
  ctx: AppContext,
  dir: string | undefined,
  flags: { name?: string; runtime?: string; mcp?: boolean },
): Promise<void> {
  const flagError = scanFlagsError(flags);
  if (flagError) {
    ctx.out.error(flagError);
    setExit(EXIT.VALIDATION);
    return;
  }
  const target = scanTarget(dir, flags.runtime);
  const collected = collectAgentDir(target);
  if ("error" in collected) {
    ctx.out.error(collected.error);
    setExit(EXIT.VALIDATION);
    return;
  }
  if (collected.files.length === 0) {
    ctx.out.error(
      `No artifact files in ${target} (skills, commands, agents, hooks); nothing was sent. ${collected.notSent.length} other file(s) stay on this machine.`,
    );
    setExit(EXIT.VALIDATION);
    return;
  }
  // MCP configs are opened only with --mcp, the consent for this run.
  const mcp = flags.mcp ? collectMcp(flags.runtime ?? "claude-code") : undefined;
  const { client } = requireClient(ctx);
  const body: Record<string, unknown> = { files: collected.files };
  if (flags.runtime) body.runtime = flags.runtime;
  if (collected.lock) body.lock = collected.lock;
  if (mcp) body.mcp = mcp;
  const res = await client.request("PUT", `/api/v1/me/agents/${encodeURIComponent(flags.name!)}`, {
    body,
  });
  if (!res.ok) {
    if (ctx.out.json) ctx.out.printJson(res.data);
    throw client.errorFromResult(res);
  }
  printScanResult(ctx, res.data, collected.notSent);
  if (mcp && !ctx.out.json) printMcp(ctx, mcp);
  setExit(EXIT.OK);
}

function printMcp(ctx: AppContext, mcp: McpScanBody): void {
  const report = mcpReport(mcp);
  ctx.out.write(report.line);
  if (report.rows.length > 0) {
    ctx.out.printTable(
      ["name", "scope", "source", "transport", "package or origin", "notes"],
      report.rows,
    );
  }
}

/** Server comparison plus the files that stayed on this machine (their paths are reported only locally). */
function printScanResult(ctx: AppContext, data: unknown, notSent: string[]): void {
  if (ctx.out.json) {
    ctx.out.printJson({ ...(data as Record<string, unknown>), not_sent: notSent });
    return;
  }
  printCompare(ctx, data as Parameters<typeof printCompare>[1]);
  if (notSent.length > 0) ctx.out.write(`not sent: ${notSent.length} file(s) outside artifacts`);
}

export async function runAgentStatus(ctx: AppContext, flags: { name?: string }): Promise<void> {
  if (!flags.name) {
    ctx.out.error("Missing --name <agent>");
    setExit(EXIT.VALIDATION);
    return;
  }
  const { client } = requireClient(ctx);
  const res = await client.request("GET", `/api/v1/me/agents/${encodeURIComponent(flags.name)}`);
  if (!res.ok) {
    if (ctx.out.json) ctx.out.printJson(res.data);
    throw client.errorFromResult(res);
  }
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    printCompare(ctx, res.data as Parameters<typeof printCompare>[1]);
  }
  setExit(EXIT.OK);
}

export async function runAgentList(ctx: AppContext): Promise<void> {
  const { client } = requireClient(ctx);
  const res = await client.request("GET", "/api/v1/me/agents");
  if (!res.ok) {
    if (ctx.out.json) ctx.out.printJson(res.data);
    throw client.errorFromResult(res);
  }
  const data = res.data as {
    items: Array<{
      name: string;
      kind: string;
      runtime: string | null;
      item_count: number;
      scanned_at: string | null;
    }>;
  };
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    const rows = data.items.map((a) => [
      a.name,
      a.kind,
      a.runtime ?? "-",
      String(a.item_count),
      a.scanned_at ?? "-",
    ]);
    ctx.out.printTable(["name", "kind", "runtime", "items", "scanned_at"], rows);
  }
  setExit(EXIT.OK);
}

export async function runAgentPublish(
  ctx: AppContext,
  spec: string,
  flags: { name?: string; version?: string; changelog?: string },
): Promise<void> {
  if (!flags.name) {
    ctx.out.error("Missing --name <agent>");
    setExit(EXIT.VALIDATION);
    return;
  }
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) {
    ctx.out.error("Expected <type>/<name>");
    setExit(EXIT.VALIDATION);
    return;
  }
  const type = spec.slice(0, slash);
  const iname = spec.slice(slash + 1);
  const { client } = requireClient(ctx);
  const body: Record<string, unknown> = {};
  if (flags.version) body.version = flags.version;
  if (flags.changelog) body.changelog = flags.changelog;
  const res = await client.request(
    "POST",
    `/api/v1/me/agents/${encodeURIComponent(flags.name)}/items/${encodeURIComponent(type)}/${encodeURIComponent(iname)}/publish`,
    { body },
  );
  if (res.status === 201) {
    const data = res.data as {
      artifact: { type: string; name: string };
      version: { version: string };
    };
    if (ctx.out.json) {
      ctx.out.printJson(res.data);
    } else {
      ctx.out.write(`${data.artifact.type}/${data.artifact.name}@${data.version.version}`);
      ctx.out.write(`${client.url}/artifacts/${data.artifact.type}/${data.artifact.name}`);
    }
    setExit(EXIT.OK);
    return;
  }
  if (ctx.out.json) ctx.out.printJson(res.data);
  throw client.errorFromResult(res);
}

export async function runAgentRm(ctx: AppContext, flags: { name?: string }): Promise<void> {
  if (!flags.name) {
    ctx.out.error("Missing --name <agent>");
    setExit(EXIT.VALIDATION);
    return;
  }
  const { client } = requireClient(ctx);
  const res = await client.request("DELETE", `/api/v1/me/agents/${encodeURIComponent(flags.name)}`);
  if (res.status === 204 || res.ok) {
    if (ctx.out.json) ctx.out.printJson({ ok: true });
    else ctx.out.write(`removed agent ${flags.name}`);
    setExit(EXIT.OK);
    return;
  }
  if (ctx.out.json) ctx.out.printJson(res.data);
  throw client.errorFromResult(res);
}
