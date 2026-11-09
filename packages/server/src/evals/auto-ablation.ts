// Ablation runner.
// On publish of a skill version, with SKILLFORGE_EVAL_ABLATION_AUTO=true and
// at least one task case in the suite, schedule an eval batch kind "ablation"
// via the eval-orchestrator (single-flight queue + daily limit preserved).
// Done runs write ablation evidence, which feeds the lifecycle zombie rule
// `no_ablation_uplift`. Failures never break the publish response.
import type { Database } from "../db.ts";
import type { AppConfig } from "../config.ts";
import { listSuiteCases } from "./suite.ts";
import { loadRunnersFile } from "./runner.ts";
import { createBatch } from "./batch.ts";

export function maybeAutoAblation(
  db: Database,
  config: AppConfig,
  opts: { artifactId: string; type: string; name: string; version: string; actor: string },
): void {
  try {
    if (!config.evalAblationAuto || opts.type !== "skill") return;
    if (!config.evalRunnersFile || loadRunnersFile(config.evalRunnersFile).runners.length === 0) {
      return;
    }
    if (!listSuiteCases(db, opts.artifactId).some((c) => c.kind === "task")) return;
    const active = db
      .prepare(
        `SELECT 1 AS n FROM eval_batches
         WHERE artifact_id = ? AND version = ? AND kind = 'ablation'
           AND status IN ('queued','running') LIMIT 1`,
      )
      .get(opts.artifactId, opts.version);
    if (active) return;
    createBatch(db, config, {
      artifactId: opts.artifactId,
      type: opts.type,
      name: opts.name,
      actor: opts.actor,
      body: { kind: "ablation", version: opts.version },
      auto: true,
    });
  } catch {
    /* auto-ablation must never break publish */
  }
}
