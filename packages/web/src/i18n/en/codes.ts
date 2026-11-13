/** Messages by code: validation issues (E_*, W_*) and quality checks (Q_*). */
export const codes = {
  // Validation errors (block publication)
  E_TYPE_UNKNOWN: "The artifact type is not one of the supported types.",
  E_PATH_UNSAFE: "A file path is absolute, contains “..”, empty segments or control characters.",
  E_PATH_FORBIDDEN: "A path is inside .git/ or node_modules/, which are never allowed in a bundle.",
  E_PATH_DUPLICATE: "Two files resolve to the same relative path.",
  E_BUNDLE_TOO_LARGE: "The total size of the files exceeds 32 MiB.",
  E_FILE_TOO_LARGE: "A single file exceeds 16 MiB.",
  E_TOO_MANY_FILES: "The bundle contains more than 1000 files.",
  E_FRONTMATTER_INVALID: "The frontmatter could not be parsed.",
  E_FRONTMATTER_MISSING: "The required frontmatter block is missing.",
  E_NAME_INVALID:
    "The name must be 1–64 characters of a–z, 0–9 and single hyphens, not starting or ending with a hyphen.",
  E_NAME_MISMATCH: "The name you entered does not match the name in the package.",
  E_NAME_DIR_MISMATCH: "The name in the frontmatter does not match the skill directory name.",
  E_DESCRIPTION_MISSING: "The description is empty.",
  E_DESCRIPTION_TOO_LONG: "The description is longer than 1024 characters.",
  E_SKILL_MD_MISSING: "The skill must contain exactly one SKILL.md file.",
  E_COMPATIBILITY_TOO_LONG: "The compatibility field is longer than 500 characters.",
  E_METADATA_INVALID: "The metadata field must map strings to strings.",
  E_RUBRIC_BLOCKED: "Company quality rules block publishing: the score is below the threshold.",
  E_SECURITY_BLOCKED:
    "The security policy blocks publishing: the content scan found a risky pattern.",
  E_BODY_EMPTY: "The text after the frontmatter is empty.",
  E_SINGLE_FILE_REQUIRED: "A command must be exactly one .md file.",
  E_HOOKS_JSON_MISSING: "The hook package has no hooks.json at its root.",
  E_HOOKS_JSON_INVALID: "hooks.json is not valid JSON or has no hooks object.",
  E_HOOK_ENTRY_INVALID: "A hook entry is missing required fields or has an invalid timeout.",
  E_AGENT_ISOLATION_INVALID: "The agent isolation field may only be “worktree”.",
  E_PLUGIN_MANIFEST_MISSING: "The plugin has no .claude-plugin/plugin.json at its root.",
  E_PLUGIN_MANIFEST_INVALID:
    "plugin.json must be a JSON object with a valid name and a description up to 1024 characters.",
  E_PLUGIN_EMPTY:
    "The plugin has no components: no skills, commands, agents, hooks or MCP servers.",
  E_PLUGIN_MCP_INVALID: ".mcp.json must be a JSON object with an mcpServers object.",
  E_SETTINGS_JSON_MISSING: "The settings profile has no settings.json next to SETTINGS.md.",
  E_SETTINGS_JSON_INVALID: "settings.json is not a valid JSON object.",
  E_SETTINGS_SECRET: "The env section contains a literal secret instead of a ${VAR} reference.",
  E_SETTINGS_RUNTIME:
    "The profile runtime must be claude-code and its scope must be user, project or local.",
  // Validation warnings (do not block)
  W_FILE_DROPPED: "A .DS_Store or Thumbs.db file was dropped from the bundle.",
  W_FRONTMATTER_LOOSE:
    "The frontmatter is not valid YAML, so it was read as simple key: value lines.",
  W_UNKNOWN_FRONTMATTER_KEY: "A frontmatter key is not known for this type.",
  W_SINGLE_FILE_SKILL: "The skill arrived as a single .md file and was treated as SKILL.md.",
  W_SKILL_MD_LONG: "SKILL.md is longer than 500 lines and hard to review.",
  W_REFERENCE_MISSING:
    "The text links to files in scripts/, references/ or assets/ that are not in the bundle.",
  W_NAME_FILE_MISMATCH: "The agent file name differs from the name in the frontmatter.",
  W_HOOK_EVENT_UNKNOWN: "hooks.json uses an event that is not in the known Claude Code event list.",
  W_SCRIPT_MISSING:
    "A hook command refers to a ${CLAUDE_PLUGIN_ROOT} file that is not in the bundle.",
  W_SETTINGS_KEY_UNKNOWN: "settings.json has a top-level key SkillForge does not recognize.",
  E_MCP_JSON_INVALID:
    "The MCP server has no valid server.json, or server.json lists no packages and no remote endpoints.",
  E_MCP_UNPINNED:
    "An MCP package is not pinned: npm and pypi need an exact version, an oci image needs an @sha256: digest.",
  E_MCP_SECRET_LITERAL:
    "A secret of the MCP server has a literal value; declare it with isSecret and no value, or use a {variable}.",
  E_MCP_TRANSPORT_UNKNOWN:
    "Unknown package type or transport: packages are npm, pypi or oci; remote endpoints are streamable-http or sse.",
  E_MCP_POLICY:
    "The MCP policy does not allow this package type or remote origin; an admin edits the policy on the lifecycle page.",
  E_RULE_PATHS_INVALID:
    'paths must be a list of file patterns, for example ["src/api/**/*.ts"]; leave it out for a rule that always applies.',
  E_RULE_EXTRA_FILE: "A rule is exactly one markdown file; publish other files as a skill.",
  E_RULE_ALWAYS_LONG:
    "A rule without paths is loaded on every turn of the agent and is too long; shorten it or limit it with paths.",
  E_MCP_SHELL: "The MCP server runs through a shell or puts shell syntax into an argument.",
  E_MCP_URL_INVALID:
    "A remote endpoint must be https, without credentials or a key in the query, and not localhost.",
  // Quality checks (advisory, never block)
  Q_DESC_SHORT: "The description has fewer than 10 words.",
  Q_DESC_NO_TRIGGER: "The description does not say when to use the artifact.",
  Q_DESC_NO_BOUNDARY: "The description does not say when not to use the artifact.",
  Q_DESC_PERSON: "The description is written in the first or second person.",
  Q_BODY_LONG: "The main file is longer than about 5000 tokens.",
  Q_NO_EXAMPLE: "The main file has no example: no code block and no example heading.",
  Q_REF_DEEP: "A file referenced from SKILL.md links to another Markdown file, two hops away.",
  Q_TIME_SENSITIVE:
    "The text contains wording that goes stale, such as “as of 2025” or “the latest version”.",
  Q_WINDOWS_PATH: "The text contains a Windows path outside a Windows shell block.",
  Q_TOOLS_UNBOUNDED: "The allowed tools grant unrestricted shell access.",
  Q_HOOK_NO_TIMEOUT: "A hook handler has no timeout.",
  Q_HOOK_BROAD_MATCHER: "A hook handler runs on every tool call: its matcher is missing or “*”.",
  Q_HOOK_INLINE_LONG:
    "A hook has an inline command longer than 200 characters instead of a script.",
  Q_HOOK_HARD_BLOCK: "A hook blocks or denies outright instead of asking.",
  Q_SETTINGS_BYPASS: "The profile turns off permission prompts (bypassPermissions).",
  Q_SETTINGS_BROAD_ALLOW: "The profile allows a broad pattern that unlocks the shell or all tools.",
  Q_SETTINGS_API_KEY_HELPER: "The profile sets apiKeyHelper, a command run to obtain an API key.",
  Q_SETTINGS_HOOKS: "The profile embeds hooks.",
};

