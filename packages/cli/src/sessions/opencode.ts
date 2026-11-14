import fs from "node:fs";
import type { ParseResult, SessionAdapter, SessionFact } from "./adapter.ts";
import { VERIFY_RE, findSessionFiles, sessionKey } from "./walk.ts";

/**
 * opencode-sessions: one OpenCode session export (`opencode export <id>`) per `*.json` file —
 * `{ info: { id }, messages: [{ info: { time }, parts: [...] }] }`, shape of OpenCode 1.18.34. A skill use is a
 * completed `skill` tool part; a check is a `bash` part whose command matches VERIFY_RE, passed when its exit code is 0.
 * Only the skill name, the hashed session id, the time and the verdict leave this module.
 */

type Part = {
  type?: unknown;
  tool?: unknown;
  state?: {
    status?: unknown;
    input?: { name?: unknown; command?: unknown };
    metadata?: { exit?: unknown };
    time?: { start?: unknown };
  };
};
type Message = { info?: { time?: { created?: unknown } }; parts?: unknown };
type Window = { skill: string; used_at: string; verdict: SessionFact["verification"] };

/** UTF-8 with or without BOM, or UTF-16 with BOM (a `>` redirect in Windows PowerShell 5 writes UTF-16 LE). */
export function decodeExport(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const le = Buffer.from(buf.subarray(2));
    le.swap16();
    return le.toString("utf16le");
  }
  const text = buf.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isoTime(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function skillUse(part: Part, msg: Message): { skill: string; used_at: string } | null {
  if (part.type !== "tool" || part.tool !== "skill") return null;
  const st = part.state;
  if (!st || st.status !== "completed" || typeof st.input?.name !== "string") return null;
  const used_at = isoTime(st.time?.start) ?? isoTime(msg.info?.time?.created);
  return used_at ? { skill: st.input.name, used_at } : null;
}

/** null: not a check; otherwise whether it passed. */
function checkResult(part: Part): boolean | null {
  if (part.type !== "tool" || part.tool !== "bash") return null;
  const st = part.state;
  if (typeof st?.input?.command !== "string" || !VERIFY_RE.test(st.input.command)) return null;
  const exit = st.metadata?.exit;
  if (typeof exit === "number") return exit === 0;
  return st.status === "completed";
}

function partsOf(msg: Message): Part[] {
  return Array.isArray(msg.parts) ? (msg.parts as Part[]) : [];
}

function sessionFacts(
  sessionId: string,
  messages: Message[],
): { facts: SessionFact[]; uses: number } {
  const facts: SessionFact[] = [];
  let open: Window | null = null;
  const flush = () => {
    if (open) {
      facts.push({
        skill: open.skill,
        session_key: sessionKey(sessionId),
        used_at: open.used_at,
        verification: open.verdict,
      });
    }
  };
  for (const msg of messages) {
    for (const part of partsOf(msg)) {
      const use = skillUse(part, msg);
      if (use) {
        flush();
        open = { ...use, verdict: "none" };
        continue;
      }
      const passed = checkResult(part);
      if (open && passed !== null) open.verdict = passed ? "pass" : "fail";
    }
  }
  flush();
  return { facts, uses: facts.length };
}

function readExport(file: string): { id: string; messages: Message[] } | null {
  try {
    const data = JSON.parse(decodeExport(fs.readFileSync(file))) as {
      info?: { id?: unknown };
      messages?: unknown;
    };
    if (typeof data?.info?.id !== "string" || !Array.isArray(data.messages)) return null;
    return { id: data.info.id, messages: data.messages as Message[] };
  } catch {
    return null;
  }
}

export const opencodeAdapter: SessionAdapter = {
  id: "opencode",
  findFiles(root: string): string[] {
    return findSessionFiles(root, ".json");
  },
  parse(file: string): ParseResult {
    const session = readExport(file);
    if (!session) return { facts: [], sessions: 0, invocations: 0, skipped_lines: 1 };
    const { facts, uses } = sessionFacts(session.id, session.messages);
    return { facts, sessions: 1, invocations: uses, skipped_lines: 0 };
  },
};
