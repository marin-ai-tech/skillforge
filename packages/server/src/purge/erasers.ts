import { bumpRegistryEpoch } from "../registry-epoch.ts";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../repo.ts";
import { unlinkRunOutputIfUnreferenced } from "../runs/outputs.ts";
import { LEDGER_DELETE_TRIGGER_SQL } from "../provenance/ledger.ts";

/**
 * Purge eraser registry.
 *
 * The single code path that erases per-artifact data on purge. Every table holding an
 * `artifact_id` column (or a plugin table keyed by artifact_type/artifact_name) must have one
 * entry here; tests/purge-erasers-registry.test.mjs derives the table set from the schema.
 * Entries run in array order: children before parents, audit_events last (right before the
 * route writes the `purge` audit row). A version purge runs only entries with the "version"
 * scope; a whole-artifact purge runs every entry. Entries with strategy "keep" never run.
 */

export type PurgeStrategy = "delete" | "redact" | "tombstone" | "keep";
export type PurgeScope = "artifact" | "version";

export type PurgeContext = {
  artifactId: string;
  type: string;
  name: string;
  /** null for a whole-artifact purge. */
  version: string | null;
  actor: string;
  at: string;
  /** Data directory, for erasers that remove files after COMMIT (run outputs). */
  dataDir?: string;
  /**
   * Queue a side effect (file unlink) to run after the purge transaction commits; the route
   * runs queued callbacks after COMMIT, each isolated in try/catch. Absent: no file cleanup
   * (the retention orphan sweep removes unreferenced files later).
   */
  afterCommit?: (fn: () => void) => void;
};

/**
 * SQL templates with positional parameters. The artifact template is bound to [artifactId],
 * the version template to [artifactId, version].
 */
export type PurgeSql = { artifact: string; version?: string };

export type PurgeEraser = {
  readonly table: string;
  readonly strategy: PurgeStrategy;
  readonly scopes: readonly ["artifact"] | readonly ["artifact", "version"];
  readonly erase?: (db: Database, ctx: PurgeContext) => void;
  readonly sql?: PurgeSql;
  /** Side effect of erasing this table on other subsystems (required for metric sources). */
  readonly cascade?: string;
  /** The table may be absent (plugin tables); runErasers checks sqlite_master first. */
  readonly optional?: boolean;
  /** Why the table is kept (strategy "keep" only, at least 10 characters). */
  readonly reason?: string;
};

export type RunErasersOptions = {
  /** Tables to skip in this run (used by the version purge that tombstones the last version). */
  readonly exclude?: readonly string[];
};

