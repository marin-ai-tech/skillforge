export type ArtifactTypeInfo = { id: string; label: string; plural: string };

import type { ArtifactType } from "../lib/artifact-types.ts";

export type { ArtifactType };

export type QualityGrade = "A" | "B" | "C" | "D";

export type QualitySummary = {
  score: number;
  grade: QualityGrade;
  security?: "pass" | "warn" | "fail" | null;
  context?: "low" | "medium" | "high" | null;
};

export type ContextCost = {
  every_turn: number;
  on_use: number;
  on_demand: number;
  level: "low" | "medium" | "high";
};

export type SecurityReport = {
  verdict: "pass" | "warn" | "fail";
  findings: Array<{
    rule: string;
    severity: "high" | "medium";
    file: string;
    line: number;
    mention: boolean;
    excerpt: string;
  }>;
};

export type SecurityPolicy = { block_publish_on: "none" | "high" | "medium" };

/** MCP part of an mcp-server card (mcp-server-card): names and flags, never values. */
export type McpCardInput = {
  name: string;
  description: string | null;
  isRequired: boolean;
  isSecret: boolean;
};
export type McpCard = {
  version: string;
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string | null;
    runtimeHint: string | null;
    transport: string;
    env: McpCardInput[];
  }>;
  remotes: Array<{ type: string; url: string; origin: string | null; headers: McpCardInput[] }>;
  tools: Array<{ name: string; description: string | null }>;
  policy: { allowed: boolean; reasons: string[] };
  usage: { installs: number; people: number; same_version: number };
};

/** Which MCP package types and remote origins may be published (mcp-policy). */
export type McpPolicy = { registry_types: string[]; remote_origins: string[] };

export type QualityHit = {
  path: string;
  line?: number;
  excerpt?: string;
};

export type QualityCheck = {
  code: string;
  severity: "warn" | "info";
  message: string;
  hits: QualityHit[];
};

export type QualityMetrics = {
  description_chars: number;
  description_words: number;
  body_chars: number;
  body_tokens_est: number;
  markdown_files: number;
  reference_depth: number;
  code_blocks: number;
};

export type HookBlocking = "block" | "ask" | "none" | "unknown";

export type HookRow = {
  event: string;
  matcher: string | null;
  type: string;
  action: string;
  timeout: number | null;
  script: string | null;
  blocking: HookBlocking;
  runtimes: string[];
};

export type HookRisk = { label: string; rows: number[] };

export type HookAnalysis = { rows: HookRow[]; risks: HookRisk[] };

export type QualityReport = {
  algorithm: number;
  security?: SecurityReport;
  context?: ContextCost;
  score: number;
  grade: QualityGrade;
  checks: QualityCheck[];
  metrics: QualityMetrics;
  hook?: HookAnalysis;
};

export type DuplicateKind =
  "name_collision" | "identical_body" | "shared_files" | "similar_description";

export type RegistryDuplicate = {
  kind: DuplicateKind | string;
  type: string;
  name: string;
  detail: Record<string, unknown>;
};

export type ArtifactDuplicatesResponse = { items: RegistryDuplicate[] };

export type AgentDuplicateClass = "replica" | "divergent" | "stale_backup";

export type AgentDuplicate = {
  key: string;
  class: AgentDuplicateClass | string;
  roots: Array<{ root: string; digest: string }>;
  keep: string;
  reason: string;
};

export type ArtifactSummary = {
  /** artifact-replacement: type/name of the successor. */
  replaced_by?: string | null;
  /** plugin-artifact-badges: badges set by enabled plugins. */
  badges?: Array<{
    plugin: string;
    id: string;
    label: string;
    /** Label per interface language; `label` is the fallback. */
    labels?: Partial<Record<string, string>>;
    tone: "ok" | "info" | "warn" | "danger";
  }>;
  type: ArtifactType | string;
  comments_count?: number;
  name: string;
  description: string;
  display_name: string | null;
  tags: string[];
  labels: string[];
  status: string;
  visibility: string;
  owner_team: string | null;
  owner: string;
  maintainers?: string[];
  latest_version: string | null;
  latest_channel?: VersionChannel | null;
  versions_count: number;
  download_count?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  purged_at?: string | null;
  purged_by?: string | null;
  quality?: QualitySummary | null;
  skill_age_days?: number;
  /** artifact-agent-compat: agents the type installs into, the rest with a reason, and the author's declaration. */
  agents?: AgentCompat;
};

