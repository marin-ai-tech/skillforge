import { ISSUE_CODES } from "./types.ts";
import type { Issue, IssueCode } from "./types.ts";
import { isSecretName, isSecretValue } from "../mcp/secrets.ts";

/**
 * Checks of an MCP server descriptor (`server.json`, field names of the official MCP registry schema 2025-12-11)
 * on top of that schema: exact versions, digests for images, no literal secrets, no shell, https only.
 * Messages name fields, never values.
 */
const FILE = "server.json";
type Obj = Record<string, unknown>;

const REGISTRY_TYPES = new Set(["npm", "pypi", "oci"]);
const PACKAGE_TRANSPORTS = new Set(["stdio", "streamable-http", "sse"]);
const REMOTE_TYPES = new Set(["streamable-http", "sse"]);
const SHELLS = new Set(["sh", "bash", "zsh", "cmd", "powershell", "pwsh"]);
const SHELL_SYNTAX_RE = /[;|`]|&&|\$\(/;
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const EXACT_PY_RE = /^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?$/i;
const OCI_DIGEST_RE = /@sha256:[0-9a-f]{64}$/;
const TEMPLATE_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const AUTH_SCHEME_RE = /^(?:Bearer|Basic|Token)$/i;
const SECRET_QUERY_NAMES = new Set([
  "key",
  "token",
  "secret",
  "password",
  "auth",
  "sig",
  "api_key",
]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function report(errors: Issue[], code: IssueCode, message: string): void {
  errors.push({ code, message, path: FILE });
}

/** Only `{var}` templates, optionally after an auth scheme word: a reference, not a literal. */
function onlyTemplates(value: string): boolean {
  const rest = value.replace(TEMPLATE_RE, "").trim();
  return rest === "" || (value.match(TEMPLATE_RE) !== null && AUTH_SCHEME_RE.test(rest));
}

/** One input (env var, header, named argument, template variable) and its template variables. */
function checkInput(name: string, input: unknown, where: string, errors: Issue[]): void {
  if (!isObj(input)) return;
  const secret = input.isSecret === true || isSecretName(name);
  for (const field of ["value", "default"] as const) {
    const v = input[field];
    if (typeof v !== "string" || v === "" || onlyTemplates(v)) continue;
    if (secret || isSecretValue(v)) {
      report(
        errors,
        ISSUE_CODES.E_MCP_SECRET_LITERAL,
        `${where} "${name}" has a literal ${field}; declare a secret with isSecret and no value, or use a {variable}`,
      );
    }
  }
  if (isObj(input.variables)) {
    for (const [vn, vi] of Object.entries(input.variables)) {
      checkInput(vn, vi, `${where} "${name}" variable`, errors);
    }
  }
}

function checkInputs(list: unknown, where: string, errors: Issue[]): void {
  if (!Array.isArray(list)) return;
  list.forEach((item, i) => {
    const name = isObj(item) && typeof item.name === "string" ? item.name : `#${i}`;
    checkInput(name, item, `${where}[${i}]`, errors);
  });
}

function checkArguments(list: unknown, where: string, errors: Issue[]): void {
  if (!Array.isArray(list)) return;
  list.forEach((arg, i) => {
    if (!isObj(arg)) return;
    const shell = [arg.value, arg.default].some(
      (v) => typeof v === "string" && SHELL_SYNTAX_RE.test(v),
    );
    if (shell) {
      report(errors, ISSUE_CODES.E_MCP_SHELL, `${where}[${i}] contains shell syntax`);
    }
    if (arg.type === "named" && typeof arg.name === "string") {
      checkInput(arg.name, arg, `${where}[${i}]`, errors);
    }
  });
}

function pinned(pkg: Obj): boolean {
  const version = typeof pkg.version === "string" ? pkg.version : "";
  if (pkg.registryType === "npm") return EXACT_SEMVER_RE.test(version);
  if (pkg.registryType === "pypi") return EXACT_PY_RE.test(version);
  return typeof pkg.identifier === "string" && OCI_DIGEST_RE.test(pkg.identifier);
}