function tableExists(db: Database, table: string): boolean {
  return !!db
    .prepare("SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

function doomedCommentIds(db: Database, ctx: PurgeContext): string[] {
  // Include replies without their own version; they can quote the purged parent.
  const selected =
    ctx.version === null
      ? "SELECT id FROM comments WHERE artifact_id = ?"
      : `WITH RECURSIVE doomed(id) AS (
         SELECT id FROM comments WHERE artifact_id = ? AND version = ?
         UNION SELECT c.id FROM comments c JOIN doomed d ON c.parent_id = d.id
       ) SELECT id FROM doomed`;
  const args = ctx.version === null ? [ctx.artifactId] : [ctx.artifactId, ctx.version];
  return (db.prepare(selected).all(...args) as Array<{ id: string }>).map((r) => r.id);
}

function eraseNotifications(db: Database, ctx: PurgeContext): void {
  for (const id of doomedCommentIds(db, ctx)) {
    db.prepare("DELETE FROM notifications WHERE comment_id = ?").run(id);
  }
  if (ctx.version === null)
    db.prepare("DELETE FROM notifications WHERE artifact_id = ?").run(ctx.artifactId);
  else
    db.prepare("DELETE FROM notifications WHERE artifact_id = ? AND version = ?").run(
      ctx.artifactId,
      ctx.version,
    );
}

function eraseComments(db: Database, ctx: PurgeContext): void {
  // Remove child rows first to respect the parent reference if FK enforcement is enabled.
  for (const id of doomedCommentIds(db, ctx).reverse())
    db.prepare("DELETE FROM comments WHERE id = ?").run(id);
}

function eraseReviewRuns(db: Database, ctx: PurgeContext): void {
  const predicate =
    ctx.version === null
      ? "artifact_type = ? AND artifact_name = ?"
      : "artifact_type = ? AND artifact_name = ? AND version = ?";
  const args = ctx.version === null ? [ctx.type, ctx.name] : [ctx.type, ctx.name, ctx.version];
  db.prepare(
    `DELETE FROM ext_review_assistant_findings WHERE run_id IN (SELECT id FROM ext_review_assistant_runs WHERE ${predicate})`,
  ).run(...args);
  db.prepare(`DELETE FROM ext_review_assistant_runs WHERE ${predicate}`).run(...args);
}

function eraseEvalRuns(db: Database, ctx: PurgeContext): void {
  if (ctx.version !== null) {
    // Version purge: erase runs/results tied to this version as candidate or baseline.
    // eval_suites/eval_cases are artifact-scoped so gate: required is not silently removed.
    db.prepare(
      `DELETE FROM eval_results WHERE run_id IN (
         SELECT id FROM eval_runs WHERE artifact_id = ? AND (version = ? OR against = ?)
       )`,
    ).run(ctx.artifactId, ctx.version, ctx.version);
    db.prepare("DELETE FROM eval_runs WHERE artifact_id = ? AND (version = ? OR against = ?)").run(
      ctx.artifactId,
      ctx.version,
      ctx.version,
    );
    return;
  }
  db.prepare(
    "DELETE FROM eval_results WHERE run_id IN (SELECT id FROM eval_runs WHERE artifact_id = ?)",
  ).run(ctx.artifactId);
  db.prepare("DELETE FROM eval_runs WHERE artifact_id = ?").run(ctx.artifactId);
}

const evalBatchesWhere = (ctx: PurgeContext) => ({
  where: ctx.version === null ? "artifact_id = ?" : "artifact_id = ? AND version = ?",
  args: ctx.version === null ? [ctx.artifactId] : [ctx.artifactId, ctx.version],
});

function eraseEvalBatchRuns(db: Database, ctx: PurgeContext): void {
  const { where, args } = evalBatchesWhere(ctx);
  db.prepare(
    `DELETE FROM eval_batch_runs WHERE batch_id IN (SELECT id FROM eval_batches WHERE ${where})`,
  ).run(...args);
  // Surviving batches also lose links to runs that eraseEvalRuns removes (a version purge
  // erases runs by `version = ? OR against = ?`, so a baseline purge orphans links of other
  // batches). Runs still exist at this point — this eraser runs before eval_runs.
  const doomedRuns =
    ctx.version === null
      ? "SELECT id FROM eval_runs WHERE artifact_id = ?"
      : "SELECT id FROM eval_runs WHERE artifact_id = ? AND (version = ? OR against = ?)";
  const runArgs =
    ctx.version === null ? [ctx.artifactId] : [ctx.artifactId, ctx.version, ctx.version];
  db.prepare(`DELETE FROM eval_batch_runs WHERE run_id IN (${doomedRuns})`).run(...runArgs);
}

function eraseEvalBatches(db: Database, ctx: PurgeContext): void {
  const { where, args } = evalBatchesWhere(ctx);
  db.prepare(`DELETE FROM eval_batches WHERE ${where}`).run(...args);
}

function eraseRunOutputs(db: Database, ctx: PurgeContext): void {
  const where = ctx.version === null ? "artifact_id = ?" : "artifact_id = ? AND version = ?";
  const args = ctx.version === null ? [ctx.artifactId] : [ctx.artifactId, ctx.version];
  const shas = (
    db.prepare(`SELECT DISTINCT sha256 FROM run_outputs WHERE ${where}`).all(...args) as Array<{
      sha256: string;
    }>
  ).map((r) => r.sha256);
  db.prepare(`DELETE FROM run_outputs WHERE ${where}`).run(...args);
  const dataDir = ctx.dataDir;
  if (!shas.length || !dataDir || !ctx.afterCommit) return;
  // Content is shared by sha256 across rows: unlink only files no remaining row references,
  // checked after COMMIT so a rolled-back purge never deletes content.
  for (const sha of shas) ctx.afterCommit(() => unlinkRunOutputIfUnreferenced(db, dataDir, sha));
}

function tombstoneVersions(db: Database, ctx: PurgeContext): void {
  const versionFilter = ctx.version === null ? "" : "AND version = ?";
  const args =
    ctx.version === null
      ? [ctx.at, ctx.actor, ctx.artifactId]
      : [ctx.at, ctx.actor, ctx.artifactId, ctx.version];
  db.prepare(
    `UPDATE artifact_versions SET purged_at = ?, purged_by = ?, files = '[]',
    description = '', display_name = NULL, tags = '[]', frontmatter = NULL,
    components = NULL, changelog = NULL, evidence = '[]', quality = NULL,
    body_sha256 = NULL, warnings = '[]', model_compat = '[]'
    WHERE artifact_id = ? AND purged_at IS NULL ${versionFilter}`,
  ).run(...args);
  bumpRegistryEpoch();
}

function redactAudit(db: Database, ctx: PurgeContext): void {
  db.prepare(
    `UPDATE audit_events SET reason = NULL, meta = '{"redacted_by_purge":true}'
     WHERE artifact_id = ? AND action NOT IN ('purge', 'backup_delete')
     ${ctx.version === null ? "" : "AND (version = ? OR action = 'metadata_change')"}`,
  ).run(...(ctx.version === null ? [ctx.artifactId] : [ctx.artifactId, ctx.version]));
}

/** provenance_ledger is append-only: the DELETE trigger is dropped, rows erased,
 *  then the trigger is recreated (all inside the purge transaction). */
function eraseProvenanceLedger(db: Database, ctx: PurgeContext): void {
  db.exec("DROP TRIGGER IF EXISTS pl_no_delete");
  try {
    if (ctx.version === null) {
      db.prepare("DELETE FROM provenance_ledger WHERE artifact_id = ?").run(ctx.artifactId);
    } else {
      db.prepare("DELETE FROM provenance_ledger WHERE artifact_id = ? AND version = ?").run(
        ctx.artifactId,
        ctx.version,
      );
    }
  } finally {
    db.exec(LEDGER_DELETE_TRIGGER_SQL);
  }
}

const registry: PurgeEraser[] = [
  {
    table: "provenance_ledger",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseProvenanceLedger,
    optional: true,
    cascade: "drops+recreates pl_no_delete trigger (append-only bypass for purge)",
  },
  {
    table: "notifications",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseNotifications,
  },
  {
    table: "comments",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseComments,
  },
  {
    table: "ext_review_assistant_runs",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseReviewRuns,
    optional: true,
  },
  {
    table: "eval_batch_runs",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseEvalBatchRuns,
    optional: true,
    cascade: "links removed before eval_batches/eval_runs (FK children first)",
  },
  {
    table: "eval_batches",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseEvalBatches,
    optional: true,
  },
  {
    table: "eval_runs",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseEvalRuns,
    optional: true,
  },
  {
    table: "eval_cases",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM eval_cases WHERE artifact_id = ?" },
    optional: true,
  },
  {
    table: "eval_suites",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM eval_suites WHERE artifact_id = ?" },
    optional: true,
  },
  {
    table: "run_outputs",
    strategy: "delete",
    scopes: ["artifact", "version"],
    erase: eraseRunOutputs,
    optional: true,
    cascade:
      "run output files under data/run-outputs are unlinked after COMMIT when no row references them",
  },
  {
    table: "workflow_run_steps",
    strategy: "delete",
    scopes: ["artifact"],
    sql: {
      artifact: `DELETE FROM workflow_run_steps WHERE run_id IN
        (SELECT id FROM workflow_runs WHERE artifact_id = ?)`,
    },
    optional: true,
  },
  {
    table: "workflow_runs",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM workflow_runs WHERE artifact_id = ?" },
    optional: true,
    cascade:
      "run outputs of workflow steps (run_kind 'workflow', run_id 'wf:<id>') are erased by the run_outputs eraser",
  },
  {
    table: "workflows",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM workflows WHERE artifact_id = ?" },
    optional: true,
  },
  {
    table: "routine_runs",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM routine_runs WHERE artifact_id = ?" },
    optional: true,
    cascade:
      "run outputs of routine runs (run_kind 'routine', run_id 'rt:<id>') are erased by the run_outputs eraser",
  },
  {
    table: "routines",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM routines WHERE artifact_id = ?" },
    optional: true,
    cascade: "isolated state dir <dataDir>/routines/<artifactId> is removed after COMMIT",
    erase: (db, ctx) => {
      db.prepare("DELETE FROM routines WHERE artifact_id = ?").run(ctx.artifactId);
      const dataDir = ctx.dataDir;
      if (!dataDir || !ctx.afterCommit) return;
      ctx.afterCommit(() => {
        try {
          rmSync(join(dataDir, "routines", ctx.artifactId), { recursive: true, force: true });
        } catch {
          /* state dir cleanup is best effort */
        }
      });
    },
  },
  {
    table: "hook_decisions",
    strategy: "delete",
    scopes: ["artifact"],
    sql: {
      artifact:
        "DELETE FROM hook_decisions WHERE subscription_id IN (SELECT id FROM hook_subscriptions WHERE artifact_id = ?)",
    },
    optional: true,
  },
  {
    table: "hook_subscriptions",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM hook_subscriptions WHERE artifact_id = ?" },
    optional: true,
    cascade: "materialized env dir <dataDir>/hook-env/<subscription_id> is removed after COMMIT",
    erase: (db, ctx) => {
      const subs = db
        .prepare("SELECT id FROM hook_subscriptions WHERE artifact_id = ?")
        .all(ctx.artifactId) as Array<{ id: number | bigint }>;
      db.prepare("DELETE FROM hook_subscriptions WHERE artifact_id = ?").run(ctx.artifactId);
      const dataDir = ctx.dataDir;
      if (!dataDir || !ctx.afterCommit) return;
      for (const s of subs) {
        const dir = join(dataDir, "hook-env", String(s.id));
        ctx.afterCommit(() => {
          try {
            rmSync(dir, { recursive: true, force: true });
          } catch {
            /* env dir cleanup is best effort */
          }
        });
      }
    },
  },
  {
    table: "session_facts",
    strategy: "delete",
    scopes: ["artifact", "version"],
    sql: {
      artifact: "DELETE FROM session_facts WHERE artifact_id = ?",
      version: "DELETE FROM session_facts WHERE artifact_id = ? AND version = ?",
    },
    cascade:
      "usage metrics (metrics dashboard, cabinet) and lifecycle-by-data activity signals drop the purged facts; cached use_count/help_count are not recomputed",
  },
  {
    table: "artifact_usage_reports",
    strategy: "delete",
    scopes: ["artifact", "version"],
    sql: {
      artifact: "DELETE FROM artifact_usage_reports WHERE artifact_id = ?",
      version: "DELETE FROM artifact_usage_reports WHERE artifact_id = ? AND version = ?",
    },
    cascade:
      "usage metrics and lifecycle-by-data activity signals drop the purged reports; cached use_count/help_count are not recomputed",
  },
  {
    table: "artifact_watchers",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM artifact_watchers WHERE artifact_id = ?" },
  },
  {
    table: "artifact_badges",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM artifact_badges WHERE artifact_id = ?" },
  },
  {
    table: "artifact_overlays",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM artifact_overlays WHERE artifact_id = ?" },
  },
  {
    table: "artifact_availability",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM artifact_availability WHERE artifact_id = ?" },
  },
  {
    table: "lifecycle_holds",
    strategy: "delete",
    scopes: ["artifact"],
    sql: { artifact: "DELETE FROM lifecycle_holds WHERE artifact_id = ?" },
  },
  {
    table: "artifact_maintainers",
    strategy: "keep",
    scopes: ["artifact"],
    reason:
      "tombstone ownership and the audit of ownership transitions need the maintainer list; usernames are not leaked content",
  },
  {
    table: "artifact_versions",
    strategy: "tombstone",
    scopes: ["artifact", "version"],
    erase: tombstoneVersions,
  },
  {
    table: "audit_events",
    strategy: "redact",
    scopes: ["artifact", "version"],
    erase: redactAudit,
  },
];

/** Built-in erasers plus those added with registerEraser(), in execution order. */
export const PURGE_ERASERS: readonly PurgeEraser[] = registry;

const STRATEGIES: readonly PurgeStrategy[] = ["delete", "redact", "tombstone", "keep"];

function hasScope(entry: PurgeEraser, scope: PurgeScope): boolean {
  return (entry.scopes as readonly PurgeScope[]).includes(scope);
}

function validateEraser(entry: PurgeEraser): void {
  if (!entry.table || !/^\w+$/u.test(entry.table))
    throw new Error(`purge eraser: invalid table name ${JSON.stringify(entry.table)}`);
  if (registry.some((e) => e.table === entry.table))
    throw new Error(`purge eraser: table ${entry.table} is already registered`);
  if (!STRATEGIES.includes(entry.strategy))
    throw new Error(`purge eraser ${entry.table}: unknown strategy ${String(entry.strategy)}`);
  if (!hasScope(entry, "artifact"))
    throw new Error(`purge eraser ${entry.table}: scopes must include "artifact"`);
  if (entry.strategy === "keep") {
    if (!entry.reason || entry.reason.trim().length < 10)
      throw new Error(`purge eraser ${entry.table}: strategy "keep" requires a reason`);
    return;
  }
  if (!entry.erase && !entry.sql)
    throw new Error(`purge eraser ${entry.table}: needs erase or sql`);
  if (!entry.erase && hasScope(entry, "version") && !entry.sql?.version)
    throw new Error(`purge eraser ${entry.table}: version scope needs sql.version`);
}

/**
 * Register an eraser for a subsystem table (call at startup). The entry runs after the built-in
 * child tables and before audit_events. Registering a table twice is an error.
 */
export function registerEraser(entry: PurgeEraser): void {
  validateEraser(entry);
  const auditIndex = registry.findIndex((e) => e.table === "audit_events");
  registry.splice(auditIndex < 0 ? registry.length : auditIndex, 0, entry);
}

/**
 * Run the registered erasers inside the caller's transaction (the purge route holds
 * BEGIN IMMEDIATE). Returns the tables that were processed.
 */
export function runErasers(
  db: Database,
  ctx: PurgeContext,
  options: RunErasersOptions = {},
): string[] {
  const scope: PurgeScope = ctx.version === null ? "artifact" : "version";
  const done: string[] = [];
  for (const entry of registry) {
    if (entry.strategy === "keep") continue;
    if (!hasScope(entry, scope)) continue;
    if (options.exclude?.includes(entry.table)) continue;
    if (entry.optional && !tableExists(db, entry.table)) continue;
    if (entry.erase) entry.erase(db, ctx);
    else if (entry.sql) {
      if (ctx.version === null) db.prepare(entry.sql.artifact).run(ctx.artifactId);
      else if (entry.sql.version) db.prepare(entry.sql.version).run(ctx.artifactId, ctx.version);
    }
    done.push(entry.table);
  }
  return done;
}
