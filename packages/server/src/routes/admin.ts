import { appendSystemEvent } from "../audit/journal.ts";
import type { FastifyPluginAsync } from "fastify";
import type { Database } from "../db.ts";
import { requireRole } from "../auth/guard.ts";
import {
  createUser,
  getUserById,
  isRole,
  listUsers,
  updateUser,
  type Role,
} from "../auth/users.ts";
import { deleteAllSessionsForUser } from "../auth/sessions.ts";
import { userSource } from "../auth/identities.ts";
import { listOrphans, notifyOrphaned } from "../orphans.ts";

export type AdminPluginOpts = {
  db: Database;
};

type UserPatch = {
  role?: Role;
  disabled?: boolean;
  display_name?: string | null;
  password?: string;
};

/** Returns null when any provided field has the wrong type. */
function parseUserPatch(raw: unknown): UserPatch | null {
  const body = (raw ?? {}) as {
    role?: unknown;
    disabled?: unknown;
    display_name?: unknown;
    password?: unknown;
  };
  const patch: UserPatch = {};
  if (body.role !== undefined) {
    if (typeof body.role !== "string" || !isRole(body.role)) return null;
    patch.role = body.role;
  }
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== "boolean") return null;
    patch.disabled = body.disabled;
  }
  if (body.display_name !== undefined) {
    if (body.display_name !== null && typeof body.display_name !== "string") return null;
    patch.display_name = body.display_name as string | null;
  }
  if (body.password !== undefined) {
    if (typeof body.password !== "string") return null;
    patch.password = body.password;
  }
  return patch;
}

function updateUserErrorReply(error: string): { status: number; error: string } {
  if (error === "not_found") return { status: 404, error: "not_found" };
  if (error === "last_admin") return { status: 409, error: "last_admin" };
  return { status: 400, error: "bad_request" };
}

export const adminRoutes: FastifyPluginAsync<AdminPluginOpts> = async (app, opts) => {
  const { db } = opts;

  app.get("/api/v1/admin/users", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const items = listUsers(db).map((u) => ({
      ...u,
      source: userSource(db, u.id, u.username),
    }));
    return reply.code(200).send({ items });
  });

  // orphaned-artifacts: artifacts whose owner is disabled or gone, with a suggested co-author.
  app.get("/api/v1/admin/orphans", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    return reply.code(200).send({ items: listOrphans(db) });
  });

  app.post("/api/v1/admin/users", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const body = (request.body ?? {}) as {
      username?: unknown;
      password?: unknown;
      role?: unknown;
      display_name?: unknown;
    };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const roleRaw = typeof body.role === "string" ? body.role : "";
    if (!isRole(roleRaw)) {
      return reply.code(400).send({ error: "bad_request" });
    }
    const displayName = typeof body.display_name === "string" ? body.display_name : undefined;
    const result = createUser(db, {
      username,
      password,
      role: roleRaw as Role,
      display_name: displayName,
    });
    if (!result.ok) {
      const status = result.error === "username_taken" ? 409 : 400;
      return reply.code(status).send({ error: result.error });
    }
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "user_create",
      target: result.user.username,
      meta: { role: result.user.role },
    });
    return reply.code(201).send(result.user);
  });

  app.patch<{ Params: { id: string } }>("/api/v1/admin/users/:id", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const patch = parseUserPatch(request.body);
    if (!patch) {
      return reply.code(400).send({ error: "bad_request" });
    }

    const before = getUserById(db, request.params.id);
    const result = updateUser(db, request.params.id, patch);
    if (!result.ok) {
      const failure = updateUserErrorReply(result.error);
      return reply.code(failure.status).send({ error: failure.error });
    }
    // The password itself never goes to the journal, only that it changed.
    const { password, ...visible } = patch as typeof patch & { password?: string };
    appendSystemEvent(db, {
      actor: request.user.username,
      action: "user_update",
      target: result.user.username,
      meta: { ...visible, ...(password !== undefined ? { password_changed: true } : {}) },
    });
    if (before && patch.disabled === true) {
      deleteAllSessionsForUser(db, before.id);
      if (!before.disabled) notifyOrphaned(db, before.username, request.user.username);
    }
    return reply.code(200).send(result.user);
  });
};
