import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { actorFromRequest } from "../actor.ts";
import { requireRole } from "../auth/guard.ts";
import type { AppConfig } from "../config.ts";
import type { Database } from "../repo.ts";
import { previewImport } from "../imports/preview.ts";
import { runImport } from "../imports/run.ts";
import {
  IMPORT_PATH_MAX,
  IMPORT_REF_RE,
  isSafeImportPath,
  type ImportSource,
} from "../imports/sources.ts";

export type ImportsPluginOpts = {
  db: Database;
  config: AppConfig;
};

const fileEntrySchema = z.object({
  path: z.string(),
  content_base64: z.string(),
});

const gitPathSchema = z
  .string()
  .min(1)
  .max(IMPORT_PATH_MAX)
  .refine(isSafeImportPath, { message: "invalid path" });

const gitRefSchema = z.string().regex(IMPORT_REF_RE, { message: "invalid ref" });

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("files"),
    files: z.array(fileEntrySchema).min(1),
  }),
  z.object({
    kind: z.literal("zip"),
    content_base64: z.string().min(1),
  }),
  z.object({
    kind: z.literal("git"),
    url: z.string().min(1),
    ref: gitRefSchema.optional(),
    path: gitPathSchema.optional(),
  }),
]);

const previewBodySchema = z.object({
  source: sourceSchema,
});

const runBodySchema = z.object({
  import_id: z.string().min(1),
  selected: z.union([z.literal("all"), z.array(z.string()).min(1)]),
  provenance_source: z.string().optional(),
  skip_conflicts: z.boolean().optional(),
  age_override_reason: z.string().trim().min(3).max(500).optional(),
});

export const importsRoutes: FastifyPluginAsync<ImportsPluginOpts> = async (app, opts) => {
  const { db, config } = opts;

  app.post("/api/v1/imports/preview", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    const parsed = previewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "bad_request",
        message: parsed.error.issues[0]?.message ?? "invalid body",
      });
    }
    const result = await previewImport({
      db,
      config,
      userId: request.user!.id,
      source: parsed.data.source as ImportSource,
    });
    if (!result.ok) {
      const body: Record<string, unknown> = { error: result.error };
      if (result.message) body.message = result.message;
      return reply.code(result.status ?? 400).send(body);
    }
    return reply.code(200).send({
      import_id: result.import_id,
      source: result.source,
      candidates: result.candidates,
      skipped: result.skipped,
    });
  });

  app.post("/api/v1/imports/run", async (request, reply) => {
    if (!requireRole(request, reply, "contributor")) return;
    const parsed = runBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "bad_request",
        message: parsed.error.issues[0]?.message ?? "invalid body",
      });
    }
    const result = await runImport({
      db,
      config,
      dataDir: config.dataDir,
      userId: request.user!.id,
      actor: actorFromRequest(request),
      role: request.user!.role,
      importId: parsed.data.import_id,
      selected: parsed.data.selected,
      ...(parsed.data.provenance_source !== undefined
        ? { provenanceSource: parsed.data.provenance_source }
        : {}),
      skipConflicts: parsed.data.skip_conflicts ?? true,
      ...(parsed.data.age_override_reason !== undefined
        ? { ageOverrideReason: parsed.data.age_override_reason }
        : {}),
    });
    if (!result.ok) {
      const body: Record<string, unknown> = { error: result.error };
      if (result.message) body.message = result.message;
      if (result.ready_at) body.ready_at = result.ready_at;
      return reply.code(result.status).send(body);
    }
    return reply.code(200).send({ results: result.results });
  });
};
