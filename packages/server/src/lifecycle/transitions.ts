import { bumpRegistryEpoch } from "../registry-epoch.ts";
import type { Database } from "../db.ts";
import {
  appendAudit,
  getArtifactById,
  getArtifactByTypeName,
  getVersion,
  listAudit,
  rowToSummary,
  type ArtifactSummary,
  type AuditEvent,
} from "../repo.ts";
import { canTransition, type Status } from "./machine.ts";
import { bumpMarketplaceVersion } from "../distribution/marketplace.ts";
import { emitPluginEvent } from "../plugins/events.ts";
import { actorFromUsername } from "../plugins/actor.ts";
import { notify, emitNotifications } from "../notifications/notify.ts";
import type { Role } from "../auth/users.ts";

export type TransitionOk = {
  ok: true;
  artifact: ArtifactSummary;
  event: AuditEvent;
};

export type TransitionErr = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type TransitionResult = TransitionOk | TransitionErr;

/** Who performs a transition: a user role, or `system` for automatic transitions (sweep). */
export type TransitionActorRole = Role | "system";

/**
 * The author of the latest version does not promote it to active: a non-admin gets
 * 403; an admin needs a reason (not in local single-user mode) and the audit entry is marked `self_promotion`.
 * Returns the audit meta to write, or the refusal.
 */
function selfPromotion(
  db: Database,
  row: { id: string; latest_version: string | null },
  input: TransitionInput,
): { err: TransitionErr } | { meta: Record<string, unknown> | null } {
  const meta = input.meta ?? null;
  if (input.to !== "active" || input.actorRole === "system" || !row.latest_version) return { meta };
  const version = db
    .prepare("SELECT published_by FROM artifact_versions WHERE artifact_id = ? AND version = ?")
    .get(row.id, row.latest_version) as { published_by: string } | undefined;
  if (version?.published_by !== input.actor) return { meta };
  if (input.actorRole !== "admin") {
    return { err: { ok: false, status: 403, body: { error: "self_promotion_forbidden" } } };
  }
  if (!input.localMode && !input.reason) {
    return { err: { ok: false, status: 400, body: { error: "reason_required" } } };
  }
  return { meta: { ...meta, self_promotion: true } };
}

function reasonError(to: string, reason: string | null | undefined): TransitionErr | null {
  const needsReason = to === "retired" || to === "zombie";
  if (needsReason) {
    if (
      reason === undefined ||
      reason === null ||
      typeof reason !== "string" ||
      reason.length < 1
    ) {
      return { ok: false, status: 400, body: { error: "reason_required" } };
    }
  }
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string" || reason.length > 500) {
      return {
        ok: false,
        status: 400,
        body: { error: "bad_request", message: "reason must be at most 500 characters" },
      };
    }
  }
  return null;
}

export type TransitionInput = {
  type: string;
  name: string;
  to: string;
  reason?: string | null;
  actor: string;
  /** Required so every caller decides: the self-promotion rule depends on it. */
  actorRole: TransitionActorRole;
  /** `SKILLFORGE_AUTH_MODE=local`: one user, so a self-promotion needs no reason (still marked in the audit). */
  localMode?: boolean;
  meta?: Record<string, unknown> | null;
};

