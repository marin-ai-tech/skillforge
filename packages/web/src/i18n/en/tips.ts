import type { Action } from "../../help/registry.ts";

/** Help tip texts keyed by action/family id; `help/registry.ts` reads them on access. */
const actionTips = {
  "nav-search": "Search the catalog (Ctrl/⌘+K). Type a name or keyword and press Enter.",
  "lang-switch": "Choose the interface language; the choice is remembered in this browser.",
  "theme-toggle": "Cycle light, dark, and system color themes.",
  "nav-login": "Sign in to publish artifacts and manage your account.",
  "nav-logout": "Sign out of your SkillForge session.",
  "nav-publish": "Open the publish page to upload a new artifact version.",
  "nav-user": "Open your account menu (tokens, password, admin).",
  "menu-admin": "Open users administration (admins only).",
  "menu-backups": "Open backups administration (admins only).",
  "menu-plugins": "Open the Plugins admin page to enable, disable, and configure server plugins.",
  "plugin-toggle": "Enable or disable a plugin. Takes effect after the server restarts.",
  "plugin-config-save":
    "Save this plugin JSON config. Validated against the plugin schema; applies immediately.",
  "ext-action-run":
    "Run the independent review for this artifact version: external reviewers, a judge, then decide each finding.",
  "ext-action-*": "Decide this review finding: Fix, Verify, Defer, or Reject.",
  "backup-create": "Create a new data archive (VACUUM snapshot + blobs).",
  "backup-download": "Download this backup archive to your computer.",
  "backup-delete": "Delete this backup archive after confirmation.",
  "menu-password": "Change your account password.",
  "menu-me": "Open your personal workspace overview: artifacts, agents, tokens, and activity.",
  "me-tokens-manage": "Jump to API token create and revoke for CLI and automation.",
  "me-review-open": "Open the lifecycle board to promote or reject candidate artifacts.",
  "menu-tokens": "Create and revoke personal API tokens.",
  "help-button": "Open help for this page. Press ? anywhere outside form fields.",
  "help-search": "Search help topics by title or body text.",
  "browse-search": "Filter the catalog by name or description text.",
  "browse-status": "Filter artifacts by lifecycle status (candidate, active, …).",
  "browse-tag": "Active tag filter. Clear it to show all tags again.",
  "page-prev": "Go to the previous page of catalog results.",
  "page-next": "Go to the next page of catalog results.",
  "browse-tab-*": "Switch catalog type tabs (All, skill, command, agent, hook).",
  "home-count-*": "Jump to the catalog filtered by this artifact type.",
  "version-select": "Choose which published version to inspect on this page.",
  "tab-*": "Switch artifact sections: Overview, Files, Versions, Audit, Install, Quality.",
  "file-entry": "Select a file to preview its contents.",
  "file-dir": "Expand or collapse a directory in the file tree.",
  "meta-digest": "Content digest (sha256) of this version. Use Copy to copy the full value.",
  "issue-help": "Open validation-code help for this issue.",
  "login-username": "Your SkillForge username.",
  "login-password": "Your account password.",
  "login-submit": "Sign in with the username and password above.",
  "login-sso": "Sign in with your organization identity provider (OIDC).",
  "login-method": "Choose SkillForge password login or a corporate LDAP directory.",
  "publish-dropzone": "Drop a folder or files here to include them in the publish bundle.",
  "publish-pick-dir": "Pick a directory from disk to publish.",
  "publish-pick-files": "Pick individual files to publish.",
  "publish-mode-files": "Switch to file/folder upload mode.",
  "publish-mode-paste": "Switch to paste-markdown mode for a single file.",
  "publish-paste": "Paste the full markdown (with frontmatter) for a single-file publish.",
  "publish-paste-filename": "Filename for the pasted content, e.g. SKILL.md.",
  "publish-file": "A file included in the publish bundle. Remove it if unwanted.",
  "publish-type": "Artifact type: skill, command, agent, or hook.",
  "publish-name": "Canonical artifact name (lowercase, hyphens). Must match frontmatter name.",
  "publish-description": "Short description shown in the catalog.",
  "publish-version": "Semver version for this publish, e.g. 1.0.0.",
  "publish-changelog": "Optional notes describing what changed in this version.",
  "publish-provenance-source": "Where this artifact came from (e.g. local, git, import).",
  "publish-provenance-ref": "Optional reference (commit, URL, or path) for provenance.",
  "publish-submit":
    "Publish this version when dry-run validation is ok and there are no conflicts.",
  "create-username": "Username for the new account (unique).",
  "create-display-name": "Optional display name shown in the UI.",
  "create-password": "Initial password for the new user (min 8 characters).",
  "create-role": "Role: viewer, contributor, reviewer, or admin.",
  "create-submit": "Create the new user account.",
  "user-role-select": "Change this user's role. The last admin cannot be demoted.",
  "user-disable-toggle": "Disable or re-enable this account. Disable requires confirmation.",
  "user-reset-password": "Open the admin password-reset fields for this user.",
  "user-new-password": "New password to set for this user.",
  "user-reset-submit": "Apply the new password for this user.",
  "token-name": "Label for the new API token (shown in your token list).",
  "token-mcp": "Allow this token to call POST /mcp so agents can search and read active artifacts.",
  "token-mcp-tags": "Optional kebab-case tags that limit which active artifacts the agent can see.",
  "token-mcp-snippet": "Copy-paste commands to connect your agent over MCP; pick the client above.",
  "token-mcp-client":
    "Pick your agent client to see its MCP connect commands. Your choice is remembered in this browser.",
  "token-create-submit": "Create a new API token. The secret is shown only once.",
  "token-revoke": "Revoke this token so it can no longer call the API. Requires confirmation.",
  "password-current": "Your current password (required to change it).",
  "password-next": "Your new password (at least 8 characters).",
  "password-confirm": "Re-enter the new password to confirm it matches.",
  "password-submit": "Save the new password for your account.",
  "transition-*": "Change this artifact lifecycle status. Reviewer or admin only; audited.",
  "transition-reason":
    "Optional note for most transitions; required when retiring or marking zombie.",
  "transition-confirm": "Apply the lifecycle transition and write an audit event.",
  "transition-cancel": "Close the transition dialog without changing status.",
  "set-channel":
    "Move this version between the stable and beta channels; latest follows the newest stable version.",
  "evidence-file":
    "Attach a local text result (UTF-8, up to 64 KiB) instead of a link; the registry stores it.",
  "evidence-add":
    "Attach a gate, run, diff, review or eval link to this version; a gate record sets validated_at.",
  "transfer-owner":
    "Transfer artifact ownership to another contributor+ user. Requires a reason; confirmed in a dialog.",
  "add-maintainer": "Add a co-author who may publish new versions of this artifact.",
  "remove-maintainer":
    "Remove a co-author from this artifact. They lose publish rights unless they are reviewer+ or admin.",
  "version-validate": "Mark this version validated and optionally merge model compatibility tags.",
  "validate-model-compat":
    "Comma-separated model ids to merge into this version's compatibility list.",
  "validate-note": "Optional note stored on the validate audit event.",
  "validate-confirm": "Save validation timestamp and merged model compatibility.",
  "queue-promote": "Promote this candidate to active from the review queue.",
  "queue-reject": "Reject this candidate by retiring it with a required reason.",
  "board-retire": "Retire this aging or zombie artifact (reason required).",
  "board-revalidate": "Move aging or zombie back to active and refresh validated_at.",
  "board-restore": "Restore a retired artifact to candidate for another review cycle.",
  "tab-review": "Review queue of candidate artifacts awaiting promote or reject.",
  "tab-delete": "What can you delete today? Aging and zombie artifacts.",
  "tab-retired": "Recently retired artifacts you can restore to candidate.",
  "menu-lifecycle": "Open the lifecycle board (reviewer and admin).",
  "import-source": "Choose zip, git, or folder as the import source.",
  "import-zip-input": "Pick a .zip archive that contains skills, commands, agents, or hooks.",
  "import-git-url":
    "Git URL (https://, ssh://, or git@host:path). file:// only when allowed by the server.",
  "import-git-ref": "Optional branch or tag for git clone --branch.",
  "import-git-path": "Optional subdirectory inside the cloned repository to scan.",
  "import-dir-input": "Pick a local folder; relative paths come from webkitRelativePath.",
  "import-preview": "Scan the source and dry-run validate each candidate without publishing.",
  "candidate-select": "Include or exclude this candidate from the import run.",
  "import-select-all": "Select or clear all import candidates.",
  "import-provenance": "Optional provenance override for all selected candidates.",
  "mcp-policy-save":
    "Save which MCP package types and remote origins may be published; versions outside the policy are refused with E_MCP_POLICY.",
  "security-policy-save":
    "Save whether a failed content scan blocks publishing, import and agent uploads.",
  "orphan-transfer":
    "Make this person the owner; the reason in the audit log names the previous owner.",
  "replacement-save":
    "Point this artifact at its successor (type/name); clear the field to remove it. Sync moves people over.",
  "availability-set":
    "Set this artifact for the team: not available, available, installed by default or required. Admins and the team's lead can change it.",
  "version-compare": "Pick two versions to see which files changed and how, line by line.",
  "mirror-add": "Track this git source: the registry checks it daily under the import policy.",
  "mirror-check": "Check this mirror now; changes arrive as beta versions.",
  "mirror-delete": "Stop tracking this source; published artifacts stay.",
  "import-policy-save": "Save which git sources, uploads and release ages imports accept.",
  "import-age-override":
    "Admins only: import a quarantined commit now; the reason goes to the audit log.",
  "import-skip-conflicts": "When checked, digest/version conflicts are skipped instead of failed.",
  "import-run": "Publish the selected candidates. Requires at least one selection.",
  "menu-import": "Open Import to bring artifacts from zip, git, or a folder.",
  "install-marketplace-cmd":
    "Copy the Claude Code command that adds this SkillForge marketplace URL.",
  "install-plugin-cmd":
    "Copy the Claude Code command that installs this active plugin from the marketplace.",
  "install-download-tgz":
    "Download the deterministic plugin .tar.gz archive for this artifact version.",
  "install-download-zip":
    "Download a zip of canonical files (no plugin.json) for this artifact version.",
  "install-settings-cli":
    "Copy the skillforge settings apply command for this profile (scope from the profile frontmatter).",
  "file-view-mode":
    "Rendered shows a markdown file as formatted text with its frontmatter as a table; Source shows the exact file.",
  "install-runtime-select":
    "Choose the agent runtime to see its install command; see Agent support for what each runtime supports.",
  "install-runtime-cmd":
    "Copy the install command for the selected runtime; commands are translated to that agent's format.",
  "install-runtime-unsupported":
    "The selected runtime has no equivalent for this artifact type; the reason says what to use instead.",
  "settings-json":
    "Formatted settings.json fragment that skillforge settings apply merges into your Claude Code settings.",
  "settings-scope":
    "Recommended Claude Code settings scope for this profile: user, project, or local.",
  "home-install": "Add this SkillForge registry as a Claude Code marketplace from the home page.",
  "menu-agents": "Open your agent inventory snapshots and compare them to the registry.",
  "menu-admin-agents":
    "Open Agents administration to register server paths under SKILLFORGE_AGENT_ROOTS.",
  "agent-add": "Upload a local agent folder as a named snapshot for comparison and publish.",
  "agent-delete": "Delete this agent snapshot from your account after confirmation.",
  "agent-item-publish":
    "Publish this local_only or modified item into the registry with agent provenance.",
  "agent-item-install": "Copy the CLI install command for an outdated or registry-only artifact.",
  "agent-rescan": "Rescan this server agent from its host path and refresh comparison statuses.",
  "agent-registry-all":
    "Include non-active registry artifacts (except retired) in the registry_only list.",
  "server-agent-submit": "Create a server agent bound to an absolute path inside configured roots.",
  "admin-agent-scan": "Rescan a server agent from disk as an administrator.",
  "admin-agent-delete": "Delete any agent snapshot from the admin table after confirmation.",
  "home-delete-board": "Shortcut to aging and zombie counts on the delete-today board.",
  "quality-check-help": "Open advisory quality-code help for this Q_* check.",
  "hook-risk": "Highlight hook table rows for this risk label; click again to clear.",
  "sessions-delete":
    "Delete all session usage facts attributed to your account after confirmation.",
  "team-create": "Create a team with an initial lead (admin only).",
  "team-member-add": "Add a member to this team or change their role (lead or admin).",
  "team-member-remove": "Remove a member from this team. The last lead cannot be removed.",
  "scope-save":
    "Save artifact visibility and owner team. Narrowing and widening ask for confirmation.",
  "labels-save": "Save registry labels on this artifact (kebab-case, up to 20).",
  "comment-submit":
    "Post a comment or reply on this artifact. Plain text only; use @user to mention.",
  "comment-delete":
    "Soft-delete this comment after confirmation. Authors and reviewers/admins only.",
  "watch-toggle": "Watch or unwatch this artifact for comment and version notifications.",
  "notifications-mark-all": "Mark all visible notifications as read.",
  "nav-notifications": "Open your notification feed. Badge shows unread count.",
  "metadata-save":
    "Save registry metadata without creating a version. Reset a field to the latest version's value.",
  "purge-version":
    "Permanently remove a leaked version after revoking the secret. Admin only; exact confirmation required.",
  "purge-artifact":
    "Permanently remove every version and reserve the artifact name. Admin only; exact confirmation required.",
  "lifecycle-hold-set":
    "Hold automatic lifecycle transitions until a future date with a short reason.",
  "sweep-run": "Apply the data lifecycle policy for real after confirmation.",
  "cleanup-retire":
    "Retire a cleanup-board artifact using the shared transition dialog with a prefilled reason.",
  "menu-admin-lifecycle": "Open admin lifecycle policy, dry-run, and sweep controls.",
  "rubric-save":
    "Save the quality rules. In block mode, versions scoring below the threshold cannot be published.",
  "workflow-gate":
    "Approve to continue along on_success, reject to follow on_failure; the decision and reason stay in the trace.",
  "workflow-resume":
    "Continue the stopped run from the step it stopped at; finished steps are not repeated.",
  "menu-packs":
    "Open team method packs: roles with pinned artifact versions, installed with one command.",
  "menu-admin-harvest":
    "Open rules from reviews: comments that recur in pull requests, turned into skill drafts.",
  "harvest-run":
    "Read the review comments of the repository for the period and keep the rules that recur.",
  "harvest-draft": "Publish these rules as a candidate skill; it goes through the usual review.",
  "menu-admin-rollout":
    "Open the rollout page: pull requests that add artifacts to the chosen repositories.",
  "rollout-start":
    "Open a pull request in every listed repository; a failure in one does not stop the others.",
  "menu-admin-inventory":
    "Open the inventory: what stands on people's machines, copies outside the registry and copies that differ from it.",
  "menu-admin-report":
    "Open the report for management: usage by team and artifact, trend and artifacts nobody used.",
  "report-days":
    "Choose the period; the change is shown against the previous period of the same length.",
  "menu-admin-audit":
    "Open the audit log: every artifact and system event with filters and an NDJSON download.",
  "audit-export":
    "Download the whole log with the current filters, one JSON event per line, for a SIEM or an archive.",
  "audit-more": "Load the next 100 events after the last one shown.",
  "menu-admin-assistant":
    "Open the assistant settings: model address, model, limits and connection check.",
  "llm-save":
    "Save the assistant settings. The API key is not here: it comes from the server environment.",
  "llm-test": "Send a tiny test request to the model with the saved settings.",
  "llm-validation-backfill":
    "Queue published skills that have no current check with this model, within the daily budget.",
  "help-assistant-tab":
    "Talk to the help assistant: it answers from the help and never changes anything.",
  "help-ask-assistant": "Ask the help assistant about this page.",
  "assistant-mode":
    "Getting started: the assistant asks about your goal and suggests a path. Ask a question: it answers yours.",
  "assistant-send": "Send your question. Enter sends, Shift+Enter starts a new line.",
  "assistant-stop": "Stop the answer that is being written.",
  "assistant-new": "Start a new conversation; the current one is cleared from this tab.",
  "metrics-export-csv": "Download the metrics board as CSV with the current filters (signed-in).",
  "metrics-export-json": "Download the metrics board as JSON with the current filters (signed-in).",
  "eval-save": "Save the eval suite (cases and gate) for this skill.",
  "eval-run-start": "Start a trigger, compare, or ablation eval run.",
  "eval-gate-toggle": "Turn the acceptance gate off or required (reviewer+ to disable).",
  "workflow-save":
    "Save a workflow definition (admin only; JSON with validated steps and branching).",
  "workflow-run-start": "Enqueue a workflow run; steps execute sequentially on the server.",
  "workflow-replay": "Re-run with the exact definition snapshot and input of this run.",
  "routine-save": "Save a routine definition (admin only; schedule, command, budgets) as JSON.",
  "routine-run-now": "Trigger a routine run right now, outside its schedule.",
  "metrics-sort": "Sort the metrics table by this column; click again to toggle order.",
  "start-install-pack":
    "Install a starter pack into the registry as candidate artifacts (admin only).",
  "start-batch-promote":
    "Promote all candidate artifacts to active in one batch; each success is audited.",
  "start-copy-connect": "Copy the marketplace add command that includes this registry URL.",
} satisfies Record<Action, string>;

