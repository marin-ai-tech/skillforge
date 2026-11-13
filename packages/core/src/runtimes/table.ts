import type { ArtifactType } from "../artifact/types.ts";

export type RuntimeId =
  "claude-code" | "codex" | "gemini" | "cursor" | "opencode" | "qwen" | "devin" | "reckon";

export type RuntimeScope = "project" | "user";

/**
 * How an artifact type is installed for a runtime:
 * `files` — canonical bundle paths as is; `gemini-toml` / `opencode-md` / `cursor-md` / `qwen-md` — command
 * translation; `codex-toml` / `opencode-agent` / `cursor-agent` — agent translation;
 * `plugin` — only via the Claude Code marketplace (`/plugin install`); `settings` — only `skillforge settings apply`.
 */
export type RuntimeInstallMethod =
  | "files"
  | "gemini-toml"
  | "opencode-md"
  | "cursor-md"
  | "qwen-md"
  | "codex-toml"
  | "opencode-agent"
  | "cursor-agent"
  | "cursor-rule"
  | "plugin"
  | "settings";

export type RuntimeTypeSupport =
  | { method: RuntimeInstallMethod; scopes?: readonly RuntimeScope[]; scope_reason?: string }
  | { method: null; reason: string };

export type RuntimeDef = {
  id: RuntimeId;
  label: string;
  docs_url: string;
  project_dir: string;
  user_dir: string | null;
  types: Readonly<Record<ArtifactType, RuntimeTypeSupport>>;
};

export type RuntimeSupport =
  { supported: true; method: RuntimeInstallMethod } | { supported: false; reason: string };

const skillHint = "publish it as a skill";

function agentsUnsupported(id: RuntimeId): RuntimeTypeSupport {
  return {
    method: null,
    reason: `agents are not supported by ${id} (it has no subagent format SkillForge installs); publish the instructions as a skill`,
  };
}

function hooksOnlyClaude(id: RuntimeId): RuntimeTypeSupport {
  return {
    method: null,
    reason: `hooks are not supported by ${id} (its hooks use a different event and settings schema); install the hook in Claude Code with /plugin install`,
  };
}

function pluginsOnlyClaude(id: RuntimeId): RuntimeTypeSupport {
  return {
    method: null,
    reason: `Claude Code plugins are not supported by ${id}; install the plugin in Claude Code with /plugin install`,
  };
}

function settingsOnlyClaude(id: RuntimeId): RuntimeTypeSupport {
  return {
    method: null,
    reason: `settings profiles are not supported by ${id} (they target Claude Code settings.json)`,
  };
}

/** MCP servers are described in the registry but not installed into agents yet (epic MCP, M6). */
function mcpServerNotInstalled(id: RuntimeId): RuntimeTypeSupport {
  return {
    method: null,
    reason: `an MCP server is not installed by SkillForge yet (planned); configure it in ${id} by hand as the artifact page shows`,
  };
}

/** Where an agent without a rules folder reads its rules (rule-artifacts: writing there is the next step). */
const SHARED_RULE_FILES: Partial<Record<RuntimeId, string>> = {
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  qwen: "QWEN.md",
};

function rulesUnsupported(id: RuntimeId): RuntimeTypeSupport {
  const shared = SHARED_RULE_FILES[id];
  return {
    method: null,
    reason: shared
      ? `rules are not installed into ${id} yet: ${id} reads its rules from ${shared}, and writing into that shared file is planned`
      : `rules are not supported by ${id} (it has no rules folder SkillForge installs into)`,
  };
}

function nonClaudeTypes(
  id: RuntimeId,
  command: RuntimeTypeSupport,
  agent: RuntimeTypeSupport = agentsUnsupported(id),
  rule: RuntimeTypeSupport = rulesUnsupported(id),
): Readonly<Record<ArtifactType, RuntimeTypeSupport>> {
  return {
    skill: { method: "files" },
    command,
    agent,
    hook: hooksOnlyClaude(id),
    plugin: pluginsOnlyClaude(id),
    settings: settingsOnlyClaude(id),
    "mcp-server": mcpServerNotInstalled(id),
    rule,
  };
}

