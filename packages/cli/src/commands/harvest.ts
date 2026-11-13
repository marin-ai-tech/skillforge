import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  draftRuleMarkdown,
  draftSkillMarkdown,
  harvestRules,
  type HarvestItem,
  type HarvestRule,
} from "@skillforge/core";
import type { AppContext } from "../context.ts";
import { setExit } from "../context.ts";
import { EXIT } from "../exit.ts";

/**
 * `skillforge harvest sessions` (skill-harvest): rules a person keeps asking the agent for, from local Claude Code
 * session logs, as a skill draft on disk. Only the person's own words count (not the agent's replies or tool
 * output), and nothing leaves the machine: review the draft, then publish it as usual.
 */
export type HarvestSessionsOpts = {
  dir?: string;
  out?: string;
  name?: string;
  min?: string;
  /** rule-artifacts: `rule` (default) or `skill`. */
  type?: string;
};

/** Where the draft goes and what it holds: a rule file, or a skill folder as before. */
function draftTarget(type: "rule" | "skill", out: string, name: string, rules: HarvestRule[]) {
  const origin = "your agent sessions";
  if (type === "rule") {
    const dir = path.join(out, "rules");
    return {
      dir,
      file: path.join(dir, `${name}.md`),
      text: draftRuleMarkdown(name, rules, origin),
    };
  }
  const dir = path.join(out, "skills", name);
  return { dir, file: path.join(dir, "SKILL.md"), text: draftSkillMarkdown(name, rules, origin) };
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FILES = 2000;

function sessionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root, 0);
  return out.sort();
}

/** Text the person typed: a string message, or its `text` blocks; tool results are not the person's words. */
function userText(rec: unknown): string | null {
  const r = rec as { type?: unknown; message?: { role?: unknown; content?: unknown } } | null;
  if (!r || r.type !== "user" || r.message?.role !== "user") return null;
  const content = r.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts = content
    .filter((b) => (b as { type?: unknown })?.type === "text")
    .map((b) => String((b as { text?: unknown }).text ?? ""));
  return texts.length > 0 ? texts.join("\n") : null;
}

function itemsOf(file: string, root: string): HarvestItem[] {
  const rel = path.relative(root, file).split(path.sep).join("/");
  const items: HarvestItem[] = [];
  let lines: string[];
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return items;
  }
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const text = userText(JSON.parse(line));
      if (text) items.push({ text, source: rel, ref: `${rel}:${i + 1}` });
    } catch {
      /* a broken line is skipped */
    }
  });
  return items;
}

/** Name, type and output folder of the draft, or null when the options are not usable. */
function draftOptions(
  opts: HarvestSessionsOpts,
): { name: string; type: "rule" | "skill"; out: string } | null {
  const name = opts.name ?? "";
  const type = opts.type ?? "rule";
  if (!NAME_RE.test(name) || !opts.out || (type !== "rule" && type !== "skill")) return null;
  return { name, type, out: path.resolve(opts.out) };
}

export async function runHarvestSessions(
  ctx: AppContext,
  opts: HarvestSessionsOpts,
): Promise<void> {
  const draft = draftOptions(opts);
  if (!draft) {
    ctx.out.error(
      "usage: skillforge harvest sessions --out <dir> --name <kebab-name> [--type rule|skill] [--dir <logs>] [--min 3]",
    );
    setExit(EXIT.INVALID_INPUT);
    return;
  }
  const { name, type } = draft;
  const root = path.resolve(opts.dir ?? path.join(os.homedir(), ".claude", "projects"));
  const min = opts.min ? Number(opts.min) : 3;
  const items = sessionFiles(root).flatMap((f) => itemsOf(f, root));
  const rules = harvestRules(items, { minCount: Number.isInteger(min) && min > 1 ? min : 3 });
  const { dir, file, text } = draftTarget(type, draft.out, name, rules);
  if (rules.length > 0) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  }
  if (ctx.out.json) {
    ctx.out.printJson({ rules, file: rules.length > 0 ? file : null });
  } else if (rules.length === 0) {
    ctx.out.write("No recurring rules found in the session logs.");
  } else {
    ctx.out.write(
      `Draft written to ${file} with ${rules.length} rules. Review it, then: skillforge publish ${type === "rule" ? file : dir}`,
    );
  }
  setExit(EXIT.OK);
}
