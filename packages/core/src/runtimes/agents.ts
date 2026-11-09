import { stringify as stringifyYaml } from "yaml";
import type { RuntimeId, RuntimeInstallMethod } from "./table.ts";
import {
  frontmatterString,
  splitFrontmatter,
  tomlBasicString,
  tomlMultilineString,
} from "./translate.ts";

export type AgentTranslation = {
  /** Path relative to the runtime base directory. */
  path: string;
  content: string;
  warnings: string[];
};

export type AgentTranslateMethod = Extract<
  RuntimeInstallMethod,
  "files" | "codex-toml" | "opencode-agent" | "cursor-agent"
>;

type SplitAgent = {
  description: string | null;
  body: string;
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
  return { description: frontmatterString(frontmatter?.description), body, warnings };
}

function markdownAgent(fm: Record<string, string>, body: string): string {
  return `---\n${stringifyYaml(fm, { lineWidth: 0 })}---\n${body}`;
}

/**
 * Codex custom agent (`agents/<name>.toml`): `name`, `description` and the body as `developer_instructions`,
 * decoded back exactly as written.
 */
export function toCodexAgentToml(name: string, text: string): AgentTranslation {
  const { description, body, warnings } = splitAgent(name, text, "codex", ["name", "description"]);
  const lines = [`name = ${tomlBasicString(name)}`];
  if (description !== null) lines.push(`description = ${tomlBasicString(description)}`);
  lines.push(`developer_instructions = ${tomlMultilineString(body)}`);
  return { path: `agents/${name}.toml`, content: `${lines.join("\n")}\n`, warnings };
}

/**
 * OpenCode agent (`agents/<name>.md`): frontmatter exactly `description` + `mode: subagent` (OpenCode rejects its
 * whole configuration for Claude Code values of `color` or `tools`; the name comes from the file name), body unchanged.
 */
export function toOpenCodeAgent(name: string, text: string): AgentTranslation {
  const { description, body, warnings } = splitAgent(name, text, "opencode", ["description"]);
  const fm: Record<string, string> =
    description === null ? { mode: "subagent" } : { description, mode: "subagent" };
  return { path: `agents/${name}.md`, content: markdownAgent(fm, body), warnings };
}

/** Cursor agent (`agents/<name>.md`): frontmatter `name` + `description`, body unchanged. */
export function toCursorAgent(name: string, text: string): AgentTranslation {
  const { description, body, warnings } = splitAgent(name, text, "cursor", ["name", "description"]);
  const fm: Record<string, string> = description === null ? { name } : { name, description };
  return { path: `agents/${name}.md`, content: markdownAgent(fm, body), warnings };
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
    case "files":
      return { path: `agents/${name}.md`, content: text, warnings: [] };
  }
}
