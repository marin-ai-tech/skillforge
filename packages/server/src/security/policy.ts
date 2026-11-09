import type { Issue, SecurityReport } from "@skillforge/core";
import type { Database } from "../repo.ts";

/** Publish blocking by scan severity (content-security-scan): off by default, admin only. */
export type SecurityPolicy = { block_publish_on: "none" | "high" | "medium" };

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = { block_publish_on: "none" };
const LEVELS = new Set(["none", "high", "medium"]);

export class SecurityPolicyError extends Error {}

export function applySecurityPatch(current: SecurityPolicy, body: unknown): SecurityPolicy {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SecurityPolicyError("body must be an object");
  }
  const next = { ...current };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key !== "block_publish_on") throw new SecurityPolicyError(`unknown field ${key}`);
    if (typeof value !== "string" || !LEVELS.has(value)) {
      throw new SecurityPolicyError("block_publish_on must be none, high or medium");
    }
    next.block_publish_on = value as SecurityPolicy["block_publish_on"];
  }
  return next;
}

export function loadSecurityPolicy(db: Database): SecurityPolicy {
  const row = db.prepare("SELECT settings FROM security_policy WHERE id = 1").get() as
    { settings: string } | undefined;
  if (!row) return { ...DEFAULT_SECURITY_POLICY };
  try {
    return applySecurityPatch(DEFAULT_SECURITY_POLICY, JSON.parse(row.settings));
  } catch {
    return { ...DEFAULT_SECURITY_POLICY };
  }
}

export function saveSecurityPolicy(db: Database, policy: SecurityPolicy, actor: string): void {
  db.prepare(
    `INSERT INTO security_policy (id, settings, updated_by, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(policy), actor, new Date().toISOString());
}

/** The blocking issue when the policy refuses this scan, otherwise null. */
export function securityBlock(db: Database, scan: SecurityReport | undefined): Issue | null {
  const { block_publish_on: level } = loadSecurityPolicy(db);
  if (level === "none" || !scan) return null;
  const hit = scan.findings.filter(
    (f) => !f.mention && (f.severity === "high" || level === "medium"),
  );
  if (hit.length === 0) return null;
  const rules = [...new Set(hit.map((f) => f.rule))].join(", ");
  return {
    code: "E_SECURITY_BLOCKED",
    message: `The security policy blocks publishing: ${rules}`,
    path: hit[0]!.file,
  };
}
