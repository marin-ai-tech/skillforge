import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipBundle } from "../bundle.ts";
import { ApiError } from "../client.ts";
import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { parseTypeName } from "./info.ts";

export type SettingsApplyFlags = {
  scope?: string;
  dryRun?: boolean;
};

export type SettingsChange = {
  path: string;
  from: unknown;
  to: unknown;
};

function formatValue(v: unknown): string {
  if (v === undefined) return "(missing)";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function arrayItemKey(v: unknown): string {
  if (typeof v === "string") return `s:${v}`;
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return `p:${String(v)}`;
  return `j:${JSON.stringify(v)}`;
}

function arraysEqualItem(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  if (a === null || b === null) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeArrayValues(
  existing: unknown,
  profile: unknown[],
  pathKey: string,
  changes: SettingsChange[],
): unknown {
  const base = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(base.map(arrayItemKey));
  const merged = base.slice();
  for (const item of profile) {
    const key = arrayItemKey(item);
    if (seen.has(key)) continue;
    if (base.some((b) => arraysEqualItem(b, item))) continue;
    seen.add(key);
    merged.push(item);
  }
  if (!Array.isArray(existing) || JSON.stringify(existing) !== JSON.stringify(merged)) {
    changes.push({ path: pathKey, from: existing, to: merged });
  }
  return merged;
}

function mergeObjectValues(
  existing: unknown,
  profile: Record<string, unknown>,
  pathKey: string,
  changes: SettingsChange[],
): Record<string, unknown> {
  const src =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [k, v] of Object.entries(profile)) {
    const childPath = pathKey ? `${pathKey}.${k}` : k;
    src[k] = mergeValues(src[k], v, childPath, changes);
  }
  return src;
}

function mergeValues(
  existing: unknown,
  profile: unknown,
  pathKey: string,
  changes: SettingsChange[],
): unknown {
  if (Array.isArray(profile)) {
    return mergeArrayValues(existing, profile, pathKey, changes);
  }

  if (profile !== null && typeof profile === "object") {
    return mergeObjectValues(existing, profile as Record<string, unknown>, pathKey, changes);
  }

  // scalar (including null)
  if (!Object.is(existing, profile)) {
    changes.push({ path: pathKey, from: existing, to: profile });
  }
  return profile;
}

function mergeSettings(
  existing: Record<string, unknown>,
  profile: Record<string, unknown>,
): { merged: Record<string, unknown>; changes: SettingsChange[] } {
  const changes: SettingsChange[] = [];
  const merged = mergeValues(existing, profile, "", changes) as Record<string, unknown>;
  // Fix empty path keys from root object merge - mergeValues on objects doesn't push for the object itself
  const normalized = changes
    .filter((c) => c.path.length > 0)
    .map((c) => ({ ...c, path: c.path.replace(/^\./, "") }));
  return { merged, changes: normalized };
}

function targetPath(scope: string, cwd: string): string {
  if (scope === "user") {
    return path.join(os.homedir(), ".claude", "settings.json");
  }
  if (scope === "local") {
    return path.join(cwd, ".claude", "settings.local.json");
  }
  return path.join(cwd, ".claude", "settings.json");
}

function bakStamp(d = new Date()): string {
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return (
    `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1, 2)}${p(d.getDate(), 2)}` +
    `${p(d.getHours(), 2)}${p(d.getMinutes(), 2)}${p(d.getSeconds(), 2)}`
  );
}

function printChange(c: SettingsChange): string {
  if (c.from === undefined) {
    return `${c.path}: + ${formatValue(c.to)}`;
  }
  return `${c.path}: ${formatValue(c.from)} → ${formatValue(c.to)}`;
}

function findSettingsFile(files: { path: string; content: Buffer }[], name: string) {
  return files.find(
    (f) =>
      f.path === `settings/${name}/settings.json` ||
      f.path === "settings.json" ||
      f.path.endsWith("/settings.json"),
  );
}

function parseProfileJson(content: Buffer): Record<string, unknown> {
  try {
    const parsedJson = JSON.parse(content.toString("utf8")) as unknown;
    if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
      throw new Error("not an object");
    }
    return parsedJson as Record<string, unknown>;
  } catch {
    throw new ApiError("profile settings.json is invalid", EXIT.VALIDATION);
  }
}

function resolveWantedVersion(
  card: {
    latest: { version: string; frontmatter?: Record<string, unknown> | null } | null;
  },
  versionWanted: string | undefined,
): { version: string; scopeDefault: string } {
  let version = versionWanted;
  if (!version || version === "latest") {
    if (!card.latest?.version) {
      throw new ApiError("not found: no latest version", EXIT.NOT_FOUND, 404);
    }
    version = card.latest.version;
  }
  const scopeDefault =
    typeof card.latest?.frontmatter?.scope === "string" ? card.latest.frontmatter.scope : "project";
  return { version, scopeDefault };
}