/** Interface strings: help tips, help panel and help center chrome. */
export const tips = {
  ...actionTips,
  help: {
    learnMore: "Learn more",
    panelTitle: "Help",
    back: "Back",
    close: "Close",
    topicNotFound: "Topic not found.",
    related: "Related",
    openInCenter: "Open in Help center",
    pageTitle: "Help",
    documentTitle: "Help · SkillForge",
    searchPlaceholder: "Search help…",
    pageTopicNotFound: "Help topic not found.",
    /** Shown above a help topic while topics exist only in English; empty in the English interface. */
    langNote: "",
    sections: {
      start: "Getting started",
      publishing: "Publishing and versions",
      lifecycle: "Lifecycle and review",
      evidence: "Evidence, evals and metrics",
      access: "Teams and access",
      automation: "Automation and extensions",
      operations: "Operations",
      pages: "Interface pages",
      actions: "Actions",
      codes: "Validation codes",
    } as Record<string, string>,
    groups: {
      "ui-catalog": "Catalog and publishing",
      "ui-workspace": "Your workspace",
      "ui-review": "Review and metrics",
      "ui-admin": "Administration",
      "ui-other": "Other pages",
      "codes-errors": "Errors (E_)",
      "codes-warnings": "Warnings (W_)",
      "codes-quality": "Quality checks (Q_)",
      "actions-agents": "Agents",
      "actions-artifact": "Artifact page",
      "actions-backups": "Backups",
      "actions-catalog": "Catalog",
      "actions-evals": "Evals",
      "actions-import": "Import",
      "actions-lifecycle": "Lifecycle",
      "actions-me": "Profile",
      "actions-metrics": "Metrics",
      "actions-navigation": "Navigation",
      "actions-notifications": "Notifications",
      "actions-plugins": "Plugins",
      "actions-publish": "Publish",
      "actions-quality": "Quality",
      "actions-routines": "Routines",
      "actions-teams": "Teams",
      "actions-tokens": "Tokens",
      "actions-users": "Users",
      "actions-workflows": "Workflows",
    } as Record<string, string>,
    callouts: {
      note: "Note",
      tip: "Tip",
      important: "Important",
      warning: "Warning",
      caution: "Caution",
    },
    learn: "What you will learn",
    onThisPage: "On this page",
    prev: "Previous",
    next: "Next",
    navLabel: "Help sections",
    askAssistant: "Ask the assistant",
    assistant: {
      tab: "Assistant",
      reference: "Help topics",
      modeOnboarding: "Getting started",
      modeConsult: "Ask a question",
      intro:
        "The assistant answers from the SkillForge help in your interface language. It is read-only: it explains how to do things but never changes anything.",
      onboardingHint:
        "Tell the assistant what you want to do, and it will suggest a path through the help.",
      placeholder: "Ask about SkillForge…",
      send: "Send",
      stop: "Stop",
      newChat: "New conversation",
      you: "You",
      bot: "Assistant",
      thinking: "Thinking…",
      signIn: "Sign in to talk to the assistant.",
      signInLink: "Sign in",
      remaining: (n: number) => `Requests left today: ${n}`,
      disclaimer: "Answers can be inaccurate: check the linked help topics.",
      chatLabel: "Conversation with the assistant",
    },
  },
};

export type Tips = typeof tips;
