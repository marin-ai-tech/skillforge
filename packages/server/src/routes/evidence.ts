import type { FastifyPluginAsync } from "fastify";
import { isArtifactType, type ArtifactType } from "@skillforge/core";
import { actorFromRequest } from "../actor.ts";
import { requireUser } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import {
  appendEvidence,
  parseEvidenceInput,
  readEvidence,
  type EvidenceDocumentText,
  type EvidenceInput as EvidenceValue,
} from "../evidence/evidence.ts";
import { hasBlob, putBlob, readBlob } from "../blobs.ts";
import { parseUsageInput, recordUsage, usageResponse, usageSummary } from "../evidence/usage.ts";
import { canPublishVersion } from "../ownership.ts";
import { appendAudit, getArtifactByTypeName, type Database } from "../repo.ts";

export type EvidencePluginOpts = {
  db: Database;
  config: AppConfig;
};

type EvidenceInput = {
  actor: string;
  role: Parameters<typeof canPublishVersion>[2];
  type: ArtifactType;
  name: string;
  versionParam: string;
  value: EvidenceValue;
  document?: EvidenceDocumentText;
  dataDir: string;
};

/** Registry path of an evidence document; it passes the evidence URL check and the Evidence tab links it. */
function documentUrl(type: string, name: string, version: string, sha: string): string {
  return `/api/v1/artifacts/${type}/${name}/versions/${encodeURIComponent(version)}/evidence/documents/${sha}`;
}

/** Stores the document text as a blob and points the record at it (evidence-documents). */
function withDocument(input: EvidenceInput, version: string): EvidenceValue {
  const doc = input.document;
  if (!doc) return input.value;
  const bytes = Buffer.from(doc.text, "utf8");
  const sha = putBlob(input.dataDir, bytes);
  return {
    ...input.value,
    url: documentUrl(input.type, input.name, version, sha),
    document: { name: doc.name, sha256: sha, size: bytes.byteLength },
  };
}

type EvidenceOutcome = { ok: boolean; status: number; body: Record<string, unknown> };

function evidenceFail(status: number, error: string): EvidenceOutcome {
  return { ok: false, status, body: { error } };
}

/** Runs inside BEGIN IMMEDIATE; the caller commits on ok and rolls back otherwise. */
function applyEvidence(db: Database, input: EvidenceInput): EvidenceOutcome {
  const { actor, role, type, name, versionParam } = input;
  // Rights, status and latest_version are read after BEGIN IMMEDIATE so a concurrent
  // ownership transfer or retirement cannot be missed.
  const row = getArtifactByTypeName(db, type, name);
  if (!row) return evidenceFail(404, "not_found");
  const right = canPublishVersion(db, actor, role, { id: row.id, owner: row.owner });
  if (!right.allowed) {
    return { ok: false, status: 403, body: { error: "not_owner", owner: right.owner } };
  }
  const version = versionParam === "latest" ? (row.latest_version ?? "") : versionParam;
  if (row.status === "retired") return evidenceFail(409, "artifact_retired");
  const at = new Date().toISOString();
  if (!version) return evidenceFail(404, "not_found");
  const value = withDocument(input, version);
  const result = appendEvidence(db, row.id, version, value, actor, at);
  if (result.kind === "not_found") return evidenceFail(404, "not_found");
  if (result.kind === "limit") return evidenceFail(409, "evidence_limit");
  const { kind, url } = value;
  appendAudit(db, {
    ts: at,
    actor,
    artifact_id: row.id,
    version,
    action: "evidence_add",
    meta: { kind, url },
  });
  if (right.override) {
    appendAudit(db, {
      ts: at,
      actor,
      artifact_id: row.id,
      version,
      action: "publish_override",
      meta: { by_role: role, owner: right.owner, via: "evidence_add" },
    });
  }
  return {
    ok: true,
    status: result.kind === "created" ? 201 : 200,
    body: { evidence: result.evidence, validated_at: result.validated_at },
  };
}

function findDocument(db: Database, artifactId: string, version: string, sha256: string) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const current = readEvidence(db, artifactId, version);
  return current?.evidence.find((e) => e.document?.sha256 === sha256)?.document ?? null;
}

function addEvidence(db: Database, input: EvidenceInput): EvidenceOutcome {
  db.exec("BEGIN IMMEDIATE");
  try {
    const outcome = applyEvidence(db, input);
    db.exec(outcome.ok ? "COMMIT" : "ROLLBACK");
    return outcome;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  }
}

export const evidenceRoutes: FastifyPluginAsync<EvidencePluginOpts> = async (app, opts) => {
  const { db } = opts;

  // Evidence document text (evidence-documents): only a document recorded in this version's evidence; visibility is
  // the artifact preHandler's. Served as plain text so a browser never renders it as a page.
  app.get<{ Params: { type: string; name: string; version: string; sha256: string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version/evidence/documents/:sha256",
    async (request, reply) => {
      const { type, name, version: versionParam, sha256 } = request.params;
      const row = isArtifactType(type) ? getArtifactByTypeName(db, type, name) : undefined;
      const version = versionParam === "latest" ? (row?.latest_version ?? "") : versionParam;
      const doc = row && version ? findDocument(db, row.id, version, sha256) : null;
      if (!doc || !hasBlob(opts.config.dataDir, sha256)) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", `inline; filename="${doc.name}"`)
        .send(Buffer.from(readBlob(opts.config.dataDir, sha256)));
    },
  );

  app.post<{ Params: { type: string; name: string; version: string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version/evidence",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const actor = actorFromRequest(request);
      const role = request.user.role;
      const parsed = parseEvidenceInput(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
      const { type, name, version: versionParam } = request.params;
      if (!isArtifactType(type)) return reply.code(404).send({ error: "not_found" });

      const outcome = addEvidence(db, {
        actor,
        role,
        type,
        name,
        versionParam,
        value: parsed.value,
        document: parsed.document,
        dataDir: opts.config.dataDir,
      });
      return reply.code(outcome.status).send(outcome.body);
    },
  );

  app.post<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/usage",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const report = parseUsageInput(request.body);
      if (!report) return reply.code(400).send({ error: "usage_invalid" });
      const { type, name } = request.params;
      if (!isArtifactType(type)) return reply.code(404).send({ error: "not_found" });
      const result = recordUsage(db, {
        type,
        name,
        reporter: actorFromRequest(request),
        source: report.source ?? "api",
        report,
      });
      if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
      if (result.kind === "rate_limited") return reply.code(429).send({ error: "rate_limited" });
      return reply.code(result.kind === "created" ? 201 : 200).send(usageResponse(result));
    },
  );

  app.get<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/usage",
    async (request, reply) => {
      const { type, name } = request.params;
      if (!isArtifactType(type)) return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(usageSummary(db, row.id));
    },
  );
};