async function fetchSettingsProfile(
  client: ReturnType<typeof requireClient>["client"],
  type: string,
  name: string,
  versionWanted: string | undefined,
): Promise<{ version: string; scopeDefault: string; profile: Record<string, unknown> }> {
  const cardRes = await client.request("GET", `/api/v1/artifacts/${type}/${name}`);
  if (!cardRes.ok) throw client.errorFromResult(cardRes);
  const card = cardRes.data as {
    artifact: { type: string; name: string };
    latest: {
      version: string;
      frontmatter?: Record<string, unknown> | null;
    } | null;
  };
  if (card.artifact.type !== "settings") {
    throw new ApiError(`not a settings profile: ${type}/${name}`, EXIT.VALIDATION);
  }

  const { version, scopeDefault } = resolveWantedVersion(card, versionWanted);

  const zipRes = await client.request(
    "GET",
    `/api/v1/artifacts/${type}/${name}/versions/${version}/bundle.zip`,
    { raw: true, accept: "application/zip" },
  );
  if (!zipRes.ok) throw client.errorFromResult(zipRes);
  const files = unzipBundle(new Uint8Array(zipRes.data as Buffer), os.tmpdir());
  const settingsFile = findSettingsFile(files, name);
  if (!settingsFile) {
    throw new ApiError("settings.json missing from profile bundle", EXIT.VALIDATION);
  }

  return {
    version,
    scopeDefault,
    profile: parseProfileJson(settingsFile.content),
  };
}

function loadExistingSettings(file: string): {
  existing: Record<string, unknown>;
  hadFile: boolean;
} {
  if (!fs.existsSync(file)) {
    return { existing: {}, hadFile: false };
  }
  const raw = fs.readFileSync(file, "utf8");
  try {
    const parsedExisting = JSON.parse(raw) as unknown;
    if (
      typeof parsedExisting !== "object" ||
      parsedExisting === null ||
      Array.isArray(parsedExisting)
    ) {
      throw new ApiError(`existing settings file is not a JSON object: ${file}`, EXIT.VALIDATION);
    }
    return { existing: parsedExisting as Record<string, unknown>, hadFile: true };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(`existing settings file is not valid JSON: ${file}`, EXIT.VALIDATION);
  }
}

function writeMergedSettings(
  file: string,
  merged: Record<string, unknown>,
  hadFile: boolean,
): string | null {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup: string | null = null;
  if (hadFile) {
    backup = `${file}.bak-${bakStamp()}`;
    fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return backup;
}

function printSettingsApply(
  ctx: AppContext,
  name: string,
  version: string,
  file: string,
  changes: SettingsChange[],
  backup: string | null,
  dryRun: boolean,
): void {
  if (ctx.out.json) {
    ctx.out.printJson({
      file,
      changes: changes.map((c) => ({ path: c.path, from: c.from ?? null, to: c.to })),
      backup,
      dry_run: dryRun,
    });
    return;
  }
  ctx.out.write(`Applying settings/${name}@${version} → ${file}${dryRun ? " (dry-run)" : ""}`);
  for (const c of changes) {
    ctx.out.write(printChange(c));
  }
  if (backup) ctx.out.write(`Backup: ${backup}`);
  ctx.out.write("Restart Claude Code for changes to take effect.");
}

export async function runSettingsApply(
  ctx: AppContext,
  spec: string,
  flags: SettingsApplyFlags,
): Promise<void> {
  const { client } = requireClient(ctx);
  const parsed = parseTypeName(spec);
  const { type, name, version: versionWanted } = parsed;

  if (type !== "settings") {
    throw new ApiError(
      `settings apply requires a settings/<name> artifact, got ${type}/${name}`,
      EXIT.VALIDATION,
    );
  }

  const { version, scopeDefault, profile } = await fetchSettingsProfile(
    client,
    type,
    name,
    versionWanted,
  );

  const scopeRaw = flags.scope ?? scopeDefault;
  if (!["user", "project", "local"].includes(scopeRaw)) {
    throw new ApiError(`invalid --scope: ${scopeRaw}`, EXIT.VALIDATION);
  }
  const scope = scopeRaw as "user" | "project" | "local";

  const file = targetPath(scope, process.cwd());
  const { existing, hadFile } = loadExistingSettings(file);

  const { merged, changes } = mergeSettings(existing, profile);
  const dryRun = Boolean(flags.dryRun);
  let backup: string | null = null;

  if (!dryRun) {
    backup = writeMergedSettings(file, merged, hadFile);
  }

  printSettingsApply(ctx, name, version, file, changes, backup, dryRun);
  setExit(EXIT.OK);
}
