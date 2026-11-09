import {
  descriptionSimilarity,
  mainFilePath,
  isArtifactType,
  type ArtifactType,
} from "@skillforge/core";
import type { LatestVersionForDuplicates } from "../repo.ts";

export type DuplicateKind =
  "name_collision" | "identical_body" | "shared_files" | "similar_description";

export type RegistryDuplicate = {
  kind: DuplicateKind;
  type: string;
  name: string;
  detail: Record<string, unknown>;
};

/** What duplicate detection needs to know about the artifact being checked. */
export type DuplicateCandidate = {
  type: ArtifactType;
  name: string;
  description: string;
  body_sha256: string | null;
  files: Array<{ path: string; sha256: string; size: number }>;
};

export const SHARED_FILE_MIN_SIZE = 256;
export const SHARED_FILES_MAX_PATHS = 5;
export const SIMILAR_DESCRIPTION_THRESHOLD = 0.6;

const KIND_ORDER: Record<DuplicateKind, number> = {
  name_collision: 0,
  identical_body: 1,
  shared_files: 2,
  similar_description: 3,
};

function sharedFileDigests(
  files: DuplicateCandidate["files"],
  mainPath: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    if (f.path === mainPath || f.size < SHARED_FILE_MIN_SIZE) continue;
    const paths = out.get(f.sha256) ?? [];
    paths.push(f.path);
    out.set(f.sha256, paths);
  }
  return out;
}

function sameBody(candidate: DuplicateCandidate, other: LatestVersionForDuplicates): boolean {
  return (
    candidate.body_sha256 !== null &&
    other.body_sha256 !== null &&
    candidate.body_sha256 === other.body_sha256
  );
}

/** Candidate paths whose non-main, large-enough file digests also occur in `other`. */
function sharedPathsWith(
  other: LatestVersionForDuplicates,
  myFiles: Map<string, string[]>,
): string[] {
  const otherMain = isArtifactType(other.type) ? mainFilePath(other.type, other.name) : "";
  const paths: string[] = [];
  for (const f of other.files) {
    if (f.path === otherMain || f.size < SHARED_FILE_MIN_SIZE) continue;
    for (const p of myFiles.get(f.sha256) ?? []) if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

/**
 * Compares a candidate against the latest versions of other artifacts (same type+name excluded).
 * Never throws for odd data; ordering: kind → type → name.
 */
export function findRegistryDuplicates(
  candidate: DuplicateCandidate,
  others: LatestVersionForDuplicates[],
): RegistryDuplicate[] {
  const out: RegistryDuplicate[] = [];
  const myFiles = sharedFileDigests(candidate.files, mainFilePath(candidate.type, candidate.name));

  for (const other of others) {
    if (other.type === candidate.type && other.name === candidate.name) continue;

    if (other.name === candidate.name) {
      out.push({ kind: "name_collision", type: other.type, name: other.name, detail: {} });
    }
    if (sameBody(candidate, other)) {
      out.push({ kind: "identical_body", type: other.type, name: other.name, detail: {} });
    }
    if (myFiles.size > 0) {
      const paths = sharedPathsWith(other, myFiles);
      if (paths.length > 0) {
        out.push({
          kind: "shared_files",
          type: other.type,
          name: other.name,
          detail: { paths: paths.sort().slice(0, SHARED_FILES_MAX_PATHS) },
        });
      }
    }
    const score = descriptionSimilarity(candidate.description, other.description);
    if (score >= SIMILAR_DESCRIPTION_THRESHOLD) {
      out.push({
        kind: "similar_description",
        type: other.type,
        name: other.name,
        detail: { score },
      });
    }
  }

  return out.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.type.localeCompare(b.type) ||
      a.name.localeCompare(b.name),
  );
}