function checkPackage(pkg: unknown, where: string, errors: Issue[]): void {
  if (!isObj(pkg) || typeof pkg.identifier !== "string" || pkg.identifier === "") {
    report(errors, ISSUE_CODES.E_MCP_JSON_INVALID, `${where} needs an identifier`);
    return;
  }
  if (typeof pkg.registryType !== "string" || !REGISTRY_TYPES.has(pkg.registryType)) {
    report(
      errors,
      ISSUE_CODES.E_MCP_TRANSPORT_UNKNOWN,
      `${where}.registryType is not npm, pypi or oci`,
    );
  } else if (!pinned(pkg)) {
    const how =
      pkg.registryType === "oci" ? "an @sha256: digest in identifier" : "an exact version";
    report(errors, ISSUE_CODES.E_MCP_UNPINNED, `${where} needs ${how}`);
  }
  const transport = isObj(pkg.transport) ? pkg.transport : {};
  if (typeof transport.type !== "string" || !PACKAGE_TRANSPORTS.has(transport.type)) {
    report(
      errors,
      ISSUE_CODES.E_MCP_TRANSPORT_UNKNOWN,
      `${where}.transport.type is not stdio, streamable-http or sse`,
    );
  }
  if (typeof pkg.runtimeHint === "string" && SHELLS.has(pkg.runtimeHint.toLowerCase())) {
    report(errors, ISSUE_CODES.E_MCP_SHELL, `${where}.runtimeHint runs a shell`);
  }
  checkArguments(pkg.runtimeArguments, `${where}.runtimeArguments`, errors);
  checkArguments(pkg.packageArguments, `${where}.packageArguments`, errors);
  checkInputs(pkg.environmentVariables, `${where}.environmentVariables`, errors);
  checkInputs(transport.headers, `${where}.transport.headers`, errors);
}

/** Why a remote URL is refused, or null. Templates are replaced by their names before parsing. */
function urlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.replace(TEMPLATE_RE, "$1"));
  } catch {
    return "is not a URL";
  }
  if (u.protocol !== "https:") return "must use https";
  if (u.username !== "" || u.password !== "") return "must not carry credentials";
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost")) return "must not point to localhost";
  const keys = [...u.searchParams.keys()].map((k) => k.toLowerCase());
  if (keys.some((k) => SECRET_QUERY_NAMES.has(k))) return "must not carry a key in the query";
  return null;
}

function checkRemote(remote: unknown, where: string, errors: Issue[]): void {
  if (!isObj(remote)) {
    report(errors, ISSUE_CODES.E_MCP_JSON_INVALID, `${where} must be an object`);
    return;
  }
  if (typeof remote.type !== "string" || !REMOTE_TYPES.has(remote.type)) {
    report(
      errors,
      ISSUE_CODES.E_MCP_TRANSPORT_UNKNOWN,
      `${where}.type is not streamable-http or sse`,
    );
  }
  const problem = typeof remote.url === "string" ? urlProblem(remote.url) : "is missing";
  if (problem) report(errors, ISSUE_CODES.E_MCP_URL_INVALID, `${where}.url ${problem}`);
  checkInputs(remote.headers, `${where}.headers`, errors);
  if (isObj(remote.variables)) {
    for (const [vn, vi] of Object.entries(remote.variables)) {
      checkInput(vn, vi, `${where}.variables`, errors);
    }
  }
}

function checkTools(tools: unknown, errors: Issue[]): void {
  if (tools === undefined) return;
  const ok =
    Array.isArray(tools) &&
    tools.every(
      (t) =>
        isObj(t) &&
        typeof t.name === "string" &&
        (t.description === undefined || typeof t.description === "string"),
    );
  if (!ok)
    report(errors, ISSUE_CODES.E_MCP_JSON_INVALID, "tools must be a list of {name, description}");
}

function parseObject(text: string | undefined, errors: Issue[]): Obj | null {
  if (text === undefined) {
    report(
      errors,
      ISSUE_CODES.E_MCP_JSON_INVALID,
      "An MCP server requires server.json next to MCP.md",
    );
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isObj(parsed)) return parsed;
  } catch {
    /* reported below */
  }
  report(errors, ISSUE_CODES.E_MCP_JSON_INVALID, "server.json is not a JSON object");
  return null;
}

/** Validates the descriptor and returns it, or null when it does not parse. */
export function checkServerJson(text: string | undefined, errors: Issue[]): Obj | null {
  const obj = parseObject(text, errors);
  if (!obj) return null;
  const packages = Array.isArray(obj.packages) ? obj.packages : [];
  const remotes = Array.isArray(obj.remotes) ? obj.remotes : [];
  if (packages.length + remotes.length === 0) {
    report(errors, ISSUE_CODES.E_MCP_JSON_INVALID, "server.json lists no packages and no remotes");
    return obj;
  }
  packages.forEach((p, i) => checkPackage(p, `packages[${i}]`, errors));
  remotes.forEach((r, i) => checkRemote(r, `remotes[${i}]`, errors));
  checkTools(obj.tools, errors);
  return obj;
}
