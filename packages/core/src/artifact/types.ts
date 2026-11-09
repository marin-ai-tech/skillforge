export type ArtifactType =
  "skill" | "command" | "agent" | "hook" | "plugin" | "settings" | "mcp-server";

export type PluginComponentType = "skill" | "command" | "agent" | "hook" | "mcp_server";

export type PluginComponent = {
  type: PluginComponentType;
  name: string;
  path: string;
};

export type ArtifactFileInput = {
  path: string;
  content: string | Uint8Array;
};

export type ParseInput = {
  type: string;
  files: ArtifactFileInput[];
  name?: string;
  description?: string;
};

export const ISSUE_CODES = {
  E_TYPE_UNKNOWN: "E_TYPE_UNKNOWN",
  E_PATH_UNSAFE: "E_PATH_UNSAFE",
  E_PATH_FORBIDDEN: "E_PATH_FORBIDDEN",
  E_PATH_DUPLICATE: "E_PATH_DUPLICATE",
  E_BUNDLE_TOO_LARGE: "E_BUNDLE_TOO_LARGE",
  E_FILE_TOO_LARGE: "E_FILE_TOO_LARGE",
  E_TOO_MANY_FILES: "E_TOO_MANY_FILES",
  E_FRONTMATTER_INVALID: "E_FRONTMATTER_INVALID",
  E_FRONTMATTER_MISSING: "E_FRONTMATTER_MISSING",
  E_NAME_INVALID: "E_NAME_INVALID",
  E_NAME_MISMATCH: "E_NAME_MISMATCH",
  E_NAME_DIR_MISMATCH: "E_NAME_DIR_MISMATCH",
  E_DESCRIPTION_MISSING: "E_DESCRIPTION_MISSING",
  E_DESCRIPTION_TOO_LONG: "E_DESCRIPTION_TOO_LONG",
  E_SKILL_MD_MISSING: "E_SKILL_MD_MISSING",
  E_COMPATIBILITY_TOO_LONG: "E_COMPATIBILITY_TOO_LONG",
  E_METADATA_INVALID: "E_METADATA_INVALID",
  E_BODY_EMPTY: "E_BODY_EMPTY",
  E_SECURITY_BLOCKED: "E_SECURITY_BLOCKED",
  E_RUBRIC_BLOCKED: "E_RUBRIC_BLOCKED",
  E_SINGLE_FILE_REQUIRED: "E_SINGLE_FILE_REQUIRED",
  E_HOOKS_JSON_MISSING: "E_HOOKS_JSON_MISSING",
  E_HOOKS_JSON_INVALID: "E_HOOKS_JSON_INVALID",
  E_HOOK_ENTRY_INVALID: "E_HOOK_ENTRY_INVALID",
  E_AGENT_ISOLATION_INVALID: "E_AGENT_ISOLATION_INVALID",
  W_FILE_DROPPED: "W_FILE_DROPPED",
  W_FRONTMATTER_LOOSE: "W_FRONTMATTER_LOOSE",
  W_UNKNOWN_FRONTMATTER_KEY: "W_UNKNOWN_FRONTMATTER_KEY",
  W_SINGLE_FILE_SKILL: "W_SINGLE_FILE_SKILL",
  W_SKILL_MD_LONG: "W_SKILL_MD_LONG",
  W_REFERENCE_MISSING: "W_REFERENCE_MISSING",
  W_NAME_FILE_MISMATCH: "W_NAME_FILE_MISMATCH",
  W_HOOK_EVENT_UNKNOWN: "W_HOOK_EVENT_UNKNOWN",
  W_SCRIPT_MISSING: "W_SCRIPT_MISSING",
  E_PLUGIN_MANIFEST_MISSING: "E_PLUGIN_MANIFEST_MISSING",
  E_PLUGIN_MANIFEST_INVALID: "E_PLUGIN_MANIFEST_INVALID",
  E_PLUGIN_EMPTY: "E_PLUGIN_EMPTY",
  E_PLUGIN_MCP_INVALID: "E_PLUGIN_MCP_INVALID",
  E_SETTINGS_JSON_MISSING: "E_SETTINGS_JSON_MISSING",
  E_SETTINGS_JSON_INVALID: "E_SETTINGS_JSON_INVALID",
  E_SETTINGS_SECRET: "E_SETTINGS_SECRET",
  E_SETTINGS_RUNTIME: "E_SETTINGS_RUNTIME",
  W_SETTINGS_KEY_UNKNOWN: "W_SETTINGS_KEY_UNKNOWN",
  E_MCP_JSON_INVALID: "E_MCP_JSON_INVALID",
  E_MCP_UNPINNED: "E_MCP_UNPINNED",
  E_MCP_SECRET_LITERAL: "E_MCP_SECRET_LITERAL",
  E_MCP_TRANSPORT_UNKNOWN: "E_MCP_TRANSPORT_UNKNOWN",
  E_MCP_SHELL: "E_MCP_SHELL",
  E_MCP_URL_INVALID: "E_MCP_URL_INVALID",
  E_MCP_POLICY: "E_MCP_POLICY",
} as const;

export type IssueCode = keyof typeof ISSUE_CODES;

export type Issue = {
  code: IssueCode;
  message: string;
  path?: string;
};

export type ParsedArtifact = {
  type: ArtifactType;
  name: string;
  description: string;
  displayName: string | null;
  tags: string[];
  frontmatter: Record<string, unknown> | null;
  files: Array<{ path: string; sha256: string; size: number }>;
  canonical: Array<{ path: string; content: Uint8Array }>;
  digest: string;
  /** Present for type=plugin: sorted component inventory. */
  components?: PluginComponent[];
};

export type ParseResult =
  | { ok: true; artifact: ParsedArtifact; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

export const LIMITS = {
  maxBundleBytes: 32 * 1024 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  maxFiles: 1000,
} as const;

export const HOOK_EVENTS = [
  "SessionStart",
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "DirectoryAdded",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "PreModelSwitch",
  "PostModelSwitch",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
  "Notification",
] as const;
