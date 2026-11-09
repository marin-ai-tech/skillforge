import type { Issue, ParsedArtifact } from "@skillforge/core";
import type { Database } from "../repo.ts";

/** Which MCP package types and remote origins may be published (mcp-policy). Admin only, one row. */
export type McpPolicy = { registry_types: string[]; remote_origins: string[] };

const REGISTRY_TYPES = ["npm", "pypi", "oci"];
export const DEFAULT_MCP_POLICY: McpPolicy = {
  registry_types: [...REGISTRY_TYPES],
  remote_origins: [],
};
const MAX_ORIGINS = 100;
const TEMPLATE_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class McpPolicyError extends Error {}

/** `https://host[:port]` or `https://*.domain`, nothing else (no path, query, credentials). */
function isOriginEntry(value: string): boolean {
  const wildcard = value.startsWith("https://*.");
  let u: URL;
  try {
    u = new URL(wildcard ? value.replace("https://*.", "https://") : value);
  } catch {
    return false;
  }
  const bare =
    u.protocol === "https:" &&
    u.username === "" &&
    u.password === "" &&
    (u.pathname === "/" || u.pathname === "") &&
    u.search === "" &&
    u.hash === "";
  const canonical = `https://${wildcard ? "*." : ""}${u.host}`;
  return bare && canonical === value;
}

function parseRegistryTypes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== "string" || !REGISTRY_TYPES.includes(v))
  ) {
    throw new McpPolicyError(`registry_types must be a list of ${REGISTRY_TYPES.join(", ")}`);
  }
  return REGISTRY_TYPES.filter((t) => value.includes(t));
}

function parseOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ORIGINS) {
    throw new McpPolicyError(`remote_origins must be a list of at most ${MAX_ORIGINS} origins`);
  }
  for (const v of value) {
    if (typeof v !== "string" || !isOriginEntry(v)) {
      throw new McpPolicyError(
        "each remote origin must be https://host[:port] or https://*.domain",
      );
    }
  }
  return [...new Set(value as string[])];
}

export function applyMcpPolicyPatch(current: McpPolicy, body: unknown): McpPolicy {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new McpPolicyError("body must be an object");
  }
  const next = { ...current };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === "registry_types") next.registry_types = parseRegistryTypes(value);
    else if (key === "remote_origins") next.remote_origins = parseOrigins(value);
    else throw new McpPolicyError(`unknown field ${key}`);
  }
  return next;
}

export function loadMcpPolicy(db: Database): McpPolicy {
  const row = db.prepare("SELECT settings FROM mcp_policy WHERE id = 1").get() as
    { settings: string } | undefined;
  if (!row)
    return { ...DEFAULT_MCP_POLICY, registry_types: [...DEFAULT_MCP_POLICY.registry_types] };
  try {
    return applyMcpPolicyPatch(DEFAULT_MCP_POLICY, JSON.parse(row.settings));
  } catch {
    return { ...DEFAULT_MCP_POLICY };
  }
}

export function saveMcpPolicy(db: Database, policy: McpPolicy, actor: string): void {
  db.prepare(
    `INSERT INTO mcp_policy (id, settings, updated_by, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(policy), actor, new Date().toISOString());
}

/** Origin of a remote URL with `{templates}` replaced by their names; null when it does not parse. */
function remoteOrigin(url: string): string | null {
  try {
    const u = new URL(url.replace(TEMPLATE_RE, "$1"));
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function originAllowed(origin: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    if (!entry.startsWith("https://*.")) return entry === origin;
    return origin.startsWith("https://") && origin.endsWith(`.${entry.slice("https://*.".length)}`);
  });
}

type Descriptor = {
  packages: Array<Record<string, unknown>>;
  remotes: Array<Record<string, unknown>>;
};

function descriptorOf(artifact: Pick<ParsedArtifact, "canonical">): Descriptor | null {
  const file = artifact.canonical.find((c) => /(^|\/)server\.json$/.test(c.path));
  if (!file) return null;
  try {
    const obj = JSON.parse(Buffer.from(file.content).toString("utf8")) as Record<string, unknown>;
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        : [];
    return { packages: list(obj.packages), remotes: list(obj.remotes) };
  } catch {
    return null;
  }
}

/** Why the policy refuses this MCP server; field names and origins only, never paths or queries. */
export function mcpPolicyReasons(
  policy: McpPolicy,
  artifact: Pick<ParsedArtifact, "canonical">,
): string[] {
  const d = descriptorOf(artifact);
  if (!d) return [];
  const reasons: string[] = [];
  d.packages.forEach((p, i) => {
    const t = typeof p.registryType === "string" ? p.registryType : "";
    if (!policy.registry_types.includes(t)) {
      reasons.push(`packages[${i}].registryType ${t || "(none)"} is not allowed by the MCP policy`);
    }
  });
  d.remotes.forEach((r, i) => {
    const origin = typeof r.url === "string" ? remoteOrigin(r.url) : null;
    if (origin && !originAllowed(origin, policy.remote_origins)) {
      reasons.push(`remotes[${i}] ${origin} is not in the MCP policy's remote origins`);
    }
  });
  return reasons;
}

/** Publish gate: one blocking issue when the policy refuses an mcp-server version. */
export function mcpPolicyBlock(db: Database, artifact: ParsedArtifact): Issue | null {
  if (artifact.type !== "mcp-server") return null;
  const reasons = mcpPolicyReasons(loadMcpPolicy(db), artifact);
  if (reasons.length === 0) return null;
  return { code: "E_MCP_POLICY", message: reasons.join("; "), path: "server.json" };
}

/** The current policy's verdict on a published version (the policy may have changed since). */
export function mcpPolicyVerdict(
  db: Database,
  artifact: Pick<ParsedArtifact, "canonical">,
): { allowed: boolean; reasons: string[] } {
  const reasons = mcpPolicyReasons(loadMcpPolicy(db), artifact);
  return { allowed: reasons.length === 0, reasons };
}
