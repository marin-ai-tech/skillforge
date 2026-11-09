import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { buildSnapshot, scanServerDir } from "./scan.ts";
import { compareAgent } from "./compare.ts";
import type { Viewer } from "../visibility/index.ts";
import { agentPublicView, replaceItems, upsertAgent } from "./store.ts";
import type { DuplicateGroup } from "./duplicates.ts";

export function scanAndStore(opts: {
  db: Database;
  config: AppConfig;
  ownerId: string;
  name: string;
  serverPath: string;
  /**
   * Path actually scanned: the realpath verified by checkServerPathAgainstRoots. The stored
   * serverPath stays as requested; the walk goes over the verified real path.
   */
  scanPath?: string;
  runtime: string | null;
  kind: "server";
  viewer?: Viewer;
}):
  | {
      ok: true;
      agent: ReturnType<typeof agentPublicView>;
      compared: ReturnType<typeof compareAgent>;
      duplicates: DuplicateGroup[];
      skipped: unknown;
      invalid: unknown;
    }
  | { ok: false; status: number; error: string; message?: string } {
  const scanned = scanServerDir(opts.scanPath ?? opts.serverPath, {
    expectRealPath: opts.scanPath !== undefined,
  });
  if (!scanned.ok) {
    if (scanned.error === "not_found") {
      return { ok: false, status: 404, error: "not_found" };
    }
    return {
      ok: false,
      status: 400,
      error: scanned.error,
      ...(scanned.message ? { message: scanned.message } : {}),
    };
  }
  const scannedAt = new Date().toISOString();
  const snapshot = buildSnapshot(scanned.files, scanned.lock, opts.config.dataDir, opts.runtime);
  opts.db.exec("BEGIN");
  let agent;
  try {
    agent = upsertAgent(opts.db, {
      ownerId: opts.ownerId,
      name: opts.name,
      kind: "server",
      runtime: opts.runtime,
      serverPath: opts.serverPath,
      scannedAt,
      duplicates: snapshot.duplicates,
    });
    replaceItems(opts.db, agent.id, snapshot.items, scannedAt);
    opts.db.exec("COMMIT");
  } catch (e) {
    try {
      opts.db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
  const compared = compareAgent(opts.db, agent, { viewer: opts.viewer ?? null });
  return {
    ok: true,
    agent: agentPublicView(agent),
    compared,
    duplicates: snapshot.duplicates,
    skipped: [...scanned.skipped, ...snapshot.skipped],
    invalid: snapshot.invalid,
  };
}
