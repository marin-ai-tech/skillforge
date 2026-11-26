import { stringify as stringifyYaml } from "yaml";
import type { RuntimeId, RuntimeInstallMethod } from "./table.ts";
import {
  frontmatterString,
  splitFrontmatter,
  tomlBasicString,
  tomlMultilineString,
} from "./translate.ts";

/** A class of tools an agent may forbid itself (agent-restrictions-translation). */
export type RestrictionClass = "edit" | "shell" | "network";

/** Tool Restrictions: `true` — the agent forbids itself this class. */
export type ToolRestrictions = Readonly<Record<RestrictionClass, boolean>>;

const CLASSES: readonly RestrictionClass[] = ["edit", "shell", "network"];

/** Tool names of each class in the vocabularies of Claude Code, sdlc and Qwen Code (lower case). */
const CLASS_TOOLS: Readonly<Record<RestrictionClass, readonly string[]>> = {
  edit: ["edit", "write", "multiedit", "notebookedit", "write_file", "replace"],
  shell: ["bash", "powershell", "shell", "run_shell_command", "exec"],
  network: ["webfetch", "websearch", "web_fetch", "web_search"],
};

export type AgentTranslation = {
  /** Path relative to the runtime base directory. */
  path: string;
  content: string;
  warnings: string[];
  /** Restrictions the agent forbids itself that this runtime cannot enforce; the CLI refuses unless allowed. */
  unenforced: RestrictionClass[];
};

export type AgentTranslateMethod = Extract<
  RuntimeInstallMethod,
  "files" | "codex-toml" | "opencode-agent" | "cursor-agent" | "qwen-agent"
>;

