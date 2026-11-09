// Files of a plugin archive (tar.gz and zip): the version's canonical files plus the generated
// `.claude-plugin/plugin.json`. Shared by the archive route and marketplace.json (zip sha256).
import { createHash } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import type { AppConfig } from "../config.ts";
import { hasBlob, readBlob } from "../blobs.ts";
import { compareTarPaths, normalizeTarPath } from "./tar.ts";
import { buildPluginJson } from "./plugin.ts";

export type ArchiveEntry = { path: string; content: Uint8Array };
type ArtifactPart = Parameters<typeof buildPluginJson>[0];
type VersionPart = Parameters<typeof buildPluginJson>[1] & {
  files: Array<{ path: string; sha256: string }>;
};
type GeneratedPluginJson = ReturnType<typeof buildPluginJson>;

export const PLUGIN_JSON_PATH = ".claude-plugin/plugin.json";

/** DOS time starts in 1980; a fixed local date keeps zip bytes independent of build time and time zone. */
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function blobOf(dataDir: string, f: { path: string; sha256: string }): Uint8Array {
  if (!hasBlob(dataDir, f.sha256)) {
    throw new Error(`missing blob ${f.sha256} for ${f.path}`);
  }
  return readBlob(dataDir, f.sha256);
}

/** Author's plugin.json with the registry-owned fields (name, version, ...) taking precedence. */
function mergePluginJson(content: Uint8Array, generated: GeneratedPluginJson) {
  let original: Record<string, unknown> = {};
  try {
    original = JSON.parse(new TextDecoder().decode(content)) as Record<string, unknown>;
  } catch {
    original = {};
  }
  const meta = original.metadata;
  return {
    ...original,
    name: generated.name,
    version: generated.version,
    description: generated.description || (original.description as string) || "",
    metadata: {
      ...(typeof meta === "object" && meta !== null && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : {}),
      ...generated.metadata,
    },
  };
}

/** The archive's `.claude-plugin/plugin.json`: generated, or the plugin's own manifest merged with it. */
export function pluginManifest(
  dataDir: string,
  row: ArtifactPart,
  detail: VersionPart,
  config: AppConfig,
): Uint8Array {
  const generated = buildPluginJson(row, detail, config);
  const own =
    row.type === "plugin" ? detail.files.find((f) => f.path === PLUGIN_JSON_PATH) : undefined;
  if (!own) return encodeJson(generated);
  return encodeJson(mergePluginJson(blobOf(dataDir, own), generated));
}

/** Canonical files of the version plus the manifest, paths from the plugin root. */
export function pluginArchiveEntries(
  dataDir: string,
  row: ArtifactPart,
  detail: VersionPart,
  config: AppConfig,
): ArchiveEntry[] {
  const entries = detail.files
    .filter((f) => f.path !== PLUGIN_JSON_PATH)
    .map((f) => ({ path: f.path, content: blobOf(dataDir, f) }));
  entries.push({ path: PLUGIN_JSON_PATH, content: pluginManifest(dataDir, row, detail, config) });
  return entries;
}

/** Deterministic zip: canonical path order, fixed entry time, level 6, plugin root at the archive root. */
export function buildPluginZip(entries: ArchiveEntry[]): Uint8Array {
  const files: Zippable = {};
  for (const e of entries.slice().sort((a, b) => compareTarPaths(a.path, b.path))) {
    files[normalizeTarPath(e.path)] = [e.content, { mtime: ZIP_MTIME }];
  }
  return zipSync(files, { level: 6 });
}

const zipShaMemo = new Map<string, string>();
const ZIP_SHA_MEMO_MAX = 5000;

/**
 * sha256 of the zip the archive route serves. The zip is a function of the version's files (bundle
 * digest) and the manifest, so the pair keys a memo and marketplace.json does not rebuild archives.
 */
export function pluginZipSha256(
  dataDir: string,
  row: ArtifactPart,
  detail: VersionPart & { digest: string },
  config: AppConfig,
): string {
  const manifest = pluginManifest(dataDir, row, detail, config);
  const manifestSha = createHash("sha256").update(manifest).digest("hex");
  const key = `${row.type}/${row.name}@${detail.version}|${detail.digest}|${manifestSha}`;
  const hit = zipShaMemo.get(key);
  if (hit) return hit;
  const zip = buildPluginZip(pluginArchiveEntries(dataDir, row, detail, config));
  const sha = createHash("sha256").update(zip).digest("hex");
  if (zipShaMemo.size >= ZIP_SHA_MEMO_MAX) zipShaMemo.clear();
  zipShaMemo.set(key, sha);
  return sha;
}
