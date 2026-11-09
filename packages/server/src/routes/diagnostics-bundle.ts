import { buildCommit } from "../build-info.ts";
import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireRole } from "../auth/guard.ts";
import { buildTarGz, type TarEntry } from "../distribution/tar.ts";
import { pluginRegistry } from "../plugins/registry.ts";
import { redact, redactString } from "../logging.ts";

export type DiagnosticsBundleOpts = {
  db: Database;
  config: AppConfig;
  serverVersion: string;
  startedAt: number;
};

const EXCLUDED_BASENAMES = new Set([
  "secrets.json",
  "initial-admin-password.txt",
  ".env",
  ".env.local",
]);

function readRecentLogs(logsDir: string, maxFiles = 3, maxBytes = 512 * 1024): TarEntry[] {
  const entries: TarEntry[] = [];
  if (!fs.existsSync(logsDir)) return entries;
  // Current log first, then newest rotations (.1 is the newest — rotation
  // renames log → .1 before writing). Plain sort().reverse() used to pick the
  // oldest files and skip the current one entirely.
  const all = fs.readdirSync(logsDir).filter((n) => n.startsWith("skillforge.log"));
  const rotated = all
    .filter((n) => n !== "skillforge.log")
    .map((n) => ({ n, idx: Number(n.slice("skillforge.log.".length)) || 0 }))
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.n);
  const names = ["skillforge.log", ...rotated].slice(0, maxFiles);
  for (const name of names) {
    if (EXCLUDED_BASENAMES.has(name)) continue;
    const full = path.join(logsDir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      let buf = fs.readFileSync(full);
      if (buf.length > maxBytes) {
        buf = buf.subarray(buf.length - maxBytes);
      }
      entries.push({
        path: `logs/${name}`,
        content: new Uint8Array(Buffer.from(redactString(buf.toString("utf8")), "utf8")),
      });
    } catch {
      /* skip unreadable log */
    }
  }
  return entries;
}

function sanitisedConfig(config: AppConfig): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    port: config.port,
    host: config.host,
    dataDir: config.dataDir,
    baseUrl: config.baseUrl,
    webDir: config.webDir,
    publicRead: config.publicRead,
    sessionTtlDays: config.sessionTtlDays,
    authMode: config.authMode,
    marketplaceName: config.marketplaceName,
    marketplaceOwner: config.marketplaceOwner,
    pluginsDisabled: config.pluginsDisabled,
    pluginsDir: config.pluginsDir,
    backupKeep: config.backupKeep,
    publicUrl: config.publicUrl,
    oidcProviders: config.oidcProviders.map((p) => ({
      id: p.id,
      label: p.label,
      issuer: p.issuer,
      client_id: p.client_id,
      client_secret: "[REDACTED]",
      scopes: p.scopes,
      default_role: p.default_role,
    })),
    ldapProviders: config.ldapProviders.map((p) => ({
      id: p.id,
      label: p.label,
      url: p.url,
      bind_dn: p.bind_dn,
      bind_password: "[REDACTED]",
      user_base: p.user_base,
      default_role: p.default_role,
    })),
    adminPassword: config.adminPassword ? "[REDACTED]" : null,
  };
  return redact(raw) as Record<string, unknown>;
}

function buildHealthSnapshot(
  db: Database,
  config: AppConfig,
  serverVersion: string,
  startedAt: number,
): Record<string, unknown> {
  let dbStatus = "error";
  try {
    db.prepare("SELECT 1").get();
    dbStatus = "ok";
  } catch {
    dbStatus = "error";
  }
  return {
    status: "ok",
    version: serverVersion,
    commit: buildCommit(),
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    data_dir: config.dataDir,
    db: dbStatus,
    plugins: pluginRegistry.health(),
  };
}

/** Build a diagnostics tar.gz (allowlist only; never secrets/password/tokens). */
export function buildDiagnosticsBundle(opts: {
  db: Database;
  config: AppConfig;
  serverVersion: string;
  startedAt: number;
}): Uint8Array {
  const { db, config, serverVersion, startedAt } = opts;
  const logsDir = path.join(config.dataDir, "logs");
  const health = buildHealthSnapshot(db, config, serverVersion, startedAt);
  const cfg = sanitisedConfig(config);
  const plugins = pluginRegistry.health();
  const manifest = {
    format: 1,
    kind: "diagnostics.bundle",
    created_at: new Date().toISOString(),
    server_version: serverVersion,
    excludes: [
      "secrets.json",
      "initial-admin-password.txt",
      "bearer tokens",
      "raw password material",
      "sqlite database",
    ],
  };
  const enc = new TextEncoder();
  const entries: TarEntry[] = [
    { path: "manifest.json", content: enc.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
    { path: "health.json", content: enc.encode(`${JSON.stringify(health, null, 2)}\n`) },
    { path: "config.json", content: enc.encode(`${JSON.stringify(cfg, null, 2)}\n`) },
    { path: "plugins.json", content: enc.encode(`${JSON.stringify(plugins, null, 2)}\n`) },
    ...readRecentLogs(logsDir),
  ];
  // Defense-in-depth: never pack excluded basenames even if somehow listed.
  const safe = entries.filter((e) => {
    const base = e.path.split("/").pop() ?? e.path;
    return !EXCLUDED_BASENAMES.has(base);
  });
  return buildTarGz(safe);
}

export const diagnosticsBundleRoutes: FastifyPluginAsync<DiagnosticsBundleOpts> = async (
  app,
  opts,
) => {
  const { db, config, serverVersion, startedAt } = opts;

  app.get("/api/v1/admin/diagnostics/bundle", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    try {
      const archive = buildDiagnosticsBundle({ db, config, serverVersion, startedAt });
      const filename = `skillforge-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
      return reply
        .code(200)
        .header("Content-Type", "application/gzip")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(Buffer.from(archive));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void msg;
      return reply.code(500).send({ error: "internal_error", request_id: request.requestId });
    }
  });
};
