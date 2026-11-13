import { sourceRoutes } from "./routes/sources.ts";
import { checkAllSources } from "./tracked/check.ts";
import { backfillSources } from "./tracked/store.ts";
import { backfillSignatures, loadSigner, setSigner } from "./signing/signer.ts";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.ts";
import { openDatabase, migrate, type Database } from "./db.ts";
import { countArtifacts } from "./repo.ts";
import { artifactsRoutes } from "./routes/artifacts.ts";
import { metadataPurgeRoutes } from "./routes/metadata-purge.ts";
import { evidenceRoutes } from "./routes/evidence.ts";
import { authRoutes } from "./routes/auth.ts";
import { adminRoutes } from "./routes/admin.ts";
import { lifecycleRoutes } from "./routes/lifecycle.ts";
import { importsRoutes } from "./routes/imports.ts";
import { distributionRoutes } from "./routes/distribution.ts";
import { backupsRoutes } from "./routes/backups.ts";
import { adminPluginsRoutes } from "./routes/admin-plugins.ts";
import { adminLlmRoutes } from "./routes/admin-llm.ts";
import { adminImportPolicyRoutes } from "./routes/admin-import-policy.ts";
import { adminSecurityPolicyRoutes } from "./routes/admin-security-policy.ts";
import { adminMcpPolicyRoutes } from "./routes/admin-mcp-policy.ts";
import { mcpServerCardRoutes } from "./routes/mcp-server-card.ts";
import { adminMirrorRoutes } from "./routes/admin-mirrors.ts";
import { versionDiffRoutes } from "./routes/version-diff.ts";
import { availabilityRoutes } from "./routes/availability.ts";
import { replacementRoutes } from "./routes/replacement.ts";
import { adminAuditRoutes } from "./routes/admin-audit.ts";
import { qualityRubricRoutes } from "./routes/quality-rubric.ts";
import { rolloutRoutes } from "./routes/rollouts.ts";
import { harvestRoutes } from "./routes/harvests.ts";
import { packRoutes } from "./routes/packs.ts";
import { overlayRoutes } from "./routes/overlays.ts";
import { syncAllMirrors } from "./imports/mirror.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { pluginsRoutes } from "./routes/plugins.ts";
import { agentsRoutes } from "./routes/agents.ts";
import { adminAgentsRoutes } from "./routes/admin-agents.ts";
import { meOverviewRoutes } from "./routes/me-overview.ts";
import { commentsRoutes } from "./routes/comments.ts";
import { notificationsRoutes } from "./routes/notifications.ts";
import { sessionFactsRoutes } from "./routes/session-facts.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { evalsRoutes } from "./routes/evals.ts";
import { runOutputsRoutes } from "./routes/run-outputs.ts";
import { workflowsRoutes } from "./routes/workflows.ts";
import { routinesRoutes } from "./routes/routines.ts";
import { hooksRoutes } from "./routes/hooks.ts";
import { configureRunOutputs, pruneRunOutputs } from "./runs/outputs.ts";
import { interruptStaleRuns, onRunFinished } from "./evals/runs.ts";
import { appendProvenance } from "./provenance/ledger.ts";
import { interruptStaleBatches, startBatchPump, stopBatchPump } from "./evals/batch.ts";
import { interruptStaleWorkflowRuns } from "./workflows/engine.ts";
import {
  interruptStaleRoutineRuns,
  startRoutinesScheduler,
  stopRoutinesScheduler,
} from "./routines/runner.ts";
import { adminStarterPacksRoutes } from "./routes/admin-starter-packs.ts";
import { mcpRoutes } from "./mcp/routes.ts";
import { loadPlugins } from "./plugins/loader.ts";
import { pluginRegistry } from "./plugins/registry.ts";
import {
  cleanupExpiredImports,
  ensureImportsRoot,
  startImportCleanupTimer,
} from "./imports/store.ts";
import { createAuthenticateHook } from "./auth/guard.ts";
import { seedAdmin, seedLocalUser, initialAdminPasswordPath } from "./auth/seed.ts";
import { teamsRoutes } from "./teams.ts";
import { scopeRoutes } from "./routes/scope.ts";
import { canView } from "./visibility/index.ts";
import { buildCommit } from "./build-info.ts";
import { getArtifactByTypeName } from "./repo.ts";
import { isLoopbackHostHeader } from "./auth/local-host.ts";
import { purgeExpiredSessions } from "./auth/sessions.ts";
import { runAgingSweep } from "./lifecycle/sweep.ts";
import { policyFromConfig } from "./lifecycle/policy.ts";
import { backfillQuality } from "./quality/backfill.ts";
import { backfillBodyFingerprints } from "./duplicates/backfill.ts";
import {
  createLogger,
  registerRequestLogging,
  createSafeErrorHandler,
  registerRedactSecrets,
} from "./logging.ts";
import { diagnosticsBundleRoutes } from "./routes/diagnostics-bundle.ts";
import { registerOversizedBodyDrain } from "./body-drain.ts";

function serverVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, "../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

export type SkillForgeApp = Awaited<ReturnType<typeof buildApp>>;

type ConfigDefaults = { [K in keyof AppConfig]?: (config: AppConfig) => AppConfig[K] };

// Defaults for partial configs from older callers (e.g. CLI tests) missing auth fields.
// Applied in declaration order; each default is computed only when the field is undefined.
const CONFIG_DEFAULTS: ConfigDefaults = {
  adminPassword: () => null,
  publicRead: () => true,
  sessionTtlDays: () => 30,
  agingDays: () => 90,
  candidateTtlDays: () => 30,
  dataLifecycleEnabled: () => true,
  zombieIdleDays: () => 180,
  zombieWindowDays: () => 60,
  zombieMinUses: () => 20,
  zombieMinReporters: () => 3,
  zombieTransferRate: () => 0.2,
  zombieRetireDays: () => 30,
  ablationMinTasks: () => 10,
  reviveWindowDays: () => 14,
  reviveMinEvents: () => 3,
  lifecycleMaxPerSweep: () => 20,
  importGit: () => true,
  importAllowFileUrls: () => false,
  importTtlMinutes: () => 15,
  marketplaceName: () => "skillforge",
  marketplaceOwner: () => "SkillForge",
  pluginsDir: (config) => path.join(config.dataDir, "plugins"),
  bundledPluginsDir: () => null,
  mirrorIntervalHours: () => 0,
  pluginsDisabled: () => false,
  agentRoots: () => [],
  starterPacksDir: () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "../starter-packs");
  },
  authMode: () => "password",
  oidcProviders: () => [],
  ldapProviders: () => [],
  publicUrl: () => null,
  evalRunnersFile: () => null,
  evalConcurrency: () => 2,
  evalMaxRunsPerDay: () => 20,
  runOutputRetentionDays: () => 30,
  runOutputMaxBytes: () => 1024 * 1024,
  llmApiKey: () => null,
  llmKeyOrigins: () => [],
  budgetSocket: () => null,
  downloadsDir: (config) => path.join(config.dataDir, "downloads"),
};

function applyConfigDefaults(config: AppConfig): void {
  const target = config as unknown as Record<string, unknown>;
  for (const [key, makeDefault] of Object.entries(CONFIG_DEFAULTS)) {
    if (target[key] === undefined) {
      target[key] = (makeDefault as (config: AppConfig) => unknown)(config);
    }
  }
}

