import { getSigner } from "../signing/signer.ts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isArtifactType, type ArtifactType } from "@skillforge/core";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { zipSync } from "fflate";
import type { AppConfig } from "../config.ts";
import { readBlob, hasBlob } from "../blobs.ts";
import { buildTarGz } from "../distribution/tar.ts";
import { pluginName } from "../distribution/plugin.ts";
import {
  buildPluginZip,
  pluginArchiveEntries,
  type ArchiveEntry,
} from "../distribution/plugin-archive.ts";
import { buildMarketplace, NOT_PLUGINS } from "../distribution/marketplace.ts";
import type { Database } from "../repo.ts";
import { getArtifactByTypeName, getVersion, incrementDownloads } from "../repo.ts";

/** The CLI package names the registry serves (release-dist); anything else is 404. */
const CLI_FILE = /^skillforge-cli(?:-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)?\.tgz$/;

export type DistributionPluginOpts = {
  db: Database;
  config: AppConfig;
  /** Server version: the CLI shipped in the same release has it too. */
  version?: string;
};

function isKnownType(type: string): type is ArtifactType {
  return isArtifactType(type);
}

function parseStatuses(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return ["active"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  for (const part of raw.split(",")) {
    const got = part.trim();
    if (got === etag || got === etag.replaceAll('"', "") || `"${got}"` === etag) {
      return true;
    }
  }
  return false;
}

function resolveVersion(
  row: { latest_version: string | null },
  versionParam: string,
): string | null {
  if (versionParam === "latest") return row.latest_version;
  return versionParam;
}

const ARCHIVE_FORMATS = [
  { ext: ".tar.gz", contentType: "application/gzip" },
  { ext: ".zip", contentType: "application/zip" },
] as const;
type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

/** `<version>.tar.gz` | `<version>.zip` → format and version part; anything else → null. */
function archiveFormat(file: string): { format: ArchiveFormat; versionRaw: string } | null {
  const format = ARCHIVE_FORMATS.find((f) => file.endsWith(f.ext));
  return format ? { format, versionRaw: file.slice(0, -format.ext.length) } : null;
}

/**
 * tar.gz keeps the `<plugin>/` wrapper for type plugin; the zip — the
 * Claude Code `archive` source — has the plugin root at the archive root for every type.
 */
function buildArchive(
  format: ArchiveFormat,
  type: ArtifactType,
  pname: string,
  entries: ArchiveEntry[],
): Uint8Array {
  if (format.ext === ".zip") return buildPluginZip(entries);
  const tarEntries =
    type === "plugin" ? entries.map((e) => ({ ...e, path: `${pname}/${e.path}` })) : entries;
  return buildTarGz(tarEntries);
}

export const distributionRoutes: FastifyPluginAsync<DistributionPluginOpts> = async (app, opts) => {
  const { db, config } = opts;
  const dataDir = config.dataDir;
  const base = config.baseUrl.replace(/\/$/, "");

  async function sendMarketplace(request: FastifyRequest, reply: FastifyReply) {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const statuses = parseStatuses(q.status);
    const typeRaw = typeof q.type === "string" && q.type.length > 0 ? q.type : undefined;
    if (typeRaw !== undefined && !isKnownType(typeRaw)) {
      const empty = {
        name: config.marketplaceName,
        owner: { name: config.marketplaceOwner },
        metadata: {
          description: `${config.marketplaceOwner} Claude Code marketplace`,
          version: "0",
          generated_at: new Date().toISOString(),
        },
        plugins: [] as unknown[],
      };
      return reply.type("application/json").send(empty);
    }
    const viewer = request.user
      ? { username: request.user.username, role: request.user.role }
      : null;
    const result = buildMarketplace(db, config, {
      statuses,
      ...(typeRaw ? { type: typeRaw } : {}),
      viewer,
    });
    if (viewer) {
      void reply.header("Cache-Control", "private");
      void reply.header("Vary", "Authorization, Cookie");
    }
    if (etagMatches(request.headers["if-none-match"], result.etag)) {
      return reply.code(304).header("etag", result.etag).send();
    }
    return reply.header("etag", result.etag).type("application/json").send(result.body);
  }

  app.get("/marketplace.json", sendMarketplace);
  app.get("/api/v1/marketplace.json", sendMarketplace);

  const signingInfo = () => {
    const s = getSigner();
    return s ? { alg: "ed25519", key_id: s.keyId, public_key_pem: s.publicKeyPem } : null;
  };

  app.get("/api/v1/install-info", async (_request, reply) => {
    const cliFile = path.join(config.downloadsDir, "skillforge-cli.tgz");
    return reply.send({
      marketplace_name: config.marketplaceName,
      marketplace_url: `${base}/marketplace.json`,
      cli: fs.existsSync(cliFile)
        ? { version: opts.version ?? null, url: `${base}/downloads/skillforge-cli.tgz` }
        : null,
      signing: signingInfo(),
    });
  });

  // The CLI package of this release; public like /marketplace.json (it holds no registry data).
  app.get<{ Params: { file: string } }>("/downloads/:file", async (request, reply) => {
    const { file } = request.params;
    const full = path.join(config.downloadsDir, file);
    if (!CLI_FILE.test(file) || !fs.existsSync(full))
      return reply.code(404).send({ error: "not_found" });
    return reply
      .header("content-disposition", `attachment; filename="${file}"`)
      .type("application/gzip")
      .send(fs.createReadStream(full));
  });

  app.get<{ Params: { type: string; name: string; tarball: string } }>(
    "/api/v1/plugins/:type/:name/:tarball",
    async (request, reply) => {
      const { type, name, tarball } = request.params;
      const parsed = archiveFormat(tarball);
      if (!parsed || !isKnownType(type) || NOT_PLUGINS.has(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const version = resolveVersion(row, parsed.versionRaw);
      if (!version) {
        return reply.code(404).send({ error: "not_found" });
      }
      const detail = getVersion(db, row.id, version);
      if (!detail) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (detail.purged) return reply.code(410).send({ error: "purged" });

      const pname = pluginName(type, name);
      const entries = pluginArchiveEntries(dataDir, row, detail, config);
      const archive = buildArchive(parsed.format, type, pname, entries);
      const digest = createHash("sha256").update(archive).digest("hex");
      const etag = `"${digest}"`;

      if (etagMatches(request.headers["if-none-match"], etag)) {
        return reply
          .code(304)
          .header("etag", etag)
          .header("cache-control", "public, max-age=31536000, immutable")
          .header("x-skillforge-digest", detail.digest)
          .send();
      }

      incrementDownloads(db, row.id);
      return reply
        .header("etag", etag)
        .header("cache-control", "public, max-age=31536000, immutable")
        .header(
          "content-disposition",
          `attachment; filename="${pname}-${version}${parsed.format.ext}"`,
        )
        .header("x-skillforge-digest", detail.digest)
        .type(parsed.format.contentType)
        .send(Buffer.from(archive));
    },
  );

  app.get<{ Params: { type: string; name: string; version: string } }>(
    "/api/v1/artifacts/:type/:name/versions/:version/bundle.zip",
    async (request, reply) => {
      const { type, name, version: versionParam } = request.params;
      if (!isKnownType(type)) {
        return reply.code(404).send({ error: "not_found" });
      }
      const row = getArtifactByTypeName(db, type, name);
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      const version = resolveVersion(row, versionParam);
      if (!version) {
        return reply.code(404).send({ error: "not_found" });
      }
      const detail = getVersion(db, row.id, version);
      if (!detail) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (detail.purged) return reply.code(410).send({ error: "purged" });

      const zipped: Record<string, Uint8Array> = {};
      for (const f of detail.files) {
        if (!hasBlob(dataDir, f.sha256)) {
          return reply.code(404).send({ error: "not_found" });
        }
        zipped[f.path] = readBlob(dataDir, f.sha256);
      }
      const archive = zipSync(zipped, { level: 6 });
      const digest = createHash("sha256").update(archive).digest("hex");
      const etag = `"${digest}"`;

      if (etagMatches(request.headers["if-none-match"], etag)) {
        return reply.code(304).header("etag", etag).send();
      }

      incrementDownloads(db, row.id);
      return reply
        .header("etag", etag)
        .header("content-disposition", `attachment; filename="${name}-${version}.zip"`)
        .type("application/zip")
        .send(Buffer.from(archive));
    },
  );
};