/** Sole writer of artifacts.status (besides create/publish with candidate). */
export function transitionArtifact(db: Database, input: TransitionInput): TransitionResult {
  const reasonCheck = reasonError(input.to, input.reason);
  if (reasonCheck) return reasonCheck;

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = getArtifactByTypeName(db, input.type, input.name);
    if (!row) {
      db.exec("ROLLBACK");
      return { ok: false, status: 404, body: { error: "not_found" } };
    }

    const from = row.status;
    if (!canTransition(from, input.to)) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        status: 409,
        body: { error: "invalid_transition", from, to: input.to },
      };
    }

    const self = selfPromotion(db, row, input);
    if ("err" in self) {
      db.exec("ROLLBACK");
      return self.err;
    }

    const to = input.to as Status;
    db.prepare("UPDATE artifacts SET status = ?, updated_at = ? WHERE id = ?").run(to, now, row.id);
    bumpRegistryEpoch();

    if ((from === "aging" || from === "zombie") && to === "active" && row.latest_version) {
      db.prepare(
        `UPDATE artifact_versions SET validated_at = ?
         WHERE artifact_id = ? AND version = ?`,
      ).run(now, row.id, row.latest_version);
    }

    const reason =
      input.reason !== undefined && input.reason !== null && input.reason !== ""
        ? input.reason
        : null;

    appendAudit(db, {
      ts: now,
      actor: input.actor,
      artifact_id: row.id,
      version: null,
      action: "transition",
      from_status: from,
      to_status: to,
      reason,
      meta: self.meta,
    });

    const createdNotifications = notify(db, {
      kind: "status_change",
      artifact: row,
      actor: input.actor,
    });
    db.exec("COMMIT");
    emitNotifications(createdNotifications);
    bumpMarketplaceVersion();

    const updated = getArtifactById(db, row.id)!;
    const events = listAudit(db, row.id);
    const event =
      events.find((e) => e.action === "transition" && e.ts === now && e.to_status === to) ??
      events[0]!;

    emitPluginEvent({
      type: "artifact.transitioned",
      at: now,
      actor: actorFromUsername(db, input.actor),
      artifact: {
        id: updated.id,
        type: updated.type,
        name: updated.name,
        status: updated.status,
      },
      from,
      to,
      reason,
    });

    return {
      ok: true,
      artifact: rowToSummary(db, updated),
      event,
    };
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function mergeModelCompat(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [...existing];
  for (const m of incoming) {
    if (typeof m === "string" && m.length > 0 && !merged.includes(m)) {
      merged.push(m);
    }
  }
  return merged;
}

function validationNote(note: string | null | undefined): string | null {
  return note !== undefined && note !== null && note !== "" ? String(note).slice(0, 500) : null;
}

export function validateVersion(
  db: Database,
  input: {
    type: string;
    name: string;
    version: string;
    model_compat?: string[];
    note?: string | null;
    actor: string;
  },
):
  | { ok: true; detail: NonNullable<ReturnType<typeof getVersion>> }
  | { ok: false; status: number; body: Record<string, unknown> } {
  const row = getArtifactByTypeName(db, input.type, input.name);
  if (!row) {
    return { ok: false, status: 404, body: { error: "not_found" } };
  }

  const version = input.version === "latest" ? (row.latest_version ?? "") : input.version;
  if (!version) {
    return { ok: false, status: 404, body: { error: "not_found" } };
  }

  const existing = getVersion(db, row.id, version);
  if (!existing) {
    return { ok: false, status: 404, body: { error: "not_found" } };
  }

  const incoming = Array.isArray(input.model_compat) ? input.model_compat : [];
  const merged = mergeModelCompat(existing.model_compat, incoming);

  const now = new Date().toISOString();
  const note = validationNote(input.note);

  const dedupedIncoming = incoming.filter(
    (m, i, a) => typeof m === "string" && m.length > 0 && a.indexOf(m) === i,
  );
  const firstValidation = existing.validated_at === null;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `UPDATE artifact_versions SET validated_at = ?, model_compat = ?
       WHERE artifact_id = ? AND version = ?`,
    ).run(now, JSON.stringify(merged), row.id, version);

    // Always audit the first validation and any call that includes a note.
    // Subsequent silent merges still update the version row.
    if (firstValidation || note !== null) {
      appendAudit(db, {
        ts: now,
        actor: input.actor,
        artifact_id: row.id,
        version,
        action: "validate",
        from_status: null,
        to_status: null,
        reason: note,
        meta: { model_compat: dedupedIncoming },
      });
    }

    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  }

  const detail = getVersion(db, row.id, version)!;
  emitPluginEvent({
    type: "version.validated",
    at: now,
    actor: actorFromUsername(db, input.actor),
    artifact: {
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
    },
    version: { version: detail.version, digest: detail.digest },
  });
  return { ok: true, detail };
}
