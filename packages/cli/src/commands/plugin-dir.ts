// `skillforge plugin-dir <type>/<name>@<version>` — the Claude Code marketplace `command` source.
// Prints exactly one stdout line: the absolute path of a ready plugin directory. Everything else goes to stderr.
// Claude Code re-runs the command at every startup, so a version already unpacked is served without the network.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isArtifactType } from "@skillforge/core";
import { assertSafeRelPath, unzipBundle } from "../bundle.ts";
import { ApiError, type SkillforgeClient } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient } from "../context.ts";
import { EXIT } from "../exit.ts";

export type PluginSpec = { type: string; name: string; version: string };

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;

/** `<type>/<name>@<version>` with an exact version: every part becomes a cache path component. */
export function parsePluginSpec(spec: string): PluginSpec {
  const m = /^([^/@]+)\/([^/@]+)@([^/@]+)$/.exec(spec);
  const ok =
    m !== null &&
    isArtifactType(m[1]!) &&
    m[1] !== "settings" &&
    NAME_RE.test(m[2]!) &&
    VERSION_RE.test(m[3]!) &&
    !m[3]!.includes("..");
  if (!ok) {
    throw new ApiError(
      `expected <type>/<name>@<version> (exact version), got: ${spec}`,
      EXIT.VALIDATION,
    );
  }
  return { type: m[1]!, name: m[2]!, version: m[3]! };
}

export function pluginCacheRoot(): string {
  const fromEnv = process.env.SKILLFORGE_CACHE_DIR;
  return fromEnv && fromEnv.length > 0
    ? fromEnv
    : path.join(os.homedir(), ".skillforge", "plugins");
}

/** `<root>/<host_port>/<type>/<name>/<version>`; the readiness marker lives beside it, never inside. */
export function pluginCacheDir(registryUrl: string, spec: PluginSpec): string {
  const host = new URL(registryUrl).host.replace(/[^A-Za-z0-9.-]/g, "_");
  return path.join(pluginCacheRoot(), host, spec.type, spec.name, spec.version);
}

const markerOf = (dir: string) => `${dir}.ok`;

function isReady(dir: string): boolean {
  return (
    fs.existsSync(markerOf(dir)) && fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))
  );
}

async function downloadZip(client: SkillforgeClient, spec: PluginSpec): Promise<Uint8Array> {
  const apiPath = `/api/v1/plugins/${spec.type}/${spec.name}/${spec.version}.zip`;
  const res = await client.request("GET", apiPath, { raw: true, accept: "application/zip" });
  if (!res.ok) throw client.errorFromResult(res);
  return new Uint8Array(res.data as Buffer);
}

/** Unpack into a sibling temp dir, then rename into place: the target only ever appears complete. */
function unpackInto(dir: string, zip: Uint8Array): void {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const tmp = fs.mkdtempSync(`${dir}.tmp-`);
  try {
    for (const f of unzipBundle(zip, tmp)) {
      const dest = assertSafeRelPath(f.path, tmp);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
    }
    if (!fs.existsSync(path.join(tmp, ".claude-plugin", "plugin.json"))) {
      throw new ApiError("plugin archive has no .claude-plugin/plugin.json", EXIT.VALIDATION);
    }
    try {
      fs.renameSync(tmp, dir);
    } catch (e) {
      if (!fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) throw e; // a concurrent run won
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function runPluginDir(ctx: AppContext, rawSpec: string): Promise<void> {
  const spec = parsePluginSpec(rawSpec);
  const { client, url } = requireClient(ctx);
  const dir = pluginCacheDir(url, spec);
  if (!isReady(dir)) {
    const zip = await downloadZip(client, spec);
    unpackInto(dir, zip);
    fs.writeFileSync(markerOf(dir), `${createHash("sha256").update(zip).digest("hex")}\n`);
  }
  process.stdout.write(`${dir}\n`);
}
