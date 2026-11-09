import { ISSUE_CODES } from "./types.ts";
import type { Issue, ParseInput } from "./types.ts";
import type { NormalizedFile } from "./paths.ts";
import { toUint8Array } from "./paths.ts";
import { contentToString, extractFrontmatter } from "./frontmatter.ts";
import { validateName, resolveDescription, checkInputName, type TypeParseOk } from "./skill.ts";
import { compareUtf8Paths } from "../digest.ts";

const SETTINGS_MD = "SETTINGS.md";
const SETTINGS_JSON = "settings.json";

// Snapshot of Claude Code settings.json keys; update when Claude Code adds keys.
export const KNOWN_SETTINGS_KEYS_AS_OF = "2026-09-22";

export const KNOWN_SETTINGS_KEYS = new Set([
  "permissions",
  "env",
  "model",
  "hooks",
  "apiKeyHelper",
  "statusLine",
  "includeCoAuthoredBy",
  "forceLoginMethod",
  "cleanupPeriodDays",
  "preferredNotifChannel",
  "awsAuthRefresh",
  "awsCredentialExport",
  "alwaysThinkingEnabled",
  "attribution",
  "enabledPlugins",
  "skipDangerousModePermissionPrompt",
  "envFile",
  "respectGitignore",
  "spinnerTipsEnabled",
  "spinnerVerbs",
  "language",
  "outputStyle",
]);

const SECRET_KEY_RE = /TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|PRIVATE_KEY/i;
const ENV_REF_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

const VALID_RUNTIMES = new Set(["claude-code"]);
const VALID_SCOPES = new Set(["user", "project", "local"]);

function emptyTyped(errors: Issue[], warnings: Issue[] = []): TypeParseOk {
  return {
    name: "",
    description: "",
    displayName: null,
    tags: [],
    frontmatter: null,
    canonical: [],
    errors,
    warnings,
  };
}

function findSettingsMd(files: NormalizedFile[]): NormalizedFile | undefined {
  return files.find((f) => f.path === SETTINGS_MD || f.path.toLowerCase() === "settings.md");
}

function findSettingsJson(files: NormalizedFile[]): NormalizedFile | undefined {
  return files.find((f) => f.path === SETTINGS_JSON);
}

function isSecretEnvKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

function isEnvReference(value: unknown): boolean {
  return typeof value === "string" && ENV_REF_RE.test(value);
}

function scanSecrets(obj: Record<string, unknown>, jsonPath: string, errors: Issue[]): void {
  const env = obj.env;
  if (typeof env !== "object" || env === null || Array.isArray(env)) return;
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (!isSecretEnvKey(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.length === 0) continue;
    if (isEnvReference(value)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      errors.push({
        code: ISSUE_CODES.E_SETTINGS_SECRET,
        message: `Literal secret in env.${key}; use \${VAR} reference instead`,
        path: `${jsonPath}#/env/${key}`,
      });
    }
  }
}

function resolveSettingsName(
  fm: Record<string, unknown>,
  rootDir: string | null,
  input: ParseInput,
  errors: Issue[],
): string {
  const nameRaw = fm.name;
  let name = "";
  if (!validateName(nameRaw)) {
    errors.push({
      code: ISSUE_CODES.E_NAME_INVALID,
      message: `Invalid settings profile name: ${String(nameRaw)}`,
      path: SETTINGS_MD,
    });
  } else {
    name = nameRaw as string;
  }

  checkInputName(input, name, errors);
  if (rootDir && name && rootDir !== name) {
    errors.push({
      code: ISSUE_CODES.E_NAME_DIR_MISMATCH,
      message: `Directory "${rootDir}" does not match name "${name}"`,
      path: SETTINGS_MD,
    });
  }
  return name;
}

function applyRuntimeAndScope(fm: Record<string, unknown>, errors: Issue[]): void {
  let runtime = "claude-code";
  if (fm.runtime !== undefined) {
    if (typeof fm.runtime !== "string" || !VALID_RUNTIMES.has(fm.runtime)) {
      errors.push({
        code: ISSUE_CODES.E_SETTINGS_RUNTIME,
        message: `Unsupported settings runtime: ${String(fm.runtime)} (only claude-code)`,
        path: SETTINGS_MD,
      });
    } else {
      runtime = fm.runtime;
    }
  }

  let scope = "project";
  if (fm.scope !== undefined) {
    if (typeof fm.scope !== "string" || !VALID_SCOPES.has(fm.scope)) {
      errors.push({
        code: ISSUE_CODES.E_SETTINGS_RUNTIME,
        message: `Invalid settings scope: ${String(fm.scope)} (user|project|local)`,
        path: SETTINGS_MD,
      });
    } else {
      scope = fm.scope;
    }
  }

  fm.runtime = runtime;
  fm.scope = scope;
}

function validateSettingsJsonFile(
  jsonFile: NormalizedFile | undefined,
  errors: Issue[],
  warnings: Issue[],
): void {
  if (!jsonFile) {
    errors.push({
      code: ISSUE_CODES.E_SETTINGS_JSON_MISSING,
      message: "Settings profile requires settings.json next to SETTINGS.md",
      path: SETTINGS_JSON,
    });
    return;
  }
  try {
    const parsed = JSON.parse(contentToString(jsonFile.content)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      errors.push({
        code: ISSUE_CODES.E_SETTINGS_JSON_INVALID,
        message: "settings.json must be a JSON object",
        path: SETTINGS_JSON,
      });
      return;
    }
    const obj = parsed as Record<string, unknown>;
    scanSecrets(obj, SETTINGS_JSON, errors);
    for (const key of Object.keys(obj)) {
      if (!KNOWN_SETTINGS_KEYS.has(key)) {
        warnings.push({
          code: ISSUE_CODES.W_SETTINGS_KEY_UNKNOWN,
          message: `Unknown settings.json key: ${key}`,
          path: SETTINGS_JSON,
        });
      }
    }
  } catch {
    errors.push({
      code: ISSUE_CODES.E_SETTINGS_JSON_INVALID,
      message: "settings.json is not valid JSON",
      path: SETTINGS_JSON,
    });
  }
}

export function parseSettings(
  files: NormalizedFile[],
  rootDir: string | null,
  input: ParseInput,
): TypeParseOk {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  const mdFile = findSettingsMd(files);
  if (!mdFile) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_MISSING,
      message: "Settings profile requires SETTINGS.md",
      path: SETTINGS_MD,
    });
    return emptyTyped(errors, warnings);
  }

  const text = contentToString(mdFile.content);
  const extracted = extractFrontmatter(text);
  if (!extracted.hasBlock || !extracted.frontmatter) {
    errors.push({
      code: ISSUE_CODES.E_FRONTMATTER_MISSING,
      message: "SETTINGS.md requires YAML frontmatter",
      path: SETTINGS_MD,
    });
    return emptyTyped(errors, warnings);
  }

  const fm = { ...extracted.frontmatter };
  const name = resolveSettingsName(fm, rootDir, input, errors);
  const description = resolveDescription(input, fm.description, errors);
  applyRuntimeAndScope(fm, errors);
  validateSettingsJsonFile(findSettingsJson(files), errors, warnings);

  const prefix = name ? `settings/${name}/` : "settings/";
  const canonical = files
    .map((f) => ({
      path: `${prefix}${f.path}`,
      content: toUint8Array(f.content),
    }))
    .sort((a, b) => compareUtf8Paths(a.path, b.path));

  return {
    name,
    description,
    displayName: null,
    tags: [],
    frontmatter: fm,
    canonical,
    errors,
    warnings,
  };
}
