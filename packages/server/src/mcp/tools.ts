import semver from "semver";
import { readBlob, hasBlob } from "../blobs.ts";
import { artifactTypeDef } from "@skillforge/core";
import type { Database } from "../repo.ts";
import {
  getArtifactById,
  getArtifactByTypeName,
  getVersion,
  listArtifacts,
  type ArtifactRow,
} from "../repo.ts";
import type { McpToolResult } from "./types.ts";
import {
  MAX_REPORT_ID,
  MAX_USES_PER_REPORT,
  USAGE_BASES,
  parseUsageInput,
  recordUsage,
  usageResponse,
} from "../evidence/usage.ts";
import {
  ARTIFACT_TYPES,
  MAX_BINARY_BYTES,
  MAX_BUNDLE_BYTES,
  MAX_FILE_BYTES,
  NAME_RE,
  TAG_RE,
  type ArtifactTypeName,
} from "./types.ts";
import { canView } from "../visibility/index.ts";
import type { Role } from "../auth/users.ts";
import { readFeedPage, toItemView, type NewsRow } from "../news/read.ts";
import { NEWS_KINDS, isNewsKind, type NewsKind } from "../news/rules.ts";
import { newsItemUrl } from "../news/links.ts";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/** list_news (news-delivery) bounds. */
const NEWS_DEFAULT_LIMIT = 20;
const NEWS_MAX_LIMIT = 100;
const NEWS_DEFAULT_DAYS = 7;
const NEWS_PAGE = 100;
const NEWS_MAX_PAGES = 20;

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "search_artifacts",
    description:
      "Search active artifacts in the SkillForge registry. Returns type, name, description, version, and tags.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search text matched against name, description, and tags",
        },
        type: {
          type: "string",
          enum: [...ARTIFACT_TYPES],
          description: "Artifact type filter",
        },
        tag: { type: "string", description: "Require this tag" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Max results (default 20)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_artifact",
    description: "Get an active artifact version with its main file text and file listing.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...ARTIFACT_TYPES] },
        name: { type: "string", description: "Artifact name (kebab-case)" },
        version: { type: "string", description: "Semver version; omit for latest" },
      },
      required: ["type", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "read_artifact_file",
    description:
      "Read one file from an active artifact version by exact path (no path normalization).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...ARTIFACT_TYPES] },
        name: { type: "string", description: "Artifact name (kebab-case)" },
        path: { type: "string", description: "Exact file path as stored in the version" },
        version: { type: "string", description: "Semver version; omit for latest" },
      },
      required: ["type", "name", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_artifact_files",
    description:
      "Read all files of an active artifact version in one call, each as read_artifact_file returns it; files over 4 MiB or past the 8 MiB total are listed in omitted with a reason.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...ARTIFACT_TYPES] },
        name: { type: "string", description: "Artifact name (kebab-case)" },
        version: { type: "string", description: "Semver version; omit for latest" },
      },
      required: ["type", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "record_usage",
    description:
      "Report how often an active artifact version was applied and how often it helped. Counts toward its Transfer Rate (helped/uses); repeat a report_id to retry safely. Other fields (for example an event payload) are accepted and ignored.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...ARTIFACT_TYPES] },
        name: { type: "string", description: "Artifact name (kebab-case)" },
        version: { type: "string", description: "Semver version; omit for latest" },
        uses: {
          type: "integer",
          minimum: 0,
          maximum: MAX_USES_PER_REPORT,
          description: "Times the artifact was applied",
        },
        helped: {
          type: "integer",
          minimum: 0,
          maximum: MAX_USES_PER_REPORT,
          description: "Times it helped (at most uses)",
        },
        report_id: {
          type: "string",
          maxLength: MAX_REPORT_ID,
          description: "Idempotency key: a repeated report_id is not counted twice",
        },
        basis: {
          type: "string",
          enum: [...USAGE_BASES],
          description:
            "What the report rests on: loaded (really applied) or assigned (only assigned to a role; shown separately, not counted in Transfer Rate). Omit if unknown.",
        },
      },
      // No additionalProperties: false — event receivers add their own fields.
      required: ["type", "name", "uses", "helped"],
    },
  },
  {
    name: "list_news",
    description:
      "Registry news newer than since (default: the last 7 days), newest first: new artifacts, new stable versions, status changes (zombie, retired, with the replacement to use instead) and posts. Only artifacts this token may use over MCP.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "ISO 8601 time; only news after it (default: 7 days ago)",
        },
        kinds: {
          type: "array",
          items: { type: "string", enum: [...NEWS_KINDS] },
          description: "Only these kinds of news",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: NEWS_MAX_LIMIT,
          description: "Max items (default 20)",
        },
      },
      additionalProperties: false,
    },
  },
];