export type AgentDeclaration = { runtime: string; min_version: string | null };

export type AgentCompat = {
  supported: string[];
  unsupported: Array<{ runtime: string; reason: string }>;
  declared: AgentDeclaration[];
};

export type VersionChannel = "stable" | "beta";

export type EvidenceKind = "gate" | "run" | "diff" | "review" | "eval" | "ablation";

/** `summary`, `at` and `by` are `null` for records written before evidence intake. */
export type EvidenceRecord = {
  kind: string;
  url: string;
  /** Evidence document stored in the registry (evidence-documents); `url` points at its text. */
  document?: { name: string; sha256: string; size: number };
  summary?: string | null;
  at?: string | null;
  by?: string | null;
  data?: {
    tasks: number;
    passed_with: number;
    passed_without: number;
    runner?: string;
    uplift: number;
  };
  uplift?: number;
};

export type UsageStats = { uses: number; helped: number; transfer_rate: number | null };

export type ArtifactMetrics = {
  sessions_count: number;
  preloaded_sessions_count?: number;
  users_count: number;
  last_used_at: string | null;
  verification: { pass: number; fail: number; none: number; pass_rate: number | null };
  skill_age_days: number;
  versions: Array<{ version: string; sessions_count: number }>;
  uses: number;
  helped: number;
  transfer_rate: number | null;
  ablation_score: number | null;
  token_cost: number;
  token_efficiency: number | null;
  token_cost_estimated: true;
};

export type MetricsOverviewItem = {
  type: string;
  name: string;
  display_name: string | null;
  status: string;
  owner_team: string | null;
  latest_version: string | null;
  skill_age_days: number;
  sessions_count: number;
  users_count: number;
  last_used_at: string | null;
  verification_pass_rate: number | null;
  uses: number;
  transfer_rate: number | null;
  ablation_score: number | null;
  token_cost: number;
  token_efficiency: number | null;
};

export type MetricsTotals = {
  artifacts: number;
  by_status: Record<string, number>;
  uses: number;
  helped: number;
  transfer_rate: number | null;
  sessions: number;
  with_ablation: number;
  ablation_mean: number | null;
  median_token_cost: number | null;
};

export type MetricsOverviewResponse = {
  totals: MetricsTotals;
  items: MetricsOverviewItem[];
  next_offset: number | null;
};

export type MetricsOverviewParams = {
  type?: string;
  status?: string;
  team?: string;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type MetricsExportParams = {
  format: "csv" | "json";
  type?: string;
  status?: string;
  team?: string;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
};

export type MeSessionsSummary = {
  facts: number;
  skills: Array<{ name: string; count: number }>;
};

export type UsageBySource = {
  source: string;
  basis?: "loaded" | "assigned" | null;
  reports: number;
  reporters: number;
} & UsageStats;

export type UsageSummary = {
  versions: Array<{ version: string } & UsageStats>;
  total: UsageStats;
  by_source?: UsageBySource[];
};

export type UsageReportResponse = {
  version: string;
  use_count: number;
  help_count: number;
  transfer_rate: number | null;
};

export type VersionDetail = {
  version: string;
  /** quality-rubric: score by company and team rules at publish. */
  rubric?: RubricResult | null;
  purged?: boolean;
  purged_at?: string | null;
  digest: string;
  channel: VersionChannel;
  description: string;
  display_name: string | null;
  tags: string[];
  frontmatter: Record<string, unknown> | null;
  files: Array<{ path: string; sha256: string; size: number }>;
  warnings: unknown[];
  changelog: string | null;
  model_compat: string[];
  provenance: { source: string; ref: string | null };
  evidence: EvidenceRecord[];
  validated_at: string | null;
  use_count: number;
  help_count: number;
  usage?: UsageStats;
  published_by: string;
  published_at: string;
  quality?: QualityReport | null;
  components?: Array<{ type: string; name: string; path: string }>;
};

export type VersionListItem = {
  version: string;
  purged?: boolean;
  purged_at?: string | null;
  digest: string;
  channel: VersionChannel;
  published_at: string;
  published_by: string;
};

export type AuditEvent = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
};

