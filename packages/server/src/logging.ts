import { BlobCorruptError } from "./blobs.ts";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const VALID_LEVELS = new Set<string>(["error", "warn", "info", "debug"]);

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_ROTATED = 5;

const SENSITIVE_KEY_RE =
  /pass(word|wd)|token|secret|authorization|api[_-]?key|cookie|session[_-]?id|grant/i;

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    logStartedAt: number;
  }
}

export function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === "") return "info";
  const v = raw.trim().toLowerCase();
  if (VALID_LEVELS.has(v)) return v as LogLevel;
  console.error(`Invalid SKILLFORGE_LOG_LEVEL=${raw}; falling back to info`);
  return "info";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Exact secret values registered at startup (admin password, provider secrets). */
const SECRET_VALUES = new Set<string>();

/** Register exact secret values to mask inside any logged string (min 8 chars). */
export function registerRedactSecrets(values: Iterable<string | null | undefined>): void {
  for (const v of values) {
    if (typeof v === "string" && v.length >= 8) SECRET_VALUES.add(v);
  }
}

const URL_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^\s/"'@]*:[^\s/"'@]*@/gi;
const BEARER_RE = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
/** Agent Space task budget grants (llm-budget-broker), with or without the `.<grant id>` suffix. */
const BUDGET_GRANT_RE = /\bas_sf_[A-Za-z0-9_-]{43}(?:\.[0-9a-f-]{36})?/g;
const KV_SECRET_RE =
  /(password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|client_secret|bind_password)(\s*[=:]\s*)([^\s"'&,;\\]{4,})/gi;

/** Mask secrets embedded in a free-form string (URLs, Bearer tokens, k=v pairs, registered secrets). */
export function redactString(s: string): string {
  let out = s;
  out = out.replace(URL_USERINFO_RE, "$1[REDACTED]@");
  out = out.replace(BEARER_RE, "$1[REDACTED]");
  out = out.replace(BUDGET_GRANT_RE, "[REDACTED]");
  out = out.replace(KV_SECRET_RE, "$1$2[REDACTED]");
  for (const secret of SECRET_VALUES) {
    if (out.includes(secret)) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

/** Recursively redact password/token/secret-like fields to [REDACTED]. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = redact(child);
    }
  }
  return out;
}

export function isValidRequestId(raw: string): boolean {
  if (raw.length < 1 || raw.length > 128) return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

export function resolveRequestId(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === "string" && isValidRequestId(raw.trim())) {
    return raw.trim();
  }
  return randomUUID();
}

export type Logger = {
  level: LogLevel;
  logsDir: string;
  logPath: string;
  log: (level: LogLevel, msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
};

function rotateIfNeeded(logPath: string): void {
  if (!fs.existsSync(logPath)) return;
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return;
  }
  if (size < MAX_LOG_BYTES) return;
  for (let i = MAX_ROTATED - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`;
    const dest = `${logPath}.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.renameSync(src, dest);
      } catch {
        /* ignore rotation race */
      }
    }
  }
  const first = `${logPath}.1`;
  try {
    if (fs.existsSync(first)) fs.unlinkSync(first);
    fs.renameSync(logPath, first);
  } catch {
    /* ignore */
  }
}

export function createLogger(dataDir: string, levelEnv?: string): Logger {
  const level = parseLogLevel(levelEnv ?? process.env.SKILLFORGE_LOG_LEVEL);
  const logsDir = path.join(dataDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, "skillforge.log");

  const write = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[lvl] > LEVEL_ORDER[level]) return;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: lvl,
      msg: redactString(msg),
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    const line = `${JSON.stringify(record)}\n`;
    try {
      rotateIfNeeded(logPath);
      fs.appendFileSync(logPath, line, "utf8");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`skillforge log write failed: ${errMsg}`);
    }
  };

  return {
    level,
    logsDir,
    logPath,
    log: write,
    error: (msg, fields) => write("error", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    debug: (msg, fields) => write("debug", msg, fields),
  };
}

function pathWithoutQuery(url: string): string {
  return url.split("?")[0] ?? url;
}

/** Wire correlation id + request/response logging hooks. */
export function registerRequestLogging(app: FastifyInstance, logger: Logger): void {
  app.addHook("onRequest", async (request, reply) => {
    const id = resolveRequestId(request.headers["x-request-id"]);
    request.requestId = id;
    request.logStartedAt = Date.now();
    reply.header("x-request-id", id);
  });

  app.addHook("onResponse", async (request, reply) => {
    const started = request.logStartedAt || Date.now();
    const durationMs = Date.now() - started;
    logger.info("request", {
      request_id: request.requestId,
      method: request.method,
      url: pathWithoutQuery(request.url),
      statusCode: reply.statusCode,
      duration_ms: durationMs,
    });
  });
}

function isHttpError(err: unknown): err is { statusCode: number; message?: string; code?: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  );
}

/**
 * Unified error handler: production 500 hides internals. `safeErrors` comes from
 * AppConfig (NODE_ENV=production or SKILLFORGE_SAFE_ERRORS), parsed once at startup.
 */
export function createSafeErrorHandler(logger: Logger, opts: { safeErrors: boolean }) {
  return (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.requestId || resolveRequestId(undefined);
    if (!request.requestId) {
      request.requestId = requestId;
      reply.header("x-request-id", requestId);
    }

    if (error instanceof BlobCorruptError) {
      // blob-integrity: the hash names the damaged file; its content goes neither to the log nor to the client.
      logger.error("blob_corrupt", {
        request_id: requestId,
        sha: error.sha,
        url: pathWithoutQuery(request.url),
      });
      return reply
        .code(500)
        .type("application/json")
        .send({ error: "blob_corrupt", request_id: requestId });
    }
    const status = isHttpError(error) ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    if (status >= 500) {
      logger.error("unhandled_error", {
        request_id: requestId,
        statusCode: status,
        message,
        stack,
        method: request.method,
        url: pathWithoutQuery(request.url),
      });
      if (opts.safeErrors) {
        return reply
          .code(status)
          .type("application/json")
          .send({ error: "internal_error", request_id: requestId });
      }
      return reply
        .code(status)
        .type("application/json")
        .send({ error: "internal_error", request_id: requestId, message });
    }

    const code =
      isHttpError(error) && typeof error.code === "string"
        ? error.code
        : status === 400
          ? "bad_request"
          : status === 404
            ? "not_found"
            : "error";
    return reply
      .code(status)
      .type("application/json")
      .send({ error: code, request_id: requestId, message });
  };
}

export type { FastifyReply, FastifyRequest };
