import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ParseResult, SessionAdapter, SessionFact } from "./adapter.ts";

export const MAX_LINE_BYTES = 1 * 1024 * 1024;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** Verification command patterns (word-boundary, case-insensitive). Design decision 3. */
const VERIFY_RE =
  /\b(?:npm\s+(?:test|run\s+(?:test|build|lint))|pnpm\s+(?:test|build|lint)|yarn\s+(?:test|build|lint)|node\s+--test|npx\s+playwright\s+test|pytest|python\s+-m\s+(?:pytest|unittest)|go\s+test|cargo\s+(?:test|build|check)|make\s+(?:test|check|lint)|mvn\s+test|gradle\s+test|dotnet\s+(?:test|build)|tsc\b|eslint\b|ruff\b|phpunit\b|rspec\b)/i;

const EXIT_CODE_RE = /Exit code\s*[:=]?\s*(-?\d+)/i;
/** The first thing in a meta message of a subagent when `skills:` preloads a skill; the tag elsewhere means nothing. */
const PRELOAD_RE =
  /^\s*(?:<command-message>[^<]*<\/command-message>\s*)?<command-name>\/?([A-Za-z0-9:_-]+)<\/command-name>/;

type BashPending = { id: string; command: string; isVerify: boolean };
type SkillWindow = {
  skill: string;
  used_at: string;
  lastVerify: { success: boolean } | null;
};

function sessionKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function realpathSafe(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const root = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return candidateReal === rootReal || candidateReal.startsWith(root);
}

function walkSymlinkEntry(
  full: string,
  entName: string,
  rootReal: string,
  out: string[],
  seen: Set<string>,
): void {
  const target = realpathSafe(full);
  if (!target || !isInsideRoot(rootReal, target) || seen.has(target)) return;
  try {
    const tst = fs.statSync(full);
    if (tst.isDirectory()) {
      seen.add(target);
      walkJsonl(full, rootReal, out, seen);
    } else if (tst.isFile() && entName.endsWith(".jsonl") && tst.size <= MAX_FILE_BYTES) {
      seen.add(target);
      out.push(full);
    }
  } catch {
    return;
  }
}

function walkDirOrFile(
  full: string,
  ent: fs.Dirent,
  st: fs.Stats,
  rootReal: string,
  out: string[],
  seen: Set<string>,
): void {
  if (st.isDirectory()) {
    const dirReal = realpathSafe(full);
    if (!dirReal || !isInsideRoot(rootReal, dirReal) || seen.has(dirReal)) return;
    seen.add(dirReal);
    walkJsonl(full, rootReal, out, seen);
    return;
  }
  if (!st.isFile()) return;
  if (!ent.name.endsWith(".jsonl")) return;
  if (st.size > MAX_FILE_BYTES) return;
  const fileReal = realpathSafe(full);
  if (!fileReal || !isInsideRoot(rootReal, fileReal) || seen.has(fileReal)) return;
  seen.add(fileReal);
  out.push(full);
}

function walkJsonl(root: string, rootReal: string, out: string[], seen: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      walkSymlinkEntry(full, ent.name, rootReal, out, seen);
      continue;
    }
    walkDirOrFile(full, ent, st, rootReal, out, seen);
  }
}

function contentBlocks(msg: unknown): unknown[] {
  if (!msg || typeof msg !== "object") return [];
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content;
}

function flushWindow(w: SkillWindow | null, facts: SessionFact[], sessionId: string): void {
  if (!w) return;
  let verification: SessionFact["verification"] = "none";
  if (w.lastVerify) verification = w.lastVerify.success ? "pass" : "fail";
  facts.push({
    skill: w.skill,
    session_key: sessionKey(sessionId),
    used_at: w.used_at,
    verification,
  });
}

function isVerifyCommand(cmd: string): boolean {
  return VERIFY_RE.test(cmd);
}

function resultSuccess(isError: unknown, text: string): boolean {
  if (isError === true) return false;
  const m = EXIT_CODE_RE.exec(text);
  if (m && Number(m[1]) !== 0) return false;
  return true;
}

function toolResultText(bl: Record<string, unknown>): string {
  if (typeof bl.content === "string") return bl.content;
  if (!Array.isArray(bl.content)) return "";
  return bl.content
    .map((c) =>
      c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
        ? (c as { text: string }).text
        : typeof c === "string"
          ? c
          : "",
    )
    .join("\n");
}