export type ListArtifactsParams = {
  type?: string;
  status?: string;
  tag?: string;
  q?: string;
  team?: string;
  owner?: string;
  label?: string;
  agent?: string;
  visibility?: string;
  sort?: "updated" | "downloads";
  limit?: number;
  offset?: number;
};

export type ListArtifactsResponse = {
  items: ArtifactSummary[];
  total: number;
};

export type RuntimeInstall = {
  runtime: string;
  label: string;
  supported: boolean;
  command: string | null;
  reason: string | null;
};

export type ArtifactInstall = {
  marketplace_name: string;
  marketplace_url: string;
  plugin_name: string;
  tgz_url: string;
  zip_url: string;
  /** Present for settings profiles: CLI apply command. */
  cli?: string;
  /** One entry per agent runtime, in runtime-table order. */
  runtimes?: RuntimeInstall[];
};

export type ArtifactDetailResponse = {
  artifact: ArtifactSummary;
  latest: VersionDetail | null;
  versions: VersionListItem[];
  channels?: Record<VersionChannel, { version: string; digest: string } | null>;
  allowed_transitions?: string[];
  viewer?: { watching: boolean } | null;
  usage_total?: UsageStats;
  install?: ArtifactInstall;
};

export type InstallInfo = {
  marketplace_name: string;
  marketplace_url: string;
  /** release-dist: the SkillForge CLI package served by this registry, when the release has one. */
  cli?: { version: string | null; url: string } | null;
};

export type LifecycleStatus = "candidate" | "active" | "aging" | "zombie" | "retired";

export type CleanupReason = {
  code: string;
  text: string;
  metrics: Record<string, unknown>;
};

export type CleanupItem = {
  type: string;
  name: string;
  status: string;
  since: string;
  reasons: CleanupReason[];
  suggested_action: "review" | "retire";
};

export type LifecycleHold = {
  until: string;
  reason: string;
  set_by: string;
  set_at: string;
};

export type AblationSignal = {
  tasks: number;
  passed_with: number;
  passed_without: number;
  uplift: number;
  at: string | null;
  by: string | null;
};

export type LifecycleSignals = {
  last_activity_at: string | null;
  window_days: number;
  uses_window: number;
  reporters_window: number;
  transfer_rate_window: number | null;
  sessions_window: number;
  verification_pass_rate: number | null;
  ablation: AblationSignal | null;
};

export type WouldTransition = {
  to: string;
  rule: string;
  metrics?: Record<string, unknown>;
};

export type ArtifactLifecycle = {
  status: string;
  hold: LifecycleHold | null;
  signals: LifecycleSignals;
  would_transition: WouldTransition | null;
};

export type LifecyclePolicyView = {
  enabled: boolean;
  aging_days: number;
  zombie_idle_days: number;
  zombie_window_days: number;
  zombie_min_uses: number;
  zombie_min_reporters: number;
  zombie_transfer_rate: number;
  zombie_retire_days: number;
  ablation_min_tasks: number;
  revive_window_days: number;
  revive_min_events: number;
  max_per_sweep: number;
};

export type SweepPlanItem = {
  type: string;
  name: string;
  from: string;
  to: string;
  rule: string;
  metrics: Record<string, unknown>;
};

