import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { isArtifactType } from "@skillforge/core";
import { appendSystemEvent } from "../audit/journal.ts";
import { requireUser } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { isMaintainer } from "../ownership.ts";
import { getArtifactByTypeName } from "../repo.ts";
import { canView } from "../visibility/index.ts";
import { checkSource } from "../tracked/check.ts";
import { parseEdits, type SourceEdit } from "../tracked/edits.ts";
import { getSource, updateSource, type TrackedSource } from "../tracked/store.ts";

/** Tracked source of an artifact (tracked-sources): read by whoever sees the artifact, changed by its owner or an admin. */
type Params = { type: string; name: string };
type Patch = { enabled?: boolean; ref?: string | null; edits?: SourceEdit[] };

const REF_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const PATCH_KEYS = new Set(["enabled", "ref", "edits"]);

function view(s: TrackedSource) {
  const { artifact_id: _id, ...rest } = s;
  return rest;
}

function parsePatch(body: unknown): Patch | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(b).some((k) => !PATCH_KEYS.has(k))
  )
    return null;
  const patch: Patch = {};
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return null;
    patch.enabled = b.enabled;
  }
  if (b.ref !== undefined) {
    const okRef =
      b.ref === null ||
      (typeof b.ref === "string" && REF_RE.test(b.ref) && !b.ref.split("/").includes(".."));
    if (!okRef) return null;
    patch.ref = b.ref as string | null;
  }
  if (b.edits !== undefined) {
    const edits = parseEdits(b.edits);
    if (!edits.ok) return null;
    patch.edits = edits.edits;
  }
  return patch;
}

export const sourceRoutes: FastifyPluginAsync<{ db: Database; config: AppConfig }> = async (
  app,
  opts,
) => {
  const { db, config } = opts;

  /** The artifact and its source, or the reply already sent (404 / 403). */
  function load(request: FastifyRequest<{ Params: Params }>, reply: FastifyReply, manage: boolean) {
    const { type, name } = request.params;
    const row = isArtifactType(type) ? getArtifactByTypeName(db, type, name) : undefined;
    if (!row || !canView(db, request.user ?? null, row)) {
      void reply.code(404).send({ error: "not_found" });
      return null;
    }
    const source = getSource(db, row.id);
    if (!source) {
      void reply.code(404).send({ error: "no_source" });
      return null;
    }
    const user = request.user!;
    if (
      manage &&
      user.username !== row.owner &&
      !isMaintainer(db, row.id, user.username) &&
      user.role !== "admin"
    ) {
      void reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return { row, source };
  }

  app.get<{ Params: Params }>("/api/v1/artifacts/:type/:name/source", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const found = load(request, reply, false);
    if (found) return reply.send({ source: view(found.source) });
  });

  app.put<{ Params: Params }>("/api/v1/artifacts/:type/:name/source", async (request, reply) => {
    if (!requireUser(request, reply)) return;
    const patch = parsePatch(request.body);
    if (!patch) return reply.code(400).send({ error: "bad_request" });
    const found = load(request, reply, true);
    if (!found) return;
    updateSource(db, found.row.id, patch);
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "source_change",
      target: `${found.row.type}/${found.row.name}`,
      meta: { fields: Object.keys(patch) },
    });
    return reply.send({ source: view(getSource(db, found.row.id)!) });
  });

  app.post<{ Params: Params }>(
    "/api/v1/artifacts/:type/:name/source/check",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const found = load(request, reply, true);
      if (!found) return;
      if (!found.source.enabled) return reply.code(409).send({ error: "source_disabled" });
      return reply.send(await checkSource(db, config, found.row.id));
    },
  );
};
