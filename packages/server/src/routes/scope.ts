import { bumpRegistryEpoch } from "../registry-epoch.ts";
import type { FastifyPluginAsync } from "fastify";
import { actorFromRequest } from "../actor.ts";
import { requireUser } from "../auth/guard.ts";
import { roleAtLeast } from "../auth/users.ts";
import { canPublishVersion } from "../ownership.ts";
import { isArtifactType } from "@skillforge/core";
import { appendAudit, getArtifactByTypeName, type ArtifactRow, type Database } from "../repo.ts";
import { getTeamByName, teamRoleByUsername } from "../teams.ts";

const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LABELS = 20;
const MAX_LABEL_LEN = 32;

export type ScopeRoutesOpts = { db: Database };

function parseLabels(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LABELS) return null;
  const seen = new Set<string>();
  for (const label of raw) {
    if (
      typeof label !== "string" ||
      label.length === 0 ||
      label.length > MAX_LABEL_LEN ||
      !LABEL_RE.test(label) ||
      seen.has(label)
    ) {
      return null;
    }
    seen.add(label);
  }
  return raw as string[];
}

type Visibility = "org" | "team";
type ScopeChange = { visibility: Visibility; ownerTeam: string | null; reason: string | null };
type ScopeBodyResult =
  { ok: true; value: ScopeChange } | { ok: false; status: number; body: Record<string, unknown> };

function normalizeOwnerTeam(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" ? value : null;
}

function parseScopeBody(db: Database, raw: unknown): ScopeBodyResult {
  const body = (raw ?? {}) as {
    visibility?: unknown;
    owner_team?: unknown;
    reason?: unknown;
  };
  const visibility = body.visibility;
  if (visibility !== "org" && visibility !== "team") {
    return {
      ok: false,
      status: 400,
      body: { error: "bad_request", message: "visibility must be 'org' or 'team'" },
    };
  }
  const ownerTeam = normalizeOwnerTeam(body.owner_team);
  if (visibility === "team") {
    if (!ownerTeam) return { ok: false, status: 422, body: { error: "team_required" } };
    if (!getTeamByName(db, ownerTeam)) {
      return { ok: false, status: 422, body: { error: "team_unknown" } };
    }
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim() !== "" ? body.reason.trim() : null;
  return { ok: true, value: { visibility: visibility as Visibility, ownerTeam, reason } };
}

function mayChangeScope(
  db: Database,
  row: Pick<ArtifactRow, "owner" | "owner_team">,
  actor: string,
  role: Parameters<typeof roleAtLeast>[0],
  targetTeam: string | null,
): boolean {
  if (roleAtLeast(role, "admin")) return true;
  const currentTeam = row.owner_team;
  const actorCurrentRole = currentTeam ? teamRoleByUsername(db, currentTeam, actor) : null;
  const actorTargetRole = targetTeam ? teamRoleByUsername(db, targetTeam, actor) : null;
  // Current team may be absent (org artifact): then only membership in the target team is required,
  // otherwise an owner who opened an artifact could never narrow it back (found in the phase-3 simulation).
  if (
    row.owner === actor &&
    (currentTeam === null || actorCurrentRole !== null) &&
    actorTargetRole !== null
  ) {
    return true;
  }
  return actorCurrentRole === "lead";
}

/** false = the artifact disappeared before BEGIN IMMEDIATE. */
function writeScope(
  db: Database,
  type: string,
  name: string,
  change: { visibility: Visibility; targetTeam: string | null; reason: string | null },
  actor: string,
): boolean {
  const { visibility, targetTeam, reason } = change;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const fresh = getArtifactByTypeName(db, type, name);
    if (!fresh) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare(
      "UPDATE artifacts SET visibility = ?, owner_team = ?, updated_at = ? WHERE id = ?",
    ).run(visibility, targetTeam, now, fresh.id);
    bumpRegistryEpoch();
    appendAudit(db, {
      ts: now,
      actor,
      artifact_id: fresh.id,
      version: null,
      action: "scope_change",
      reason,
      meta: {
        from: { visibility: fresh.visibility, owner_team: fresh.owner_team },
        to: { visibility, owner_team: targetTeam },
      },
    });
    db.exec("COMMIT");
    return true;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  }
}

export const scopeRoutes: FastifyPluginAsync<ScopeRoutesOpts> = async (app, opts) => {
  const { db } = opts;

  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/scope",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const { type, name } = request.params;
      if (!isArtifactType(type)) return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      if (!row) return reply.code(404).send({ error: "not_found" });

      const parsed = parseScopeBody(db, request.body);
      if (!parsed.ok) return reply.code(parsed.status).send(parsed.body);
      const { visibility, ownerTeam, reason } = parsed.value;

      const actor = actorFromRequest(request);
      const targetTeam = visibility === "team" ? ownerTeam : null;
      if (!mayChangeScope(db, row, actor, request.user.role, targetTeam)) {
        return reply.code(403).send({ error: "forbidden" });
      }

      if (!writeScope(db, type, name, { visibility, targetTeam, reason }, actor)) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.send({ visibility, owner_team: targetTeam });
    },
  );

  app.put<{ Params: { type: string; name: string } }>(
    "/api/v1/artifacts/:type/:name/labels",
    async (request, reply) => {
      if (!requireUser(request, reply)) return;
      const { type, name } = request.params;
      if (!isArtifactType(type)) return reply.code(404).send({ error: "not_found" });
      const row = getArtifactByTypeName(db, type, name);
      if (!row) return reply.code(404).send({ error: "not_found" });

      const body = (request.body ?? {}) as { labels?: unknown };
      const labels = parseLabels(body.labels);
      if (labels === null) return reply.code(400).send({ error: "labels_invalid" });

      const actor = actorFromRequest(request);
      const role = request.user.role;
      const right = canPublishVersion(db, actor, role, { id: row.id, owner: row.owner });
      if (!right.allowed) return reply.code(403).send({ error: "not_owner" });

      const from: string[] = (() => {
        try {
          const parsed = JSON.parse(row.labels);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

      const now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const fresh = getArtifactByTypeName(db, type, name);
        if (!fresh) {
          db.exec("ROLLBACK");
          return reply.code(404).send({ error: "not_found" });
        }
        db.prepare("UPDATE artifacts SET labels = ?, updated_at = ? WHERE id = ?").run(
          JSON.stringify(labels),
          now,
          fresh.id,
        );
        bumpRegistryEpoch();
        appendAudit(db, {
          ts: now,
          actor,
          artifact_id: fresh.id,
          version: null,
          action: "labels_change",
          meta: { from, to: labels },
        });
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        throw e;
      }
      return reply.send({ labels });
    },
  );
};
