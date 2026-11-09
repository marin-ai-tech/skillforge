import { mainFileFingerprint, mainFilePath, isArtifactType } from "@skillforge/core";
import { hasBlob, readBlob } from "../blobs.ts";
import {
  listVersionsNeedingBodyFingerprint,
  setVersionBodySha256,
  type Database,
} from "../repo.ts";

/**
 * Computes `body_sha256` for versions that have none (published before the column existed).
 * Synchronous: callers run it before the server starts accepting requests.
 */
export function backfillBodyFingerprints(db: Database, dataDir: string): number {
  let updated = 0;
  for (const v of listVersionsNeedingBodyFingerprint(db)) {
    if (!isArtifactType(v.type)) continue;
    const main = mainFilePath(v.type, v.name);
    const file = v.files.find((f) => f.path === main);
    if (!file || !hasBlob(dataDir, file.sha256)) continue;
    setVersionBodySha256(db, v.id, mainFileFingerprint(v.type, readBlob(dataDir, file.sha256)));
    updated += 1;
  }
  return updated;
}
