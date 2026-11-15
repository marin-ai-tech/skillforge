import fs from "node:fs";
import path from "node:path";
import {
  findRulesBlock,
  renderRulesBlock,
  replaceRulesBlock,
  runtimeDef,
  runtimeSupport,
  sharedRuleFile,
  type BlockRule,
  type RuntimeDef,
  type RuntimeId,
  type RuntimeScope,
} from "@skillforge/core";
import { assertRealPathsInside } from "./bundle.ts";
import { ApiError } from "./client.ts";
import type { AppContext } from "./context.ts";
import { EXIT } from "./exit.ts";
import { readLock, sha256Hex, type LockFile } from "./lock.ts";

/**
 * rules-block: a rule for Codex, Gemini CLI or Qwen Code is kept as a copy in `skillforge/rules/<name>.md` (in the
 * lock), and the agent's shared file in the project root carries the SkillForge block built from those copies.
 * `.codex/rules/` is not used: Codex keeps its command rules (`*.rules`) there.
 */
export const RULE_COPY_DIR = "skillforge/rules";
const CODEX_DOC_LIMIT = 32 * 1024;
/** Agents that read AGENTS.md besides Codex (their own rules too), so a rule in both places reaches them twice. */
const AGENTS_MD_READERS: readonly RuntimeId[] = ["opencode", "cursor", "qwen"];

export function ruleCopyPath(name: string): string {
  return `${RULE_COPY_DIR}/${name}.md`;
}

/** Whether installing or removing `type` for this target goes through the SkillForge block. */
export function usesRulesBlock(
  runtime: RuntimeDef | null,
  scope: RuntimeScope,
  type: string,
): runtime is RuntimeDef {
  if (type !== "rule" || runtime === null) return false;
  const support = runtimeSupport(runtime, "rule", scope);
  return support.supported && support.method === "rules-block";
}

type SharedFile = { file: string; abs: string; text: string | null };

function readShared(runtime: RuntimeDef, into: string): SharedFile {
  const file = sharedRuleFile(runtime.id);
  if (file === null) throw new Error(`${runtime.id} has no shared rules file`);
  const projectRoot = path.dirname(into);
  const abs = path.join(projectRoot, file);
  assertRealPathsInside(projectRoot, [abs]);
  return { file, abs, text: fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null };
}

function ruleNames(lock: LockFile): string[] {
  return Object.keys(lock.artifacts)
    .filter((key) => key.startsWith("rule/"))
    .map((key) => key.slice("rule/".length));
}

function blockRules(into: string, lock: LockFile): BlockRule[] {
  const rules: BlockRule[] = [];
  for (const name of ruleNames(lock)) {
    const rel = ruleCopyPath(name);
    const abs = path.join(into, ...rel.split("/"));
    if (lock.artifacts[`rule/${name}`]?.files[rel] === undefined || !fs.existsSync(abs)) continue;
    rules.push({ name, text: fs.readFileSync(abs, "utf8") });
  }
  return rules;
}

function editedCopies(into: string, lock: LockFile): string[] {
  const dirty: string[] = [];
  for (const name of ruleNames(lock)) {
    const rel = ruleCopyPath(name);
    const expected = lock.artifacts[`rule/${name}`]?.files[rel];
    const abs = path.join(into, ...rel.split("/"));
    if (expected === undefined || !fs.existsSync(abs)) continue;
    if (sha256Hex(fs.readFileSync(abs)) !== expected) dirty.push(rel);
  }
  return dirty;
}

/**
 * Before any write: the markers in the shared file are whole, the rule copies match the lock, and the block is what
 * the lock builds (a hand edit is refused, `--force` rebuilds it). A missing block is not an edit: it is written again.
 */
export function checkRulesBlock(
  runtime: RuntimeDef,
  into: string,
  force: boolean | undefined,
): void {
  const shared = readShared(runtime, into);
  const search = findRulesBlock(shared.text ?? "");
  if (!search.ok) {
    throw new ApiError(
      `${shared.file}: ${search.reason}; fix the markers by hand, then try again`,
      EXIT.VALIDATION,
    );
  }
  if (force) return;
  const lock = readLock(into);
  const dirty = editedCopies(into, lock);
  if (dirty.length > 0) {
    throw new ApiError(
      `local changes detected in ${dirty.join(", ")}; use --force to overwrite`,
      EXIT.LOCAL_CHANGES,
    );
  }
  if (search.found === null) return;
  const expected = renderRulesBlock(blockRules(into, lock), runtime.id);
  if (search.found.text.replace(/\r\n/g, "\n") !== expected) {
    throw new ApiError(
      `${shared.file}: the SkillForge rules block was edited by hand; change the rule in the registry, or use --force to rebuild the block`,
      EXIT.LOCAL_CHANGES,
    );
  }
}

/** Writes the block built from the lock into the shared file; removes the file when nothing else is left in it. */
export function writeRulesBlock(
  ctx: AppContext,
  runtime: RuntimeDef,
  into: string,
  quiet: boolean,
): void {
  const shared = readShared(runtime, into);
  const next = replaceRulesBlock(
    shared.text,
    renderRulesBlock(blockRules(into, readLock(into)), runtime.id),
  );
  if (next !== shared.text) {
    if (next === null) fs.unlinkSync(shared.abs);
    else fs.writeFileSync(shared.abs, next);
  }
  const size = next === null ? 0 : Buffer.byteLength(next, "utf8");
  if (runtime.id === "codex" && size > CODEX_DOC_LIMIT && !quiet) {
    ctx.out.error(
      `warning: ${shared.file} is ${Math.ceil(size / 1024)} KiB; Codex reads at most 32 KiB of AGENTS.md files by default and drops the rest without a message (raise project_doc_max_bytes in the Codex config)`,
    );
  }
}

/** A rule installed for Codex (AGENTS.md) and for an agent that also reads AGENTS.md reaches that agent twice. */
export function warnDoubleRule(
  ctx: AppContext,
  runtime: RuntimeDef | null,
  scope: RuntimeScope,
  into: string,
  key: string,
): void {
  if (runtime === null || scope !== "project" || !key.startsWith("rule/")) return;
  const others: readonly RuntimeId[] =
    runtime.id === "codex"
      ? AGENTS_MD_READERS
      : AGENTS_MD_READERS.includes(runtime.id)
        ? ["codex"]
        : [];
  const projectRoot = path.dirname(into);
  for (const id of others) {
    const other = runtimeDef(id);
    if (readLock(path.join(projectRoot, other.project_dir)).artifacts[key] === undefined) continue;
    const reader = runtime.id === "codex" ? other.label : runtime.label;
    ctx.out.error(
      `warning: ${key} is also installed for ${id}; ${reader} reads AGENTS.md too and will see this rule twice — keep one of the two installs`,
    );
  }
}
