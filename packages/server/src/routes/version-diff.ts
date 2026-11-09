import type { FastifyPluginAsync } from "fastify";
import semver from "semver";
import { unifiedDiff } from "@skillforge/core";
import { hasBlob, readBlob } from "../blobs.ts";
import type { AppConfig } from "../config.ts";
import { getArtifactByTypeName, listVersions, type Database, type VersionDetail } from "../repo.ts";

/**
 * What changed between two versions. Visibility is checked by the global gate
 * for every `/:type/:name` route before this handler runs.
 */
type FileDiff = {
  path: string;
  status: "added" | "removed" | "modified" | "unchanged";
  binary?: true;
  too_large?: true;
  diff?: string;
};

const decoder = new TextDecoder("utf-8", { fatal: true });

function textOf(dataDir: string, sha: string): string | null {
  if (!hasBlob(dataDir, sha)) return null;
  const bytes = readBlob(dataDir, sha);
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function modified(dataDir: string, path: string, shaA: string, shaB: string): FileDiff {
  const a = textOf(dataDir, shaA);
  const b = textOf(dataDir, shaB);
  if (a === null || b === null) return { path, status: "modified", binary: true };
  const diff = unifiedDiff(a, b);
  return diff === null
    ? { path, status: "modified", too_large: true }
    : { path, status: "modified", diff };
}

function diffFiles(dataDir: string, from: VersionDetail, to: VersionDetail): FileDiff[] {
  const before = new Map(from.files.map((f) => [f.path, f.sha256]));
  const after = new Map(to.files.map((f) => [f.path, f.sha256]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.map((path): FileDiff => {
    const a = before.get(path);
    const b = after.get(path);
    if (a === undefined) return { path, status: "added" };
    if (b === undefined) return { path, status: "removed" };
    return a === b ? { path, status: "unchanged" } : modified(dataDir, path, a, b);
  });
}

/** `to` defaults to the latest version, `from` to the highest version below it. */
function pickVersions(
  versions: VersionDetail[],
  latest: string | null,
  query: { from?: string; to?: string },
): { from?: VersionDetail; to?: VersionDetail } {
  const live = versions.filter((v) => !v.purged);
  const find = (v: string | undefined) => live.find((x) => x.version === v);
  const to = find(query.to ?? latest ?? undefined);
  if (query.from !== undefined || !to) return { from: find(query.from), to };
  const below = live
    .filter((v) => semver.valid(v.version) && semver.lt(v.version, to.version))
    .sort((x, y) => semver.rcompare(x.version, y.version));
  return { from: below[0], to };
}

export const versionDiffRoutes: FastifyPluginAsync<{ db: Database; config: AppConfig }> = async (
  app,
  opts,
) => {
  const { db, config } = opts;
  app.get<{ Params: { type: string; name: string }; Querystring: { from?: string; to?: string } }>(
    "/api/v1/artifacts/:type/:name/diff",
    async (request, reply) => {
      const row = getArtifactByTypeName(db, request.params.type, request.params.name);
      if (!row) return reply.code(404).send({ error: "not_found" });
      const versions = listVersions(db, row.id);
      const q = request.query ?? {};
      if (
        q.to === undefined &&
        q.from === undefined &&
        versions.filter((v) => !v.purged).length < 2
      ) {
        return reply.code(409).send({ error: "nothing_to_compare" });
      }
      const { from, to } = pickVersions(versions, row.latest_version, q);
      if (!from || !to) return reply.code(404).send({ error: "not_found" });
      const files = diffFiles(config.dataDir, from, to);
      const count = (s: FileDiff["status"]) => files.filter((f) => f.status === s).length;
      return reply.send({
        from: from.version,
        to: to.version,
        files,
        summary: {
          added: count("added"),
          removed: count("removed"),
          modified: count("modified"),
          unchanged: count("unchanged"),
        },
      });
    },
  );
};