export type SweepResult = {
  aged: number;
  zombied: number;
  revived: number;
  held: number;
  deferred: number;
  dry_run: boolean;
  plan: SweepPlanItem[];
};

export type LifecycleBoard = {
  review: ArtifactSummary[];
  stale_candidates: ArtifactSummary[];
  aging: ArtifactSummary[];
  zombie: ArtifactSummary[];
  retired_recent: ArtifactSummary[];
  counts: {
    candidate: number;
    active: number;
    aging: number;
    zombie: number;
    retired: number;
  };
  cleanup: CleanupItem[];
};

export type TransitionResponse = {
  artifact: ArtifactSummary;
  event: AuditEvent;
};

export type Issue = {
  code: string;
  message: string;
  path?: string;
};

export type ValidateArtifact = {
  type: ArtifactType | string;
  name: string;
  description: string;
  display_name: string | null;
  tags: string[];
  files: Array<{ path: string; sha256: string; size: number }>;
  digest: string;
};

export type ValidateExisting = {
  latest_version: string | null;
  versions_count: number;
  status: string;
};

export type ValidateResponse = {
  ok: boolean;
  detected_type: ArtifactType | string | null;
  type: ArtifactType | string | null;
  artifact: ValidateArtifact | null;
  errors: Issue[];
  warnings: Issue[];
  existing: ValidateExisting | null;
  next_version: string | null;
  conflicts: Array<"version_invalid" | "version_exists" | "digest_exists" | string>;
  quality?: QualityReport | null;
  duplicates?: RegistryDuplicate[];
};

export type PublishRequest = {
  type: string;
  name?: string;
  description?: string;
  version?: string;
  changelog?: string;
  provenance?: { source: string; ref: string | null };
  visibility?: "org" | "team";
  owner_team?: string | null;
  files: Array<{ path: string; content_base64: string }>;
};

export type PublishResponse = {
  artifact: ArtifactSummary;
  version: VersionDetail;
  warnings: Issue[];
};

export type PublishErrorBody = {
  error: string;
  message?: string;
  errors?: Issue[];
  warnings?: Issue[];
};
export type Role = "viewer" | "contributor" | "reviewer" | "admin";

export type AdminUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  disabled: boolean;
  created_at: string;
  updated_at: string;
  source?: string;
};

export type AuthProviderInfo = {
  id: string;
  label: string;
  type: "oidc" | "ldap";
};

export type AuthProvidersResponse = {
  mode: "password" | "local";
  password: boolean;
  providers: AuthProviderInfo[];
};

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  mcp: boolean;
  mcp_tags: string[];
};

export type CreatedToken = {
  id: string;
  name: string;
  prefix: string;
  token: string;
  mcp: boolean;
  mcp_tags: string[];
};

export type CreateTokenInput = {
  name: string;
  mcp?: boolean;
  mcp_tags?: string[];
};
export type ImportSkipped = { path: string; reason: string };

export type ImportCandidate = {
  id: string;
  type: string;
  name: string;
  root: string;
  files: Array<{ path: string; size: number }>;
  provenance: { source: string; ref: string | null };
  dry_run: {
    ok: boolean;
    errors: Issue[];
    warnings: Issue[];
    existing: ValidateExisting | null;
    next_version: string | null;
    conflicts: string[];
  };
};

export type ImportPreviewResponse = {
  import_id: string;
  source: {
    kind: string;
    ref: string;
    commit?: string;
    freshness?: { required_days: number; first_seen_at: string; ready_at: string; ready: boolean };
  };
  candidates: ImportCandidate[];
  skipped: ImportSkipped[];
};

export type ImportPreviewRequest = {
  source:
    | { kind: "files"; files: Array<{ path: string; content_base64: string }> }
    | { kind: "zip"; content_base64: string }
    | { kind: "git"; url: string; ref?: string; path?: string };
};