export async function buildApp(config: AppConfig) {
  // Tolerate partial configs from older callers (e.g. CLI tests) missing auth fields.
  applyConfigDefaults(config);
  const startedAt = Date.now();
  const db: Database = openDatabase(config.dataDir);
  migrate(db);
  interruptStaleRuns(db);
  interruptStaleBatches(db);
  interruptStaleWorkflowRuns(db);
  interruptStaleRoutineRuns(db);
  configureRunOutputs({
    retentionDays: config.runOutputRetentionDays,
    maxBytes: config.runOutputMaxBytes,
  });
  try {
    pruneRunOutputs(db, config.dataDir, new Date());
  } catch {
    /* retention at startup is best effort */
  }
  backfillQuality(db, config.dataDir);
  setSigner(loadSigner(config.dataDir));
  backfillSignatures(db);
  backfillBodyFingerprints(db, config.dataDir);
  purgeExpiredSessions(db);
  seedAdmin(db, config.dataDir, config.adminPassword);
  if (config.authMode === "local") {
    seedLocalUser(db);
  }

  // Exact secret values masked by the logger/diagnostics redact.
  registerRedactSecrets([
    config.adminPassword,
    ...config.oidcProviders.map((p) => p.client_secret),
    ...(config.ldapProviders ?? []).map((p) => p.bind_password),
    config.llmApiKey,
  ]);
  try {
    const pwFile = initialAdminPasswordPath(config.dataDir);
    if (fs.existsSync(pwFile)) {
      registerRedactSecrets([fs.readFileSync(pwFile, "utf8").trim()]);
    }
  } catch {
    /* best effort */
  }

  // Aging sweep at startup (after seed); hourly timer does not keep the process alive.
  runAgingSweep(db, policyFromConfig(config));
  const sweepTimer = setInterval(
    () => {
      try {
        runAgingSweep(db, policyFromConfig(config));
      } catch {
        /* ignore sweep errors on timer */
      }
    },
    60 * 60 * 1000,
  );
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  ensureImportsRoot(config.dataDir);
  cleanupExpiredImports(config.dataDir);
  const importCleanupTimer = startImportCleanupTimer(config.dataDir);

  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024 * 1024,
  });
  registerOversizedBodyDrain(app);
  await app.register(fastifyCookie);
  const logger = createLogger(config.dataDir);
  registerRequestLogging(app, logger);
  app.setErrorHandler(createSafeErrorHandler(logger, { safeErrors: config.safeErrors }));

  // Local mode: Host check + Origin CSRF before any handling (including SPA static).
  app.addHook("onRequest", async (request, reply) => {
    if (config.authMode !== "local") return;
    const host = typeof request.headers.host === "string" ? request.headers.host : "";
    if (!isLoopbackHostHeader(host)) {
      return reply.code(421).type("application/json").send({ error: "misdirected_host" });
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      let originHost: string;
      try {
        originHost = new URL(origin).hostname;
      } catch {
        return reply.code(403).type("application/json").send({ error: "cross_origin" });
      }
      if (!isLoopbackHostHeader(originHost)) {
        return reply.code(403).type("application/json").send({ error: "cross_origin" });
      }
    }
  });

  app.addHook("onRequest", createAuthenticateHook(db, config));

  // Deny-by-default visibility gate: any route carrying params.type + params.name
  // under artifacts/plugins/ext surfaces 404s as-if-absent BEFORE its handler for
  // artifacts the requester may not see. Creation (POST /api/v1/artifacts, validate)
  // has no :type/:name params and is never matched here.
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    const isScoped =
      url.startsWith("/api/v1/artifacts/") ||
      url.startsWith("/api/v1/plugins/") ||
      url.startsWith("/api/v1/ext/");
    if (!isScoped) return;
    const params = request.params as Record<string, string> | undefined;
    if (!params || typeof params.type !== "string" || typeof params.name !== "string") return;
    if (url === "/api/v1/artifacts/validate") return;
    const row = getArtifactByTypeName(db, params.type, params.name);
    if (!row) return; // let the handler produce its usual 404 body
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    if (!canView(db, viewer, row)) {
      return reply.code(404).type("application/json").send({ error: "not_found" });
    }
  });

  const version = serverVersion();
  await loadPlugins({ config, db, app, serverVersion: version });

  app.addHook("onClose", async () => {
    stopBatchPump();
    stopRoutinesScheduler();
    clearInterval(sweepTimer);
    clearInterval(importCleanupTimer);
    try {
      db.close();
    } catch {
      // ignore double-close
    }
  });

  await app.register(authRoutes, { db, config });
  await app.register(adminRoutes, { db });
  await app.register(adminLlmRoutes, { db, config });
  await app.register(adminImportPolicyRoutes, { db });
  await app.register(adminSecurityPolicyRoutes, { db });
  await app.register(adminMcpPolicyRoutes, { db });
  await app.register(mcpServerCardRoutes, { db, config });
  await app.register(adminMirrorRoutes, { db, config });
  await app.register(versionDiffRoutes, { db, config });
  await app.register(availabilityRoutes, { db });
  await app.register(replacementRoutes, { db });
  await app.register(adminAuditRoutes, { db });
  await app.register(qualityRubricRoutes, { db });
  await app.register(rolloutRoutes, { db, config, dataDir: config.dataDir });
  await app.register(harvestRoutes, { db, config });
  await app.register(packRoutes, { db });
  await app.register(overlayRoutes, { db });
  await app.register(sourceRoutes, { db, config });
  backfillSources(db);
  if (config.mirrorIntervalHours > 0) {
    const timer = setInterval(
      () => void syncAllMirrors(db, config).then(() => checkAllSources(db, config)),
      config.mirrorIntervalHours * 3_600_000,
    );
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }
  await app.register(assistantRoutes, { db, config });
  await app.register(diagnosticsBundleRoutes, {
    db,
    config,
    serverVersion: version,
    startedAt,
  });
  await app.register(teamsRoutes, { db });
  await app.register(scopeRoutes, { db });
  await app.register(artifactsRoutes, { db, config });
  await app.register(metadataPurgeRoutes, { db, config });
  await app.register(evidenceRoutes, { db, config });
  await app.register(lifecycleRoutes, { db, config });
  await app.register(importsRoutes, { db, config });
  await app.register(distributionRoutes, { db, config, version });
  await app.register(backupsRoutes, { db, config, serverVersion: version });
  await app.register(adminPluginsRoutes, { db, config });
  await app.register(pluginsRoutes, { db, config });
  await app.register(agentsRoutes, { db, config });
  await app.register(adminAgentsRoutes, { db, config });
  await app.register(meOverviewRoutes, { db, config });
  await app.register(commentsRoutes, { db });
  await app.register(notificationsRoutes, { db });
  await app.register(sessionFactsRoutes, { db, config });
  await app.register(metricsRoutes, { db });
  await app.register(evalsRoutes, { db, config });
  await app.register(runOutputsRoutes, { db, config });
  await app.register(workflowsRoutes, {
    db,
    dataDir: config.dataDir,
    enabled: config.orchestrationEnabled,
  });
  await app.register(routinesRoutes, {
    db,
    dataDir: config.dataDir,
    enabled: config.orchestrationEnabled,
  });
  await app.register(hooksRoutes, {
    db,
    dataDir: config.dataDir,
    enabled: config.orchestrationEnabled,
    hooksDisabled: config.hooksDisabled,
  });
  await app.register(adminStarterPacksRoutes, { db, config });
  await app.register(mcpRoutes, { db, config, serverVersion: version });

  // Unknown extension routes → 404 (after loaded plugins have registered).
  app.all("/api/v1/ext/*", async (_request, reply) => {
    return reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/v1/health", async (request) => {
    let dbStatus = "error";
    try {
      db.prepare("SELECT 1").get();
      dbStatus = "ok";
    } catch {
      dbStatus = "error";
    }
    return {
      status: "ok",
      version,
      commit: buildCommit(),
      uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      // The absolute data path is for admins only: it names the account and disk layout;
      // not for an MCP token, which sees no more than MCP shows.
      ...(request.user?.role === "admin" && request.authVia !== "mcp_token"
        ? { data_dir: config.dataDir }
        : {}),
      db: dbStatus,
      artifacts: countArtifacts(db),
      plugins: pluginRegistry.health(),
      orchestration_enabled: config.orchestrationEnabled,
    };
  });

  const webDir = config.webDir;
  const indexPath = path.join(webDir, "index.html");
  let cachedIndexHtml: string | null = null;

  if (fs.existsSync(webDir)) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const urlPath = request.url.split("?")[0] ?? "";
    if (urlPath.startsWith("/api/")) {
      return reply.code(404).type("application/json").send({ error: "not_found" });
    }
    if (!fs.existsSync(indexPath)) {
      return reply.code(503).type("text/plain").send("web bundle not built");
    }
    if (cachedIndexHtml === null) {
      cachedIndexHtml = fs.readFileSync(indexPath, "utf8");
    }
    return reply.code(200).type("text/html").send(cachedIndexHtml);
  });

  if (config.orchestrationEnabled) {
    startRoutinesScheduler(db, config.dataDir, { routinesDisabled: config.routinesDisabled });
  }
  startBatchPump(db, config);
  // provenance-ledger: an eval run in a terminal status writes a kind=eval record
  onRunFinished((runId) => {
    const run = db
      .prepare("SELECT artifact_id, version, kind, status, runner FROM eval_runs WHERE id = ?")
      .get(runId) as
      | { artifact_id: string; version: string; kind: string; status: string; runner: string }
      | undefined;
    if (!run) return;
    appendProvenance(db, {
      artifact_id: run.artifact_id,
      version: run.version,
      kind: "eval",
      source: "system",
      ref: `eval_run:${runId}`,
      meta: { run_kind: run.kind, status: run.status, runner: run.runner },
    });
  });

  return app;
}