export type Codes = typeof codes;

/** API error codes (`error` of a failed response) shown to the user. `{owner}` is filled from the response. */
export const apiErrors = {
  // generic
  request_failed: "The request failed.",
  error: "The request failed.",
  bad_request: "The request is invalid.",
  unauthorized: "Sign in to continue.",
  forbidden: "You do not have permission to do this.",
  not_found: "Not found.",
  conflict: "This conflicts with an existing item.",
  rate_limited: "Too many requests. Try again later.",
  internal_error: "Server error. Try again later.",
  feature_disabled: "This feature is turned off on this server.",
  cross_origin: "The request came from another site and was rejected.",
  misdirected_host: "Local mode accepts requests only on the loopback address.",
  mcp_token_forbidden: "An MCP token cannot be used for this action.",
  mcp_not_allowed: "This token is not allowed to use MCP.",
  session_required: "Sign in to do this: an API token cannot create tokens.",
  self_promotion_forbidden:
    "The author of the latest version cannot promote it to active; another reviewer has to.",
  // sign-in and users
  invalid_credentials: "Invalid username or password.",
  account_disabled: "This account is disabled.",
  disabled: "This account is disabled.",
  ldap_unavailable: "Directory sign-in is temporarily unavailable. Try again later.",
  local_mode: "Sign-in is not needed in local mode.",
  username_taken: "This username is already taken.",
  last_admin: "You cannot remove or disable the last active admin.",
  providers_failed: "Could not load sign-in providers.",
  // publishing
  validation_failed: "The package did not pass validation.",
  not_owner: "Only the owner can publish new versions of this artifact. Owner: {owner}",
  publish_blocked: "Publication was blocked by a pre-publish hook.",
  version_invalid: "The version is not a valid semver version.",
  version_exists: "This version already exists.",
  digest_exists: "The same content is already published as another version.",
  content_purged: "This content was purged and cannot be published again.",
  name_purged: "This name was purged and cannot be reused.",
  provenance_invalid: "The provenance data is invalid.",
  channel_invalid: "This channel is not allowed for this version.",
  not_team_member: "You are not a member of this team.",
  team_required: "Choose an owner team for team visibility.",
  team_unknown: "This team does not exist.",
  eval_gate_required:
    "The eval gate is required: publish to beta first, then promote to stable after a passing comparison.",
  eval_gate_missing: "The eval gate cannot be checked: the suite has no holdout cases.",
  eval_gate_failed: "The eval gate failed for this version.",
  rescan_required: "The agent snapshot is out of date. Rescan the agent and try again.",
  too_many_files: "The directory has too many files.",
  type_not_supported: "This action is not supported for this artifact type.",
  // artifacts, versions and ownership
  purged: "This artifact or version was purged.",
  no_matching_version: "No version matches this request.",
  version_not_found: "This version does not exist.",
  spec_invalid: "The version specification is invalid.",
  owner_invalid: "This user cannot become the owner.",
  owner_changed: "The owner has changed in the meantime. Reload the page and try again.",
  maintainer_invalid: "This user cannot become a maintainer.",
  kind_not_allowed: "This kind of relation is not allowed.",
  labels_invalid: "The labels are invalid.",
  metadata_invalid: "The metadata is invalid.",
  comment_invalid: "The comment is empty or too long.",
  invalid_transition: "This status change is not allowed.",
  reason_required: "Enter a reason.",
  hold_invalid:
    "The hold needs a reason of at least 5 characters and an end date within the next year.",
  // evidence
  kind_invalid: "The evidence kind is invalid.",
  url_invalid: "The URL is invalid or not allowed.",
  summary_invalid: "The summary is invalid.",
  ablation_invalid: "The ablation data is invalid.",
  // evals
  suite_invalid: "The eval suite is invalid.",
  gate_needs_holdout: "A required gate needs at least one holdout case.",
  run_invalid: "The eval run request is invalid.",
  run_in_progress: "An eval run is already in progress.",
  runners_not_configured: "No eval runners are configured on this server.",
  runner_required: "Choose a runner.",
  runner_unknown: "This runner is not configured.",
  runners_invalid: "Choose at least one runner.",
  batch_invalid: "The batch request is invalid.",
  no_cases: "The suite has no cases of the needed kind.",
  against_required: "Choose a version to compare against.",
  // hooks, workflows and routines
  not_a_hook: "This artifact is not a hook.",
  subscription_exists: "A subscription for this version already exists.",
  has_decisions:
    "This subscription has recorded decisions and cannot be deleted. Disable it instead.",
  invalid_definition: "The definition is invalid.",
  invalid_workflow_id: "The workflow id is invalid.",
  invalid_routine_id: "The routine id is invalid.",
  input_too_large: "The input is larger than 64 KiB.",
  queue_full: "Too many active runs. Wait for some to finish.",
  run_finished: "This run has already finished.",
  budget_exhausted: "The daily run budget is exhausted.",
  output_gone: "This output is no longer stored.",
  // teams
  team_exists: "A team with this name already exists.",
  name_invalid: "The name is invalid.",
  lead_invalid: "The lead must be an existing active user.",
  member_invalid: "The member or role is invalid.",
  team_full: "The team has reached its member limit.",
  last_lead: "You cannot remove the last lead of the team.",
  team_in_use: "The team still owns artifacts and cannot be deleted.",
  // imports
  import_url_not_allowed: "This URL is not allowed as an import source.",
  import_source_not_allowed: "The import source policy does not allow this address.",
  import_archives_disabled:
    "Only an admin may upload zip files and folders here; use a git source.",
  import_too_fresh: "This commit is still in quarantine; try again later.",
  invalid_policy: "Check the policy values.",
  rubric_looser:
    "A team can only make the company's rules stricter: raise the threshold, mode or weights.",
  import_git_disabled: "Import from git is turned off on this server.",
  import_git_failed: "Could not fetch the git repository.",
  import_too_large: "The import source is too large.",
  import_unsafe_path: "The import contains an unsafe file path.",
  import_expired: "The import preview has expired. Start again.",
  // admin
  agent_roots_disabled: "Server agents are disabled: SKILLFORGE_AGENT_ROOTS is not set.",
  path_outside_roots: "The path is outside the allowed agent roots.",
  not_server_agent: "This is not a server agent.",
  backup_in_progress: "A backup is already in progress.",
  config_invalid: "The plugin configuration is invalid.",
  plugin_error: "The plugin failed to handle the request.",
  // metrics
  format_invalid: "The export format must be csv or json.",
  sort_invalid: "The sort option is invalid.",
  query_invalid: "The query is invalid.",
  // help assistant (llm-help-assistant)
  invalid_settings: "Check the highlighted setting.",
  invalid_request: "The request is invalid.",
  assistant_disabled: "The assistant is turned off.",
  assistant_not_configured:
    "The assistant is not set up yet: an administrator needs to set the API address and model.",
  assistant_daily_limit: "You have used today's assistant requests. Try again tomorrow.",
  llm_unauthorized:
    "The model provider rejected the key. Check SKILLFORGE_LLM_API_KEY and SKILLFORGE_LLM_KEY_ORIGINS.",
  llm_rate_limited: "The model provider is busy. Try again in a minute.",
  llm_timeout: "The model did not answer in time.",
  llm_upstream_error: "The model provider returned an error.",
  llm_aborted: "The answer was stopped.",
};

export type ApiErrors = typeof apiErrors;