type PreloadedSkill = {
  sid: string;
  agentId: string;
  skill: string;
  used_at: string;
  lastVerify: { success: boolean } | null;
};

type LineState = {
  facts: SessionFact[];
  /** Skills preloaded and skills called, by run: session, agent, skill. A call makes the preload one fact, not two. */
  preloaded: Map<string, PreloadedSkill>;
  called: Set<string>;
  agentId: string;
  windows: Map<string, SkillWindow | null>;
  pendingBash: Map<string, Map<string, BashPending>>;
  sessionIds: Set<string>;
  invocations: number;
  skipped_lines: number;
};

const runKey = (sid: string, agentId: string, skill: string) => `${sid}\0${agentId}\0${skill}`;

/** The skill name when this line is a `skills:` preload in a subagent log, else null. */
function preloadedSkillName(rec: Record<string, unknown>): string | null {
  if (rec.isSidechain !== true || rec.isMeta !== true || rec.type !== "user") return null;
  const msg = rec.message as { role?: unknown; content?: unknown } | null | undefined;
  if (!msg || msg.role !== "user") return null;
  const first: unknown = Array.isArray(msg.content) ? msg.content[0] : msg.content;
  const text =
    typeof first === "string" ? first : ((first as { text?: unknown } | null)?.text ?? "");
  const m = typeof text === "string" ? PRELOAD_RE.exec(text) : null;
  return m ? m[1]! : null;
}

function notePreload(state: LineState, sid: string, skill: string, ts: string | null): void {
  const key = runKey(sid, state.agentId, skill);
  if (!ts || state.preloaded.has(key)) return;
  state.preloaded.set(key, { sid, agentId: state.agentId, skill, used_at: ts, lastVerify: null });
  state.invocations++;
}

function flushPreloaded(state: LineState): void {
  for (const [key, p] of state.preloaded) {
    if (state.called.has(key)) continue;
    let verification: SessionFact["verification"] = "none";
    if (p.lastVerify) verification = p.lastVerify.success ? "pass" : "fail";
    state.facts.push({
      skill: p.skill,
      session_key: sessionKey(p.sid),
      used_at: p.used_at,
      verification,
      basis: "preloaded",
    });
  }
}

function handleSkillBlock(
  state: LineState,
  sid: string,
  bl: Record<string, unknown>,
  ts: string | null,
): void {
  const input =
    bl.input && typeof bl.input === "object" ? (bl.input as Record<string, unknown>) : null;
  const skill = input && typeof input.skill === "string" ? input.skill : null;
  if (!skill || !ts) return;
  state.called.add(runKey(sid, state.agentId, skill));
  const cur = state.windows.get(sid) ?? null;
  if (cur && cur.skill !== skill) {
    flushWindow(cur, state.facts, sid);
    state.windows.set(sid, { skill, used_at: ts, lastVerify: null });
  } else if (cur && cur.skill === skill) {
    flushWindow(cur, state.facts, sid);
    state.windows.set(sid, { skill, used_at: ts, lastVerify: null });
  } else {
    state.windows.set(sid, { skill, used_at: ts, lastVerify: null });
  }
  state.invocations++;
}

function handleBashBlock(state: LineState, sid: string, bl: Record<string, unknown>): void {
  const id = typeof bl.id === "string" ? bl.id : null;
  const input =
    bl.input && typeof bl.input === "object" ? (bl.input as Record<string, unknown>) : null;
  const command = input && typeof input.command === "string" ? input.command : "";
  if (!id) return;
  state.pendingBash.get(sid)!.set(id, {
    id,
    command,
    isVerify: isVerifyCommand(command),
  });
}

function handleToolResultBlock(state: LineState, sid: string, bl: Record<string, unknown>): void {
  const toolId = typeof bl.tool_use_id === "string" ? bl.tool_use_id : null;
  if (!toolId) return;
  const pending = state.pendingBash.get(sid)!.get(toolId);
  if (!pending) return;
  state.pendingBash.get(sid)!.delete(toolId);
  if (!pending.isVerify) return;
  const outcome = { success: resultSuccess(bl.is_error, toolResultText(bl)) };
  for (const p of state.preloaded.values()) {
    if (p.sid === sid && p.agentId === state.agentId) p.lastVerify = outcome;
  }
  const w = state.windows.get(sid);
  if (!w) return;
  w.lastVerify = outcome;
}