export type ImportRunRequest = {
  import_id: string;
  selected: string[] | "all";
  provenance_source?: string;
  skip_conflicts?: boolean;
  age_override_reason?: string;
};

export type ImportResultItem = {
  id: string;
  type: string;
  name: string;
  status: "created" | "skipped" | "failed";
  version?: string;
  reason?: string;
  errors?: Issue[];
};

export type ImportRunResponse = { results: ImportResultItem[] };

export type BackupListItem = {
  name: string;
  size: number;
  created_at: string;
};

export type BackupCounts = {
  users: number;
  artifacts: number;
  versions: number;
  blobs: number;
};

export type BackupCreated = BackupListItem & {
  counts: BackupCounts;
};

export type AdminPluginItem = {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  status: "loaded" | "error" | "disabled";
  error: string | null;
  capabilities: string[];
  contributions: {
    routes: number;
    nav: number;
    tabs: number;
    events: string[];
  };
  config: Record<string, unknown>;
  config_schema: unknown;
  restart_required: boolean;
};

export type AdminPluginsResponse = {
  dir: string;
  disabled: boolean;
  items: AdminPluginItem[];
};

export type PluginsUiResponse = {
  nav: Array<{ plugin: string; id: string; label: string; path: string }>;
  artifact_tabs: Array<{ plugin: string; id: string; label: string }>;
};

export type PluginPageResponse = { title: string; markdown: string };
export type PluginTabAction = {
  id: string;
  label: string;
  path: string;
  body?: Record<string, unknown>;
  confirm?: string;
};
export type PluginTabSection = {
  id: string;
  markdown: string;
  actions: PluginTabAction[];
};
export type PluginTabResponse = {
  markdown: string;
  sections?: PluginTabSection[];
  actions?: PluginTabAction[];
  refresh_ms?: number;
};

export type AgentKind = "upload" | "server";
/** Runtime label of an agent: any id from `GET /api/v1/runtimes` or `generic`. */
export type AgentRuntime = string;

/** One row of `GET /api/v1/runtimes` (the server runtime table). */
export type RuntimeListItem = {
  id: string;
  label: string;
  docs_url?: string;
  scopes?: unknown;
};

export type RuntimesResponse = { items: RuntimeListItem[] };
export type AgentItemStatus = "local_only" | "in_sync" | "outdated" | "modified" | "registry_only";

export type AgentSummaryCounts = {
  local_only: number;
  in_sync: number;
  outdated: number;
  modified: number;
  registry_only: number;
};

export type AgentPublic = {
  id: string;
  name: string;
  kind: AgentKind;
  runtime: string | null;
  server_path: string | null;
  created_at: string;
  updated_at: string;
  scanned_at: string | null;
};

export type AgentListItem = AgentPublic & {
  item_count: number;
  summary: AgentSummaryCounts;
};

export type AgentListResponse = { items: AgentListItem[] };

export type AgentItemLocal = {
  version: string | null;
  digest: string;
  files: number;
};

export type AgentItemRegistry = {
  latest_version: string;
  matched_version: string | null;
  status: string;
} | null;

export type AgentComparedItem = {
  key: string;
  type: string;
  name: string;
  status: AgentItemStatus;
  local: AgentItemLocal;
  registry: AgentItemRegistry;
  changed_files?: string[];
  /** Installed from the registry in a client format and matched through the lock (optional, absent in old snapshots). */
  translated?: boolean;
};

export type AgentRegistryOnly = {
  type: string;
  name: string;
  status: string;
  latest_version: string;
};

/** One MCP server observed in an agent's configs (agent scan --mcp): names, kinds and flags, never values. */
export type AgentMcpServer = {
  name: string;
  runtime: string;
  source: string;
  scope: "project" | "user" | "local";
  transport: "stdio" | "http" | "sse" | "ws" | "unknown";
  launcher: string | null;
  package: string | null;
  pinned: boolean;
  version: string | null;
  origin: string | null;
  env: Array<{ name: string; kind: "reference" | "literal" | "empty"; secret_like: boolean }>;
  headers: Array<{ name: string; kind: "reference" | "literal" | "empty"; secret_like: boolean }>;
  literal_secret: boolean;
  enabled: boolean;
};

