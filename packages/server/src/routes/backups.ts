import fs from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import type { AppConfig } from "../config.ts";
import type { Database } from "../db.ts";
import { requireRole } from "../auth/guard.ts";
import {
  BackupInProgressError,
  BackupNotFoundError,
  backupPath,
  createBackup,
  deleteBackup,
  isValidBackupName,
  listBackups,
} from "../backups/store.ts";

export type BackupsPluginOpts = {
  db: Database;
  config: AppConfig;
  serverVersion: string;
};

export const backupsRoutes: FastifyPluginAsync<BackupsPluginOpts> = async (app, opts) => {
  const { db, config, serverVersion } = opts;

  app.post("/api/v1/admin/backups", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    try {
      const backup = await createBackup({
        db,
        dataDir: config.dataDir,
        keep: config.backupKeep,
        serverVersion,
        pluginsDir: config.pluginsDir,
      });
      return reply.code(201).send({ backup });
    } catch (e) {
      if (e instanceof BackupInProgressError) {
        return reply.code(409).send({ error: "backup_in_progress" });
      }
      throw e;
    }
  });

  app.get("/api/v1/admin/backups", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const result = listBackups(config.dataDir);
    return reply.code(200).send(result);
  });

  app.get<{ Params: { name: string } }>("/api/v1/admin/backups/:name", async (request, reply) => {
    if (!requireRole(request, reply, "admin")) return;
    const { name } = request.params;
    if (!isValidBackupName(name)) {
      return reply.code(404).send({ error: "not_found" });
    }
    let full: string;
    try {
      full = backupPath(config.dataDir, name);
    } catch (e) {
      if (e instanceof BackupNotFoundError) {
        return reply.code(404).send({ error: "not_found" });
      }
      throw e;
    }
    if (!fs.existsSync(full)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const st = fs.statSync(full);
    reply.header("content-type", "application/gzip");
    reply.header("content-disposition", `attachment; filename="${name}"`);
    reply.header("content-length", st.size);
    return reply.send(fs.createReadStream(full));
  });

  app.delete<{ Params: { name: string } }>(
    "/api/v1/admin/backups/:name",
    async (request, reply) => {
      if (!requireRole(request, reply, "admin")) return;
      const { name } = request.params;
      if (!isValidBackupName(name)) {
        return reply.code(404).send({ error: "not_found" });
      }
      try {
        deleteBackup(config.dataDir, name);
      } catch (e) {
        if (e instanceof BackupNotFoundError) {
          return reply.code(404).send({ error: "not_found" });
        }
        throw e;
      }
      return reply.code(204).send();
    },
  );
};