function processContentBlocks(
  state: LineState,
  sid: string,
  blocks: unknown[],
  ts: string | null,
): void {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const bl = block as Record<string, unknown>;
    const typ = bl.type;

    if (typ === "tool_use" && bl.name === "Skill") {
      handleSkillBlock(state, sid, bl, ts);
      continue;
    }

    if (typ === "tool_use" && bl.name === "Bash") {
      handleBashBlock(state, sid, bl);
      continue;
    }

    if (typ === "tool_result") {
      handleToolResultBlock(state, sid, bl);
    }
  }
}

/** The JSON object of a log line; empty lines give null, broken and oversized ones are counted as skipped. */
function parseLine(state: LineState, lineBuf: Buffer): Record<string, unknown> | null {
  let b = lineBuf;
  if (b.length > 0 && b[b.length - 1] === 0x0d) b = b.subarray(0, b.length - 1);
  if (b.length === 0) return null;
  let obj: unknown = null;
  if (b.length <= MAX_LINE_BYTES) {
    try {
      obj = JSON.parse(b.toString("utf8"));
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") {
    state.skipped_lines++;
    return null;
  }
  return obj as Record<string, unknown>;
}

function processLine(state: LineState, lineBuf: Buffer): void {
  const rec = parseLine(state, lineBuf);
  if (!rec) return;
  const sid = typeof rec.sessionId === "string" ? rec.sessionId : null;
  if (!sid) return;
  state.sessionIds.add(sid);
  if (!state.windows.has(sid)) state.windows.set(sid, null);
  if (!state.pendingBash.has(sid)) state.pendingBash.set(sid, new Map());

  const ts =
    typeof rec.timestamp === "string" && Number.isFinite(Date.parse(rec.timestamp))
      ? rec.timestamp
      : null;
  state.agentId = typeof rec.agentId === "string" ? rec.agentId : "";
  const preloaded = preloadedSkillName(rec);
  if (preloaded) notePreload(state, sid, preloaded, ts);
  processContentBlocks(state, sid, contentBlocks(rec.message), ts);
}

function parseFileSync(file: string): ParseResult {
  const state: LineState = {
    facts: [],
    preloaded: new Map(),
    called: new Set(),
    agentId: "",
    skipped_lines: 0,
    invocations: 0,
    sessionIds: new Set<string>(),
    windows: new Map(),
    pendingBash: new Map(),
  };

  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { facts: state.facts, sessions: 0, invocations: 0, skipped_lines: 0 };
  }

  try {
    const buf = Buffer.alloc(64 * 1024);
    let carry = Buffer.alloc(0);
    let eof = false;
    while (!eof) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) {
        eof = true;
        if (carry.length === 0) break;
      }
      const chunk = n > 0 ? Buffer.concat([carry, buf.subarray(0, n)]) : carry;
      carry = Buffer.alloc(0);
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) {
          const lineBuf = chunk.subarray(start, i);
          start = i + 1;
          processLine(state, lineBuf);
        }
      }
      if (!eof) {
        carry = chunk.subarray(start);
        if (carry.length > MAX_LINE_BYTES) {
          state.skipped_lines++;
          carry = Buffer.alloc(0);
          let skipRest = true;
          while (skipRest) {
            const n2 = fs.readSync(fd, buf, 0, buf.length, null);
            if (n2 === 0) {
              eof = true;
              skipRest = false;
              break;
            }
            const nl = buf.subarray(0, n2).indexOf(0x0a);
            if (nl >= 0) {
              carry = Buffer.from(buf.subarray(nl + 1, n2));
              skipRest = false;
            }
          }
        }
      } else if (start < chunk.length) {
        processLine(state, chunk.subarray(start));
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  for (const [sid, w] of state.windows) {
    flushWindow(w, state.facts, sid);
  }
  flushPreloaded(state);

  return {
    facts: state.facts,
    sessions: state.sessionIds.size,
    invocations: state.invocations,
    skipped_lines: state.skipped_lines,
  };
}

export const claudeCodeAdapter: SessionAdapter = {
  id: "claude-code",
  findFiles(root: string): string[] {
    const rootReal = realpathSafe(root);
    if (!rootReal) return [];
    const out: string[] = [];
    walkJsonl(root, rootReal, out, new Set([rootReal]));
    return out;
  },
  parse(file: string): ParseResult {
    return parseFileSync(file);
  },
};

// Silence unused import if readline kept for future stream API.
void readline;