export type AgentDetailResponse = {
  agent: AgentPublic;
  summary: AgentSummaryCounts;
  items: AgentComparedItem[];
  registry_only: AgentRegistryOnly[];
  skipped?: unknown;
  invalid?: unknown;
  duplicates?: AgentDuplicate[];
  mcp_scanned_at?: string | null;
  mcp_servers?: AgentMcpServer[];
};

export type AdminAgentListItem = AgentListItem & {
  owner: { id: string; username: string };
};

export type AdminAgentsResponse = {
  items: AdminAgentListItem[];
  roots: string[];
  roots_enabled: boolean;
};

export type AgentScanUploadRequest = {
  runtime?: string | null;
  files: Array<{ path: string; content_base64: string }>;
  lock?: unknown;
};

export type MeOverviewUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
};

export type MeOverviewActivityItem = {
  ts: string;
  actor: string;
  action: string;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  type: string;
  name: string;
};

export type MeOverview = {
  user: MeOverviewUser;
  artifacts: {
    total: number;
    by_status: Record<LifecycleStatus, number> & Record<string, number>;
    items: ArtifactSummary[];
  };
  agents: {
    total: number;
    attention: number;
    items: Array<{
      name: string;
      kind: AgentKind;
      runtime: string | null;
      scanned_at: string | null;
      summary: AgentSummaryCounts;
    }>;
  };
  tokens: {
    active: number;
    never_used: number;
    last_used_at: string | null;
  };
  review: {
    pending: number;
    items: ArtifactSummary[];
  } | null;
  activity: MeOverviewActivityItem[];
  sessions: MeSessionsSummary;
  notifications?: { unread: number };
};

export type FacetCount = { value: string; count: number };

export type ArtifactsFacets = {
  types: FacetCount[];
  statuses: FacetCount[];
  teams: FacetCount[];
  owners: FacetCount[];
  labels: FacetCount[];
};

export type TeamSummary = {
  name: string;
  display_name: string | null;
  description: string | null;
  members_count: number | null;
  is_member: boolean;
};

export type TeamMember = { username: string; role: "member" | "lead" | string };

export type TeamDetail = {
  name: string;
  display_name: string | null;
  description: string | null;
  created_by: string;
  created_at: string;
  members: TeamMember[] | null;
  is_member: boolean;
};

export type ScopeResponse = { visibility: string; owner_team: string | null };

export type LabelsResponse = { labels: string[] };

export type CommentDto = {
  id: string;
  version: string | null;
  parent_id: string | null;
  author: string;
  body: string;
  ref: string | null;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  replies?: CommentDto[];
};

export type CommentsListResponse = {
  items: CommentDto[];
  next_cursor: string | null;
};

export type NotificationDto = {
  id: string;
  kind: string;
  artifact: { type: string; name: string } | null;
  version: string | null;
  comment_id: string | null;
  actor: string | null;
  title: string;
  text: string | null;
  url: string;
  created_at: string;
  read: boolean;
};

export type NotificationsListResponse = {
  items: NotificationDto[];
  unread_count: number;
  next_cursor: string | null;
};

export type NotificationPrefs = {
  comment: boolean;
  mention: boolean;
  new_version: boolean;
  status_change: boolean;
  plugin: boolean;
};