/** Runtimes SkillForge installs into, in display order. Sources: `docs_url` of each entry. */
export const RUNTIMES: readonly RuntimeDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    docs_url: "https://docs.anthropic.com/en/docs/claude-code/skills",
    project_dir: ".claude",
    user_dir: ".claude",
    types: {
      skill: { method: "files" },
      command: { method: "files" },
      agent: { method: "files" },
      hook: { method: "plugin" },
      plugin: { method: "plugin" },
      settings: { method: "settings" },
      "mcp-server": mcpServerNotInstalled("claude-code"),
      rule: { method: "files" },
    },
  },
  {
    id: "codex",
    label: "Codex",
    docs_url: "https://developers.openai.com/codex/skills",
    project_dir: ".codex",
    user_dir: ".codex",
    types: nonClaudeTypes(
      "codex",
      {
        method: null,
        reason: `commands are not supported by codex (custom prompts are deprecated); ${skillHint}`,
      },
      { method: "codex-toml" },
    ),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    docs_url: "https://geminicli.com/docs/cli/skills",
    project_dir: ".gemini",
    user_dir: ".gemini",
    types: nonClaudeTypes("gemini", { method: "gemini-toml" }),
  },
  {
    id: "cursor",
    label: "Cursor",
    docs_url: "https://cursor.com/docs/skills",
    project_dir: ".cursor",
    user_dir: ".cursor",
    types: nonClaudeTypes(
      "cursor",
      {
        method: "cursor-md",
        scopes: ["project"],
        scope_reason:
          "commands are not supported by cursor in the user scope (Cursor documents project commands only); use --scope project",
      },
      { method: "cursor-agent" },
      {
        method: "cursor-rule",
        scopes: ["project"],
        scope_reason:
          "rules are not supported by cursor in the user scope (Cursor keeps user rules in its settings, not in files); use --scope project",
      },
    ),
  },
  {
    id: "opencode",
    label: "OpenCode",
    docs_url: "https://opencode.ai/docs/skills",
    project_dir: ".opencode",
    user_dir: ".config/opencode",
    types: nonClaudeTypes("opencode", { method: "opencode-md" }, { method: "opencode-agent" }),
  },
  {
    id: "qwen",
    label: "Qwen Code",
    docs_url: "https://github.com/QwenLM/qwen-code",
    project_dir: ".qwen",
    user_dir: ".qwen",
    types: nonClaudeTypes("qwen", { method: "qwen-md" }, { method: "files" }),
  },
  {
    id: "devin",
    label: "Devin",
    docs_url: "https://docs.devin.ai/product-guides/skills",
    project_dir: ".agents",
    user_dir: null,
    types: nonClaudeTypes("devin", {
      method: null,
      reason: `commands are not supported by devin; ${skillHint}`,
    }),
  },
  {
    id: "reckon",
    label: "Reckon",
    docs_url: "https://github.com/ArtenaTech/reckon-agent",
    project_dir: ".reckon",
    user_dir: null,
    types: nonClaudeTypes("reckon", {
      method: null,
      reason: `commands are not supported by reckon; ${skillHint}`,
    }),
  },
];

export const RUNTIME_IDS: readonly RuntimeId[] = RUNTIMES.map((r) => r.id);

export function isRuntimeId(value: string): value is RuntimeId {
  return (RUNTIME_IDS as readonly string[]).includes(value);
}

export function runtimeDef(id: RuntimeId): RuntimeDef {
  return RUNTIMES.find((r) => r.id === id)!;
}

export function runtimeScopes(runtime: RuntimeDef): RuntimeScope[] {
  return runtime.user_dir === null ? ["project"] : ["project", "user"];
}

/** Base directory of a runtime relative to the project (`project`) or the home directory (`user`). */
export function runtimeDir(runtime: RuntimeDef, scope: RuntimeScope): string | null {
  return scope === "user" ? runtime.user_dir : runtime.project_dir;
}

/** Install method for an artifact type in a runtime and scope, or the reason it is not supported. */
export function runtimeSupport(
  runtime: RuntimeDef,
  type: ArtifactType,
  scope: RuntimeScope = "project",
): RuntimeSupport {
  const entry = runtime.types[type];
  if (entry.method === null) return { supported: false, reason: entry.reason };
  if (runtimeDir(runtime, scope) === null) {
    return {
      supported: false,
      reason: `the ${scope} scope is not supported by ${runtime.id} (no ${scope}-level directory); use --scope project`,
    };
  }
  if (entry.scopes && !entry.scopes.includes(scope)) {
    return {
      supported: false,
      reason: entry.scope_reason ?? `the ${scope} scope is not supported by ${runtime.id}`,
    };
  }
  return { supported: true, method: entry.method };
}
