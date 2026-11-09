import {
  assessQuality,
  QUALITY_ALGORITHM,
  isArtifactType,
  type ParsedArtifact,
} from "@skillforge/core";
import { hasBlob, readBlob } from "../blobs.ts";
import {
  listVersionsNeedingQuality,
  setVersionQuality,
  type Database,
  type VersionForQuality,
} from "../repo.ts";
/** Rebuilds the parsed view of a stored version from its blobs; null if any blob is missing. */
function artifactFromVersion(dataDir: string, v: VersionForQuality): ParsedArtifact | null {
  if (!isArtifactType(v.type)) return null;
  const canonical: ParsedArtifact["canonical"] = [];
  for (const f of v.files) {
    if (!hasBlob(dataDir, f.sha256)) return null;
    canonical.push({ path: f.path, content: readBlob(dataDir, f.sha256) });
  }
  return {
    type: v.type,
    name: v.name,
    description: v.description,
    displayName: null,
    tags: [],
    frontmatter: v.frontmatter,
    files: v.files,
    canonical,
    digest: "",
  };
}

/**
 * Computes quality reports for versions that have none or were scored by an older algorithm.
 * Synchronous: callers run it before the server starts accepting requests.
 */
export function backfillQuality(db: Database, dataDir: string): number {
  let updated = 0;
  for (const v of listVersionsNeedingQuality(db, QUALITY_ALGORITHM)) {
    const artifact = artifactFromVersion(dataDir, v);
    if (artifact === null) continue;
    setVersionQuality(db, v.id, assessQuality(artifact));
    updated += 1;
  }
  return updated;
}