export type EvalGate = "off" | "required";
export type EvalCheckType = "contains" | "not_contains" | "equals";
export type EvalCheck = { type: EvalCheckType; value: string; ci?: boolean };
export type EvalCase = {
  id: string;
  kind: "trigger" | "task";
  prompt: string;
  holdout: boolean;
  expect_trigger?: boolean;
  checks?: EvalCheck[];
};
export type EvalRunnerInfo = { id: string; label?: string };
export type EvalSuiteResponse = {
  gate: EvalGate;
  cases: EvalCase[];
  runners: EvalRunnerInfo[];
};
export type EvalRunStatus = "queued" | "running" | "done" | "failed";
export type EvalRunKind = "trigger" | "compare" | "ablation";
export type EvalRunScope = "all" | "holdout";
export type EvalRunResult = {
  case_id: string;
  side: string;
  passed: boolean;
  triggered?: boolean | null;
  error?: string | null;
  duration_ms?: number | null;
  output_excerpt?: string | null;
};
export type EvalRunSummary = Record<string, unknown>;
export type EvalRun = {
  id: string;
  kind: EvalRunKind;
  version: string;
  against: string | null;
  runner: string | null;
  scope: EvalRunScope;
  status: EvalRunStatus;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  errors: number;
  error: string | null;
  summary: EvalRunSummary | null;
  results?: EvalRunResult[];
};
export type EvalJournalItem = {
  version: string;
  channel: string;
  published_at: string | null;
  trigger: {
    recall: number | null;
    specificity: number | null;
    accuracy: number | null;
    run_id: string;
  } | null;
  holdout: { pass_rate: number | null; run_id: string } | null;
  vs_previous: {
    against: string;
    wins_candidate: number;
    wins_baseline: number;
    ties: number;
    run_id: string;
  } | null;
  ablation: { uplift: number | null; tasks: number; run_id: string } | null;
  gate: "passed" | "failed" | "missing" | "not_applicable";
};

export type ImportPolicy = {
  git_mode: "open" | "allowlist";
  allowed_sources: string[];
  allow_archives: boolean;
  min_release_age_days: number;
};

export type MirrorReport = {
  status: "ok" | "quarantined" | "failed";
  commit?: string;
  ready_at?: string;
  error?: string;
  imported: string[];
  updated: string[];
  unchanged: string[];
  failed: Array<{ id: string; reason?: string }>;
};

export type Mirror = {
  id: string;
  url: string;
  ref: string | null;
  path: string | null;
  include: string[];
  created_by: string;
  created_at: string;
  last_checked_at: string | null;
  last_commit: string | null;
  last_status: string | null;
  last_report: MirrorReport | null;
};

export type VersionDiff = {
  from: string;
  to: string;
  files: Array<{
    path: string;
    status: "added" | "removed" | "modified" | "unchanged";
    binary?: true;
    too_large?: true;
    diff?: string;
  }>;
  summary: { added: number; removed: number; modified: number; unchanged: number };
};

export type AvailabilityState = "unavailable" | "available" | "default" | "required";
export type Availability = { items: Array<{ team: string; state: AvailabilityState }> };

export type Orphan = {
  type: string;
  name: string;
  owner: string;
  owner_state: "disabled" | "missing";
  maintainers: string[];
  suggested_owner: string | null;
};

/** One event of the admin audit journal (audit-export). */
export type JournalEvent = {
  cursor: string;
  ts: string;
  source: "artifact" | "system";
  actor: string;
  action: string;
  artifact: { type: string; name: string } | null;
  version: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  target: string | null;
  meta: Record<string, unknown> | null;
};

export type JournalPage = { items: JournalEvent[]; next: string | null };

export type JournalFilters = { action?: string; actor?: string };

/** One cell of the cost-per-solve matrix: a runner and a side of its latest compare or ablation run. */
export type EvalCostCell = {
  runner: string;
  runner_label: string;
  model: string | null;
  agent: string | null;
  kind: string;
  version: string;
  against: string | null;
  side: string;
  run_id: number;
  finished_at: string | null;
  tasks: number;
  passed: number;
  pass_rate: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  cost_per_solve: number | null;
};