/** `tools: Read, Grep` or `tools: [read, grep]` → lower-case tool names; a rule pattern `Bash(git:*)` names `bash`. */
function toolNames(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  const items = Array.isArray(raw) ? raw : String(raw).split(",");
  return items
    .map((t) => String(t).trim().toLowerCase().replace(/\(.*$/, ""))
    .filter((t) => t !== "");
}

const hasClass = (names: readonly string[], cls: RestrictionClass) =>
  names.some((n) => CLASS_TOOLS[cls].includes(n));

/**
 * The restrictions an agent's frontmatter states: `tools` is an allow-list (a class with none of its tools listed is
 * forbidden), `disallowedTools` forbids a class it names, `readonly: true` forbids editing.
 */
export function toolRestrictions(frontmatter: Record<string, unknown> | null): ToolRestrictions {
  const allowed = toolNames(frontmatter?.tools);
  const denied = toolNames(frontmatter?.disallowedTools) ?? [];
  const forbid = (cls: RestrictionClass) =>
    (allowed !== null && !hasClass(allowed, cls)) || hasClass(denied, cls);
  return {
    edit: forbid("edit") || frontmatter?.readonly === true,
    shell: forbid("shell"),
    network: forbid("network"),
  };
}

const forbidden = (r: ToolRestrictions) => CLASSES.filter((c) => r[c]);

type SplitAgent = {
  description: string | null;
  body: string;
  restrictions: ToolRestrictions;
  /** One warning naming every frontmatter key outside `kept`; empty when nothing is dropped. */
  warnings: string[];
};

function splitAgent(
  name: string,
  text: string,
  runtime: RuntimeId,
  kept: readonly string[],
): SplitAgent {
  const { frontmatter, body } = splitFrontmatter(text);
  const dropped = Object.keys(frontmatter ?? {}).filter((key) => !kept.includes(key));
  const warnings =
    dropped.length === 0
      ? []
      : [`agent ${name}: dropped ${dropped.join(", ")} (not supported by ${runtime})`];
  return {
    description: frontmatterString(frontmatter?.description),
    body,
    restrictions: toolRestrictions(frontmatter),
    warnings,
  };
}

function markdownAgent(fm: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(fm, { lineWidth: 0 })}---\n${body}`;
}

/** The classes forbidden by the agent that `enforced` (what the runtime can express) does not cover. */
function notEnforced(
  r: ToolRestrictions,
  enforced: readonly RestrictionClass[],
): RestrictionClass[] {
  return forbidden(r).filter((c) => !enforced.includes(c));
}

/**
 * Codex custom agent (`agents/<name>.toml`): `name`, `description` and the body as `developer_instructions`,
 * decoded back exactly as written. Editing is forbidden by the read-only sandbox, network by `web_search =
 * "disabled"`; Codex has no switch for the shell.
 */
export function toCodexAgentToml(name: string, text: string): AgentTranslation {
  const { description, body, restrictions, warnings } = splitAgent(name, text, "codex", [
    "name",
    "description",
  ]);
  const lines = [`name = ${tomlBasicString(name)}`];
  if (description !== null) lines.push(`description = ${tomlBasicString(description)}`);
  if (restrictions.edit) lines.push('sandbox_mode = "read-only"');
  if (restrictions.network) lines.push('web_search = "disabled"');
  lines.push(`developer_instructions = ${tomlMultilineString(body)}`);
  return {
    path: `agents/${name}.toml`,
    content: `${lines.join("\n")}\n`,
    warnings,
    unenforced: notEnforced(restrictions, ["edit", "network"]),
  };
}

const OPENCODE_PERMISSION: Readonly<Record<RestrictionClass, string>> = {
  edit: "edit",
  shell: "bash",
  network: "webfetch",
};

/**
 * OpenCode agent (`agents/<name>.md`): frontmatter `description` + `mode: subagent` (OpenCode rejects its whole
 * configuration for Claude Code values of `color` or `tools`; the name comes from the file name), and `permission`
 * with `deny` for each forbidden class (checked with `opencode debug agent`), body unchanged.
 */
export function toOpenCodeAgent(name: string, text: string): AgentTranslation {
  const { description, body, restrictions, warnings } = splitAgent(name, text, "opencode", [
    "description",
  ]);
  const fm: Record<string, unknown> =
    description === null ? { mode: "subagent" } : { description, mode: "subagent" };
  const deny = forbidden(restrictions);
  if (deny.length > 0) {
    fm.permission = Object.fromEntries(deny.map((c) => [OPENCODE_PERMISSION[c], "deny"]));
  }
  return { path: `agents/${name}.md`, content: markdownAgent(fm, body), warnings, unenforced: [] };
}

/** Cursor agent (`agents/<name>.md`): frontmatter `name` + `description` (+ `readonly: true`), body unchanged. */
export function toCursorAgent(name: string, text: string): AgentTranslation {
  const { description, body, restrictions, warnings } = splitAgent(name, text, "cursor", [
    "name",
    "description",
  ]);
  const fm: Record<string, unknown> = description === null ? { name } : { name, description };
  if (restrictions.edit) fm.readonly = true;
  return {
    path: `agents/${name}.md`,
    content: markdownAgent(fm, body),
    warnings,
    unenforced: notEnforced(restrictions, ["edit"]),
  };
}

/** Qwen Code tool names of each class (`ToolNames` of Qwen Code 0.25). */
const QWEN_TOOLS: Readonly<Record<RestrictionClass, readonly string[]>> = {
  edit: ["edit", "write_file"],
  shell: ["run_shell_command", "exec"],
  network: ["web_fetch", "web_search"],
};

/**
 * Qwen Code agent (`agents/<name>.md`): frontmatter `name` + `description` and `disallowedTools` in Qwen tool names
 * for each forbidden class (Qwen does not know the tool names of Claude Code or sdlc in `tools`), body unchanged.
 */
export function toQwenAgent(name: string, text: string): AgentTranslation {
  const { description, body, restrictions, warnings } = splitAgent(name, text, "qwen", [
    "name",
    "description",
  ]);
  const fm: Record<string, unknown> = description === null ? { name } : { name, description };
  const deny = forbidden(restrictions).flatMap((c) => QWEN_TOOLS[c]);
  if (deny.length > 0) fm.disallowedTools = deny;
  return { path: `agents/${name}.md`, content: markdownAgent(fm, body), warnings, unenforced: [] };
}

/**
 * Claude Code agent: the file as is. Claude Code applies `tools` and `disallowedTools` but not `readonly`, so editing
 * forbidden only by `readonly` is not enforced.
 */
function claudeCodeAgent(name: string, text: string): AgentTranslation {
  const { frontmatter } = splitFrontmatter(text);
  const stated = toolRestrictions(frontmatter);
  const applied = toolRestrictions(frontmatter ? { ...frontmatter, readonly: undefined } : null);
  return {
    path: `agents/${name}.md`,
    content: text,
    warnings: [],
    unenforced: stated.edit && !applied.edit ? ["edit"] : [],
  };
}

/** Translates a Claude Code agent file for the given install method (`files` — unchanged). */
export function translateAgent(
  method: AgentTranslateMethod,
  name: string,
  text: string,
): AgentTranslation {
  switch (method) {
    case "codex-toml":
      return toCodexAgentToml(name, text);
    case "opencode-agent":
      return toOpenCodeAgent(name, text);
    case "cursor-agent":
      return toCursorAgent(name, text);
    case "qwen-agent":
      return toQwenAgent(name, text);
    case "files":
      return claudeCodeAgent(name, text);
  }
}
