import { toPublishFiles } from "../publish/files.ts";
import {
  archivesAllowed,
  freshnessOf,
  loadImportPolicy,
  recordCommitSeen,
  type Freshness,
  type ImportPolicy,
} from "./policy.ts";
import { scanImportTree } from "@skillforge/core";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.ts";
import type { Database } from "../repo.ts";
import { preparePublish, type ConflictKind } from "../publish.ts";
import { getUserById } from "../auth/users.ts";
import { materialize, type ImportSource, type MaterializedFile } from "./sources.ts";
import { newImportId, saveImport, ensureImportsRoot, type ImportMeta } from "./store.ts";

export type PreviewCandidate = {
  id: string;
  type: string;
  name: string;
  root: string;
  files: Array<{ path: string; size: number }>;
  provenance: { source: string; ref: string | null };
  dry_run: {
    ok: boolean;
    errors: unknown[];
    warnings: unknown[];
    existing: unknown;
    next_version: string | null;
    conflicts: ConflictKind[];
  };
};

export type PreviewOk = {
  ok: true;
  import_id: string;
  source: { kind: string; ref: string; commit?: string; freshness?: Freshness };
  candidates: PreviewCandidate[];
  skipped: Array<{ path: string; reason: string }>;
};

export type PreviewErr = {
  ok: false;
  error: string;
  message?: string;
  status?: number;
};

function fileSize(content: string | Uint8Array): number {
  return typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
}

/** Remap hooks/hooks.json -> hooks.json for parseHook input. */
export function filesForPrepare(
  type: string,
  files: Array<{ path: string; content: string | Uint8Array }>,
): Array<{ path: string; content: string | Uint8Array }> {
  if (type !== "hook") return files;
  return files.map((f) =>
    f.path === "hooks/hooks.json" || f.path.endsWith("/hooks/hooks.json")
      ? { path: "hooks.json", content: f.content }
      : f,
  );
}

export function pluginMetaFromTree(
  allFiles: MaterializedFile[],
  root: string,
): { name?: string; description?: string } {
  const pluginPath = root ? `${root}/.claude-plugin/plugin.json` : ".claude-plugin/plugin.json";
  const hit = allFiles.find((f) => f.path === pluginPath);
  if (!hit) return {};
  try {
    const parsed = JSON.parse(Buffer.from(hit.content).toString("utf8")) as {
      name?: unknown;
      description?: unknown;
    };
    return {
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
    };
  } catch {
    return {};
  }
}

/** What the preview says about the source; for git, when the registry first saw the commit. */
function sourceView(
  db: Database,
  policy: ImportPolicy,
  mat: { kind: string; ref: string; git?: { location_key: string; commit: string } },
): PreviewOk["source"] {
  if (!mat.git) return { kind: mat.kind, ref: mat.ref };
  const firstSeen = recordCommitSeen(db, mat.git.location_key, mat.git.commit);
  return {
    kind: mat.kind,
    ref: mat.ref,
    commit: mat.git.commit,
    freshness: freshnessOf(policy, firstSeen),
  };
}

function failedPreview(
  dataDir: string,
  importId: string,
  mat: { error: string; message?: string; status?: number },
): PreviewErr {
  try {
    fs.rmSync(path.join(dataDir, "tmp", "imports", importId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    error: mat.error,
    ...(mat.message ? { message: mat.message } : {}),
    ...(mat.status ? { status: mat.status } : {}),
  };
}

export async function previewImport(opts: {
  db: Database;
  config: AppConfig;
  userId: string;
  source: ImportSource;
}): Promise<PreviewOk | PreviewErr> {
  const { db, config, userId, source } = opts;
  const actorRow = getUserById(db, userId);
  const actor = actorRow ? { username: actorRow.username, role: actorRow.role } : null;
  const policy = loadImportPolicy(db);
  if (source.kind !== "git" && !archivesAllowed(policy, actor?.role)) {
    return { ok: false, error: "import_archives_disabled", status: 403 };
  }
  ensureImportsRoot(config.dataDir);
  const importId = newImportId();
  const workRoot = path.join(config.dataDir, "tmp", "imports", importId, "work");
  fs.mkdirSync(workRoot, { recursive: true });

  const mat = await materialize(source, config, workRoot, policy);
  if (!mat.ok) return failedPreview(config.dataDir, importId, mat);

  try {
    const scanned = scanImportTree(mat.files.map((f) => ({ path: f.path, content: f.content })));

    const candidates: PreviewCandidate[] = [];
    for (const c of scanned.candidates) {
      const preparedFiles = filesForPrepare(c.type, c.files);
      const body: Record<string, unknown> = {
        type: c.type,
        files: toPublishFiles(preparedFiles),
      };
      if (c.type === "hook") {
        const plugin = pluginMetaFromTree(mat.files, c.root);
        body.name = c.nameHint || plugin.name;
        if (plugin.description) body.description = plugin.description;
      }

      const prepared = preparePublish(db, body, actor);
      if (prepared.kind === "bad_request") {
        candidates.push({
          id: c.id,
          type: c.type,
          name: c.nameHint,
          root: c.root,
          files: c.files.map((f) => ({ path: f.path, size: fileSize(f.content) })),
          provenance: c.provenance,
          dry_run: {
            ok: false,
            errors: [{ code: "bad_request", message: prepared.message }],
            warnings: [],
            existing: null,
            next_version: null,
            conflicts: [],
          },
        });
        continue;
      }
      const name = prepared.artifact?.name ?? c.nameHint;
      const id = `${c.type}/${name}`;
      candidates.push({
        id,
        type: c.type,
        name,
        root: c.root,
        files: c.files.map((f) => ({ path: f.path, size: fileSize(f.content) })),
        provenance: c.provenance,
        dry_run: {
          ok: prepared.ok,
          errors: prepared.errors,
          warnings: prepared.warnings,
          existing: prepared.existing,
          next_version: prepared.next_version,
          conflicts: prepared.conflicts,
        },
      });
    }

    const now = new Date();
    const expires = new Date(now.getTime() + config.importTtlMinutes * 60 * 1000);
    const meta: ImportMeta = {
      user_id: userId,
      kind: mat.kind,
      ref: mat.ref,
      ...(mat.git ? { git: mat.git } : {}),
      expires_at: expires.toISOString(),
      created_at: now.toISOString(),
    };
    saveImport(config.dataDir, importId, meta, mat.files);

    return {
      ok: true,
      import_id: importId,
      source: sourceView(db, policy, mat),
      candidates,
      skipped: scanned.skipped,
    };
  } finally {
    mat.cleanup();
    try {
      fs.rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