/** Report for management (executive-report). */
export type ExecutiveReport = {
  period: { days: number; from: string; to: string };
  totals: { sessions: number; previous_sessions: number; users: number; active_artifacts: number };
  trend: Array<{ start: string; sessions: number }>;
  teams: Array<{
    team: string | null;
    sessions: number;
    previous_sessions: number;
    users: number;
    est_context_tokens: number;
  }>;
  artifacts: Array<{
    type: string;
    name: string;
    status: string;
    owner_team: string | null;
    sessions: number;
    previous_sessions: number;
    est_context_tokens: number;
  }>;
  unused: Array<{
    type: string;
    name: string;
    status: string;
    owner_team: string | null;
    recent: boolean;
  }>;
};

/** Company or team quality rules (quality-rubric). */
export type RubricCriterion = {
  id: string;
  type: "require_heading" | "require_file" | "forbid_phrase";
  value: string;
  weight: number;
};
export type QualityRubric = {
  threshold: number;
  enforce: "off" | "warn" | "block";
  weights: Record<string, number>;
  criteria: RubricCriterion[];
};
export type RubricResult = {
  score: number;
  threshold: number;
  enforce: "warn" | "block";
  passed: boolean;
  failed: Array<{ id: string; weight: number }>;
};

/** Organisation-wide summary of agent snapshots (shadow-inventory). */
export type InventoryStatus = "in_sync" | "outdated" | "modified" | "unregistered";
export type InventoryArtifact = {
  type: string;
  name: string;
  origin: "own" | "imported" | "unregistered";
  registry_status: string | null;
  copies: number;
  people: number;
  variants: number;
  statuses: Partial<Record<InventoryStatus, number>>;
};
export type OrganisationInventory = {
  totals: {
    agents: number;
    people: number;
    copies: number;
    by_status: Record<InventoryStatus, number>;
  };
  artifacts: InventoryArtifact[];
  people: Array<{
    username: string;
    agents: number;
    copies: number;
    unregistered: number;
    last_scan: string | null;
  }>;
  mcp?: InventoryMcp;
};

/** The mcp section of the organisation inventory (mcp-shadow-inventory). */
export type InventoryMcpServer = {
  key: string;
  kind: "package" | "origin" | "name";
  label: string;
  names: string[];
  transports: string[];
  installs: number;
  people: string[];
  versions: string[];
  unpinned_installs: number;
  literal_secret_installs: number;
  disabled_installs: number;
  registry: { name: string; status: string } | null;
};
export type InventoryMcp = {
  totals: {
    agents: number;
    people: number;
    servers: number;
    installs: number;
    unpinned_installs: number;
    literal_secret_installs: number;
    remote_installs: number;
  };
  servers: InventoryMcpServer[];
};

/** Rollout through pull requests (pr-rollout). */
export type Rollout = {
  id: number;
  created_by: string;
  created_at: string;
  request: { repos: string[]; artifacts: Array<{ type: string; name: string }> };
  results: Array<{ repo: string; status: "opened" | "failed"; pr_url?: string; error?: string }>;
};

/** Recurring review rules collected into a skill draft (skill-harvest). */
export type Harvest = {
  id: number;
  created_by: string;
  created_at: string;
  request: { source: string; repo: string; days: number };
  rules: Array<{ text: string; count: number; sources: number; evidence: string[] }>;
};

/** Team method pack (method-packs). */
export type PackSummary = {
  name: string;
  owner: string;
  title: string;
  description: string;
  latest_version: string | null;
  updated_at: string;
  versions: string[];
};
export type PackVersion = {
  version: string;
  title: string;
  description: string;
  published_by: string;
  published_at: string;
  roles: Array<{
    name: string;
    description: string;
    items: Array<{ type: string; name: string; version: string }>;
  }>;
};

/** A layer of edits over an artifact (artifact-overlays). */
export type OverlayLayer = {
  scope: string;
  ops: Array<{ op: "append" | "replace" | "add"; path: string; text: string }>;
  updated_by: string;
  updated_at: string;
};