function okResult(data: unknown): McpToolResult {
  const text = JSON.stringify(data);
  return {
    content: [{ type: "text", text }],
    structuredContent: data,
  };
}

function errResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function mainFilePath(type: string, name: string): string {
  if (!isArtifactType(type)) return "";
  return artifactTypeDef(type).mainFile(name);
}

export type McpCaller = { mcp_tags: string[]; username: string; role: Role };

function parseLabels(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

type McpVisibleRow = Pick<
  ArtifactRow,
  "id" | "status" | "tags" | "labels" | "visibility" | "owner_team" | "owner"
>;

function mcpTagMatch(row: McpVisibleRow, mcpTags: string[]): boolean {
  if (mcpTags.length === 0) return true;
  const tags = parseTags(row.tags);
  const labels = parseLabels(row.labels);
  return tags.some((t) => mcpTags.includes(t)) || labels.some((l) => mcpTags.includes(l));
}

function isMcpVisible(db: Database, caller: McpCaller, row: McpVisibleRow): boolean {
  if (row.status !== "active") return false;
  if (!canView(db, { username: caller.username, role: caller.role }, row)) return false;
  return mcpTagMatch(row, caller.mcp_tags);
}

/**
 * news-delivery: an artifact item is news for a token when the token could use the artifact over MCP — except that
 * a retired or fading artifact still counts (the agent must learn it is going away). Candidates never.
 * isMcpVisible itself keeps requiring `active` for every other tool.
 */
const NEWS_STATUSES: ReadonlySet<string> = new Set(["active", "aging", "zombie", "retired"]);

function isMcpNewsVisible(db: Database, caller: McpCaller, row: McpVisibleRow): boolean {
  if (!NEWS_STATUSES.has(row.status)) return false;
  if (!canView(db, { username: caller.username, role: caller.role }, row)) return false;
  return mcpTagMatch(row, caller.mcp_tags);
}

function isArtifactType(v: unknown): v is ArtifactTypeName {
  return typeof v === "string" && (ARTIFACT_TYPES as readonly string[]).includes(v);
}

function isKebabName(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 64 && NAME_RE.test(v);
}

function isSemver(v: unknown): v is string {
  return typeof v === "string" && semver.valid(v) !== null;
}

/** UTF-8 text without NUL, or null (binary). Size is not checked here. */
function utf8Text(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeUtf8Text(bytes: Uint8Array): string | null {
  return bytes.byteLength > MAX_FILE_BYTES ? null : utf8Text(bytes);
}

/** A version file for `get_artifact`: sha256 from the store, `binary` by the same rule as reading. */
function fileListing(dataDir: string, f: { path: string; size: number; sha256: string }) {
  const binary = hasBlob(dataDir, f.sha256)
    ? utf8Text(readBlob(dataDir, f.sha256)) === null
    : false;
  return { path: f.path, size: f.size, sha256: f.sha256, binary };
}

/** `read_artifact_file` payload: text up to 256 KiB, anything else as base64 up to 4 MiB (mcp-artifact-files). */
function filePayload(
  path: string,
  sha256: string,
  bytes: Uint8Array,
): Record<string, unknown> | null {
  const size = bytes.byteLength;
  const text = decodeUtf8Text(bytes);
  if (text !== null) return { path, encoding: "utf-8", text, size, sha256 };
  if (size > MAX_BINARY_BYTES) return null;
  const content_base64 = Buffer.from(bytes).toString("base64");
  return { path, encoding: "base64", content_base64, size, sha256 };
}

function fileContent(path: string, sha256: string, bytes: Uint8Array): McpToolResult {
  const payload = filePayload(path, sha256, bytes);
  if (payload) return okResult(payload);
  return errResult(`File is ${bytes.byteLength} bytes; the MCP limit is ${MAX_BINARY_BYTES} bytes`);
}

type Omitted = { path: string; size: number; reason: "too_large" | "budget" | "missing" };

/** mcp-read-files: every file of the version in path order, in `files` or in `omitted` with a reason. */
function versionFiles(
  dataDir: string,
  entries: ReadonlyArray<{ path: string; size: number; sha256: string }>,
) {
  const files: Record<string, unknown>[] = [];
  const omitted: Omitted[] = [];
  let sent = 0;
  for (const f of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (!hasBlob(dataDir, f.sha256)) {
      omitted.push({ path: f.path, size: f.size, reason: "missing" });
      continue;
    }
    const bytes = readBlob(dataDir, f.sha256);
    const payload = filePayload(f.path, f.sha256, bytes);
    if (!payload) omitted.push({ path: f.path, size: bytes.byteLength, reason: "too_large" });
    else if (sent + bytes.byteLength > MAX_BUNDLE_BYTES) {
      omitted.push({ path: f.path, size: bytes.byteLength, reason: "budget" });
    } else {
      sent += bytes.byteLength;
      files.push(payload);
    }
  }
  return { files, omitted };
}

export type CallToolOutcome =
  { kind: "invalid_params"; message: string } | { kind: "result"; result: McpToolResult };

export function callTool(
  db: Database,
  dataDir: string,
  caller: McpCaller,
  name: unknown,
  args: unknown,
  base = "",
): CallToolOutcome {
  if (typeof name !== "string" || !TOOL_DEFS.some((t) => t.name === name)) {
    return { kind: "invalid_params", message: `Unknown tool: ${String(name)}` };
  }
  if (args === undefined || args === null) {
    args = {};
  }
  if (typeof args !== "object" || Array.isArray(args)) {
    return { kind: "invalid_params", message: "Tool arguments must be an object" };
  }
  const a = args as Record<string, unknown>;

  if (name === "search_artifacts") {
    return searchArtifacts(db, caller, a);
  }
  if (name === "get_artifact") {
    return getArtifact(db, dataDir, caller, a);
  }
  if (name === "record_usage") {
    return recordUsageTool(db, caller, a);
  }
  if (name === "read_artifact_files") {
    return readArtifactFiles(db, dataDir, caller, a);
  }
  if (name === "list_news") {
    return listNewsTool(db, caller, a, base);
  }
  return readArtifactFile(db, dataDir, caller, a);
}

function recordUsageTool(
  db: Database,
  caller: McpCaller,
  a: Record<string, unknown>,
): CallToolOutcome {
  if (!isArtifactType(a.type) || !isKebabName(a.name)) {
    return { kind: "result", result: errResult("Artifact not found") };
  }
  if (a.version !== undefined && !isSemver(a.version)) {
    return { kind: "result", result: errResult("version must be semver") };
  }
  if (a.report_id !== undefined && typeof a.report_id !== "string") {
    return { kind: "result", result: errResult("report_id must be a string") };
  }
  const report = parseUsageInput({
    version: a.version,
    uses: a.uses,
    helped: a.helped,
    report_id: a.report_id,
    basis: a.basis,
  });
  if (!report) {
    return {
      kind: "result",
      result: errResult(
        `uses and helped must be integers with 0 <= helped <= uses <= ${MAX_USES_PER_REPORT}; report_id at most ${MAX_REPORT_ID} characters; basis is loaded or assigned`,
      ),
    };
  }
  const outcome = recordUsage(db, {
    type: a.type,
    name: a.name,
    reporter: caller.username,
    source: "mcp",
    report,
    visible: (row) => isMcpVisible(db, caller, row),
  });
  if (outcome.kind === "not_found") {
    return { kind: "result", result: errResult("Artifact not found") };
  }
  if (outcome.kind === "rate_limited") {
    return {
      kind: "result",
      result: errResult("Rate limited: too many usage reports for this artifact today"),
    };
  }
  return { kind: "result", result: okResult(usageResponse(outcome)) };
}

function searchArtifacts(
  db: Database,
  caller: McpCaller,
  a: Record<string, unknown>,
): CallToolOutcome {
  let limit = 20;
  if (a.limit !== undefined) {
    if (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > 50) {
      return { kind: "invalid_params", message: "limit must be an integer from 1 to 50" };
    }
    limit = a.limit;
  }
  if (a.type !== undefined && !isArtifactType(a.type)) {
    return {
      kind: "invalid_params",
      message: "type must be skill, command, agent, hook, or plugin",
    };
  }
  if (a.tag !== undefined) {
    if (typeof a.tag !== "string" || !TAG_RE.test(a.tag) || a.tag.length > 32) {
      return { kind: "invalid_params", message: "tag must be kebab-case" };
    }
  }
  if (a.query !== undefined && typeof a.query !== "string") {
    return { kind: "invalid_params", message: "query must be a string" };
  }

  const { items } = listArtifacts(db, {
    status: "active",
    type: a.type as string | undefined,
    tag: a.tag as string | undefined,
    q: a.query as string | undefined,
    viewer: { username: caller.username, role: caller.role },
    ...(caller.mcp_tags.length > 0 ? { mcpTags: caller.mcp_tags } : {}),
    limit,
    offset: 0,
  });

  const sliced = items.map((it) => ({
    type: it.type,
    name: it.name,
    description: it.description,
    version: it.latest_version ?? "",
    tags: it.tags,
  }));

  return { kind: "result", result: okResult({ items: sliced }) };
}

function getArtifact(
  db: Database,
  dataDir: string,
  caller: McpCaller,
  a: Record<string, unknown>,
): CallToolOutcome {
  if (!isArtifactType(a.type)) {
    return {
      kind: "invalid_params",
      message: "type must be skill, command, agent, hook, or plugin",
    };
  }
  if (!isKebabName(a.name)) {
    return { kind: "invalid_params", message: "name must be kebab-case" };
  }
  if (a.version !== undefined && !isSemver(a.version)) {
    return { kind: "invalid_params", message: "version must be semver" };
  }

  const row = getArtifactByTypeName(db, a.type, a.name);
  if (!row || !isMcpVisible(db, caller, row)) {
    return { kind: "result", result: errResult("Artifact not found") };
  }

  const versionStr = a.version !== undefined ? a.version : (row.latest_version ?? "");
  if (!versionStr) {
    return { kind: "result", result: errResult("Artifact not found") };
  }
  const detail = getVersion(db, row.id, versionStr);
  if (!detail) {
    return { kind: "result", result: errResult("Artifact not found") };
  }

  const mainPath = mainFilePath(row.type, row.name);
  const mainEntry = detail.files.find((f) => f.path === mainPath);
  let mainText = "";
  if (mainEntry && hasBlob(dataDir, mainEntry.sha256)) {
    const decoded = decodeUtf8Text(readBlob(dataDir, mainEntry.sha256));
    if (decoded === null) {
      return { kind: "result", result: errResult("Main file is not readable as UTF-8 text") };
    }
    mainText = decoded;
  } else {
    return { kind: "result", result: errResult("Artifact not found") };
  }

  const data = {
    type: row.type,
    name: row.name,
    version: detail.version,
    digest: detail.digest,
    description: detail.description || row.description,
    main_file: { path: mainPath, text: mainText },
    files: detail.files.map((f) => fileListing(dataDir, f)),
  };
  return { kind: "result", result: okResult(data) };
}

type VisibleVersion = { row: ArtifactRow; detail: NonNullable<ReturnType<typeof getVersion>> };

/** Arguments `type`, `name`, `version?` parsed at the boundary, then the version the caller may see. */
function visibleVersion(
  db: Database,
  caller: McpCaller,
  a: Record<string, unknown>,
): VisibleVersion | CallToolOutcome {
  if (!isArtifactType(a.type)) {
    return {
      kind: "invalid_params",
      message: "type must be skill, command, agent, hook, or plugin",
    };
  }
  if (!isKebabName(a.name)) {
    return { kind: "invalid_params", message: "name must be kebab-case" };
  }
  if (a.version !== undefined && !isSemver(a.version)) {
    return { kind: "invalid_params", message: "version must be semver" };
  }
  const notFound: CallToolOutcome = { kind: "result", result: errResult("Artifact not found") };
  const row = getArtifactByTypeName(db, a.type, a.name);
  if (!row || !isMcpVisible(db, caller, row)) return notFound;
  const versionStr = a.version !== undefined ? a.version : (row.latest_version ?? "");
  const detail = versionStr ? getVersion(db, row.id, versionStr) : null;
  return detail ? { row, detail } : notFound;
}

function readArtifactFiles(
  db: Database,
  dataDir: string,
  caller: McpCaller,
  a: Record<string, unknown>,
): CallToolOutcome {
  const found = visibleVersion(db, caller, a);
  if ("kind" in found) return found;
  const { row, detail } = found;
  const data = {
    type: row.type,
    name: row.name,
    version: detail.version,
    digest: detail.digest,
    ...versionFiles(dataDir, detail.files),
  };
  return { kind: "result", result: okResult(data) };
}

function readArtifactFile(
  db: Database,
  dataDir: string,
  caller: McpCaller,
  a: Record<string, unknown>,
): CallToolOutcome {
  // The same order of argument errors as before: type, name, path, version.
  const path = isArtifactType(a.type) && isKebabName(a.name) ? a.path : "";
  if (typeof path !== "string") {
    return { kind: "invalid_params", message: "path must be a string" };
  }
  const found = visibleVersion(db, caller, a);
  if ("kind" in found) return found;

  // Exact path match only — no normalize
  const entry = found.detail.files.find((f) => f.path === path);
  if (!entry || !hasBlob(dataDir, entry.sha256)) {
    return { kind: "result", result: errResult("File not found") };
  }

  return {
    kind: "result",
    result: fileContent(path, entry.sha256, readBlob(dataDir, entry.sha256)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// list_news (news-delivery): the feed's code (news/read.ts) by the token owner's rights, then the MCP news check.

type NewsArgs = { since: string; kinds: NewsKind[] | null; limit: number };

function newsLimit(raw: unknown): number | null {
  if (raw === undefined) return NEWS_DEFAULT_LIMIT;
  const ok = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= NEWS_MAX_LIMIT;
  return ok ? raw : null;
}

function newsSince(raw: unknown): string | null {
  if (raw === undefined) return new Date(Date.now() - NEWS_DEFAULT_DAYS * 86_400_000).toISOString();
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function newsKinds(raw: unknown): NewsKind[] | null | false {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || !raw.every(isNewsKind)) return false;
  return raw.length > 0 ? raw : null;
}

function parseNewsArgs(a: Record<string, unknown>): NewsArgs | string {
  const limit = newsLimit(a.limit);
  if (limit === null) return `limit must be an integer from 1 to ${NEWS_MAX_LIMIT}`;
  const since = newsSince(a.since);
  if (since === null) return "since must be an ISO 8601 time";
  const kinds = newsKinds(a.kinds);
  if (kinds === false) return `kinds must be a list of: ${NEWS_KINDS.join(", ")}`;
  return { since, kinds, limit };
}

function newsRowVisible(db: Database, caller: McpCaller, row: NewsRow): boolean {
  if (row.kind === "post") return true; // the rights clause already applied the owner's audience
  const artifact = row.artifact_id ? getArtifactById(db, row.artifact_id) : undefined;
  return artifact !== undefined && isMcpNewsVisible(db, caller, artifact);
}

function newsItem(db: Database, caller: McpCaller, row: NewsRow, now: string, base: string) {
  const v = toItemView(db, { username: caller.username, role: caller.role }, row, now);
  return {
    kind: v.kind,
    at: v.at,
    artifact: v.artifact,
    version: v.version,
    from: v.from,
    to: v.to,
    replacement: v.replacement,
    post: v.post ? { title: v.post.title, body: v.post.body, team: v.post.team } : null,
    url: newsItemUrl(base, v),
  };
}

function listNewsTool(
  db: Database,
  caller: McpCaller,
  a: Record<string, unknown>,
  base: string,
): CallToolOutcome {
  const args = parseNewsArgs(a);
  if (typeof args === "string") return { kind: "invalid_params", message: args };
  const viewer = { username: caller.username, role: caller.role };
  const now = new Date().toISOString();
  const items: ReturnType<typeof newsItem>[] = [];
  let cursor: { at: string; id: number } | null = null;
  for (let page = 0; page < NEWS_MAX_PAGES && items.length < args.limit; page++) {
    const q = { cursor, limit: NEWS_PAGE, kinds: args.kinds, type: null, team: null, mine: false };
    const { rows, hasMore } = readFeedPage(
      db,
      viewer,
      { ...q, drafts: false, since: args.since },
      now,
    );
    for (const row of rows) {
      if (items.length < args.limit && newsRowVisible(db, caller, row)) {
        items.push(newsItem(db, caller, row, now, base));
      }
    }
    const last = rows.at(-1);
    if (!hasMore || !last) break;
    cursor = { at: last.at, id: last.id };
  }
  return { kind: "result", result: okResult({ items }) };
}
