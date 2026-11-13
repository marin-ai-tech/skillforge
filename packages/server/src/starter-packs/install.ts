import { ensureSourceForArtifact, setEditsIfEmpty } from "../tracked/store.ts";
import type { Database } from "../repo.ts";
import { getArtifactByTypeName, hasDigest } from "../repo.ts";
import { preparePublish, publishArtifact } from "../publish.ts";
import type { Role } from "../auth/users.ts";
import {
  findStarterPack,
  readSkillPublishFiles,
  type PackArtifact,
  type StarterPack,
} from "./load.ts";

export type InstallResultItem = {
  type: string;
  name: string;
  status: "created" | "exists" | "failed";
  version?: string;
  quality?: { score: number; grade: string };
  error?: string;
  owner?: string;
};

function provenanceRef(a: PackArtifact): string {
  return `${a.repo}@${a.commit}:${a.source_path}`;
}

/** Count artifacts whose current digest is already published. */
export function countInstalled(db: Database, pack: StarterPack): number {
  let n = 0;
  for (const a of pack.artifacts) {
    const files = readSkillPublishFiles(pack.dir, a);
    if (!files) continue;
    const prepared = preparePublish(db, { type: "skill", files });
    if (prepared.kind !== "prepared" || !prepared.ok || !prepared.artifact) continue;
    const row = getArtifactByTypeName(db, "skill", prepared.artifact.name);
    if (row && hasDigest(db, row.id, prepared.artifact.digest)) n += 1;
  }
  return n;
}

/** The pack's local changes become the edit rules of the artifact's tracked source (tracked-sources). */
function keepPackEdits(db: Database, a: PackArtifact): void {
  const row = getArtifactByTypeName(db, "skill", a.name);
  if (!row) return;
  if (ensureSourceForArtifact(db, row.id) && a.edits?.length) setEditsIfEmpty(db, row.id, a.edits);
}

export function installStarterPack(
  db: Database,
  dataDir: string,
  packsRoot: string,
  packId: string,
  actor: string,
  role: Role,
): { ok: true; results: InstallResultItem[] } | { ok: false; status: 404 } {
  const pack = findStarterPack(packsRoot, packId);
  if (!pack) return { ok: false, status: 404 };

  const results: InstallResultItem[] = [];
  for (const a of pack.artifacts) {
    const files = readSkillPublishFiles(pack.dir, a);
    if (!files) {
      results.push({
        type: "skill",
        name: a.name,
        status: "failed",
        error: "skill files missing or path escaped",
      });
      continue;
    }
    const published = publishArtifact(
      { db, dataDir, actor, role },
      {
        type: "skill",
        files,
        provenance: { source: "import", ref: provenanceRef(a) },
      },
    );
    keepPackEdits(db, a);
    if (published.kind === "created") {
      results.push({
        type: "skill",
        name: a.name,
        status: "created",
        version: published.version.version,
        quality: published.quality
          ? { score: published.quality.score, grade: published.quality.grade }
          : undefined,
      });
      continue;
    }
    if (published.kind === "digest_exists") {
      results.push({ type: "skill", name: a.name, status: "exists" });
      continue;
    }
    if (published.kind === "not_owner") {
      results.push({
        type: "skill",
        name: a.name,
        status: "failed",
        error: "not_owner",
        owner: published.owner,
      });
      continue;
    }
    if (published.kind === "validation_failed") {
      results.push({
        type: "skill",
        name: a.name,
        status: "failed",
        error: published.errors.map((e) => e.message).join("; ") || "validation_failed",
      });
      continue;
    }
    results.push({
      type: "skill",
      name: a.name,
      status: "failed",
      error: published.kind === "bad_request" ? published.message : published.kind,
    });
  }
  return { ok: true, results };
}
