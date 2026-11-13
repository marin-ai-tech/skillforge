import type {
  ImportPolicy,
  Orphan,
  Availability,
  AvailabilityState,
  VersionDiff,
  Mirror,
  MirrorReport,
  SecurityPolicy,
  McpPolicy,
  McpCard,
  CommentDto,
  CommentsListResponse,
  NotificationDto,
  NotificationsListResponse,
  NotificationPrefs,
  EvidenceKind,
  EvidenceRecord,
  UsageReportResponse,
  UsageSummary,
  ArtifactDetailResponse,
  AuditEvent,
  ListArtifactsParams,
  ListArtifactsResponse,
  PublishErrorBody,
  PublishRequest,
  PublishResponse,
  ValidateResponse,
  VersionChannel,
  VersionDetail,
  AdminUser,
  ApiToken,
  CreatedToken,
  CreateTokenInput,
  Role,
  LifecycleBoard,
  ArtifactLifecycle,
  LifecycleHold,
  LifecyclePolicyView,
  SweepResult,
  TransitionResponse,
  ImportPreviewRequest,
  ImportPreviewResponse,
  ImportRunRequest,
  ImportRunResponse,
  InstallInfo,
  BackupListItem,
  BackupCreated,
  AdminPluginItem,
  AdminPluginsResponse,
  PluginsUiResponse,
  PluginPageResponse,
  PluginTabResponse,
  AgentListResponse,
  AgentDetailResponse,
  AdminAgentsResponse,
  AgentScanUploadRequest,
  RuntimesResponse,
  MeOverview,
  ArtifactMetrics,
  ArtifactDuplicatesResponse,
  AuthProvidersResponse,
  MetricsOverviewResponse,
  MetricsOverviewParams,
  MetricsExportParams,
  JournalFilters,
  JournalPage,
} from "./types.ts";

export class ApiError extends Error {
  status: number;
  error: string;
  owner?: string;
  detail?: string;
  reason?: string;

  constructor(
    status: number,
    error: string,
    message?: string,
    owner?: string,
    extra?: { detail?: string; reason?: string },
  ) {
    super(message ?? error);
    this.name = "ApiError";
    this.status = status;
    this.error = error;
    if (owner !== undefined) this.owner = owner;
    if (extra?.detail !== undefined) this.detail = extra.detail;
    if (extra?.reason !== undefined) this.reason = extra.reason;
  }
}

export type MeUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: "viewer" | "contributor" | "reviewer" | "admin";
};

function maybeRedirect401(err: ApiError): void {
  if (err.status !== 401) return;
  if (typeof window === "undefined") return;
  const path = window.location.pathname + window.location.search;
  if (path.startsWith("/login")) return;
  window.location.assign("/login?next=" + encodeURIComponent(path || "/"));
}

export async function parseError(
  res: Response,
  opts: { redirect?: boolean } = {},
): Promise<ApiError> {
  let error = "request_failed";
  let message: string | undefined;
  let owner: string | undefined;
  let detail: string | undefined;
  let reason: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: string;
      message?: string;
      owner?: string;
      detail?: string;
      reason?: string;
      errors?: unknown;
    };
    if (body.error) error = body.error;
    if (body.message) message = body.message;
    if (typeof body.owner === "string") owner = body.owner;
    if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.errors)) {
      detail = (body.errors as unknown[]).filter((x) => typeof x === "string").join("\n");
    }
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    /* ignore */
  }
  const err = new ApiError(res.status, error, message, owner, { detail, reason });
  if (opts.redirect !== false) maybeRedirect401(err);
  return err;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function listArtifactTypes(): Promise<{
  items: import("./types.ts").ArtifactTypeInfo[];
}> {
  const res = await fetch("/api/v1/artifact-types");
  if (!res.ok) throw new Error(`artifact-types ${res.status}`);
  return res.json() as Promise<{ items: import("./types.ts").ArtifactTypeInfo[] }>;
}

export async function listArtifacts(
  params: ListArtifactsParams = {},
): Promise<ListArtifactsResponse> {
  const res = await fetch(`/api/v1/artifacts${qs(params)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ListArtifactsResponse;
}

export async function getArtifactDuplicates(
  type: string,
  name: string,
): Promise<ArtifactDuplicatesResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/duplicates`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ArtifactDuplicatesResponse;
}

export async function getArtifact(type: string, name: string): Promise<ArtifactDetailResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ArtifactDetailResponse;
}

export type PurgeResult = {
  purged: string;
  blobs_deleted: number;
  blobs_failed: string[];
  blobs_shared: Array<{ sha256: string; versions: string[] }>;
  backups_predating: string[];
  backups_deleted: string[];
};

export async function patchArtifactMetadata(
  type: string,
  name: string,
  body: {
    display_name?: string | null;
    description?: string | null;
    tags?: string[] | null;
    agents?: string | null;
  },
): Promise<import("./types.ts").ArtifactSummary> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/metadata`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<import("./types.ts").ArtifactSummary>;
}

export async function purgeArtifact(
  type: string,
  name: string,
  version: string | null,
  body: { reason: string; confirm: string; delete_backups: boolean },
): Promise<PurgeResult> {
  const base = `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}`;
  const res = await fetch(
    `${base}${version ? `/versions/${encodeURIComponent(version)}` : ""}/purge`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<PurgeResult>;
}

export async function listVersions(
  type: string,
  name: string,
): Promise<{ items: VersionDetail[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: VersionDetail[] };
}

export async function getVersion(
  type: string,
  name: string,
  version: string,
): Promise<VersionDetail> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as VersionDetail;
}

export async function getFileText(
  type: string,
  name: string,
  version: string,
  filePath: string,
): Promise<string> {
  const enc = filePath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/files/${enc}`,
  );
  if (!res.ok) throw await parseError(res);
  return await res.text();
}

export function fileUrl(type: string, name: string, version: string, filePath: string): string {
  const enc = filePath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/files/${enc}`;
}

export async function listAudit(type: string, name: string): Promise<{ items: AuditEvent[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/audit`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: AuditEvent[] };
}

export async function validateArtifact(
  body: Omit<PublishRequest, "type"> & { type?: string },
): Promise<ValidateResponse> {
  const res = await fetch("/api/v1/artifacts/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 400) {
    const err = await parseError(res);
    throw err;
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ValidateResponse;
}

export async function publishArtifact(body: PublishRequest): Promise<PublishResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const res = await fetch("/api/v1/artifacts", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let extra: PublishErrorBody | undefined;
    try {
      extra = (await res.json()) as PublishErrorBody;
    } catch {
      /* ignore */
    }
    const err = new ApiError(res.status, extra?.error ?? "request_failed", extra?.message);
    (err as ApiError & { body?: PublishErrorBody }).body = extra;
    throw err;
  }
  return (await res.json()) as PublishResponse;
}

export async function me(): Promise<MeUser | null> {
  const res = await fetch("/api/v1/me");
  if (res.status === 401) return null;
  if (!res.ok) throw await parseError(res, { redirect: false });
  const body = (await res.json()) as { user: MeUser };
  return body.user;
}

export async function getAuthProviders(): Promise<AuthProvidersResponse> {
  const res = await fetch("/api/v1/auth/providers");
  if (!res.ok) {
    throw new ApiError(res.status, "providers_failed");
  }
  return (await res.json()) as AuthProvidersResponse;
}

export async function login(username: string, password: string): Promise<MeUser> {
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { user: MeUser };
  return body.user;
}

export async function ldapLogin(
  providerId: string,
  username: string,
  password: string,
): Promise<MeUser> {
  const res = await fetch(`/api/v1/auth/ldap/${encodeURIComponent(providerId)}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { user: MeUser };
  return body.user;
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/v1/auth/logout", { method: "POST" });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}

export async function listUsers(): Promise<{ items: AdminUser[] }> {
  const res = await fetch("/api/v1/admin/users");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: AdminUser[] };
}

export async function createUser(body: {
  username: string;
  password: string;
  role: Role;
  display_name?: string;
}): Promise<AdminUser> {
  const res = await fetch("/api/v1/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminUser;
}

export async function updateUser(
  id: string,
  body: {
    role?: Role;
    disabled?: boolean;
    display_name?: string | null;
    password?: string;
  },
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminUser;
}

export async function listTokens(): Promise<{ items: ApiToken[] }> {
  const res = await fetch("/api/v1/me/tokens");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: ApiToken[] };
}

export async function createToken(input: CreateTokenInput | string): Promise<CreatedToken> {
  const body = typeof input === "string" ? { name: input } : input;
  const res = await fetch("/api/v1/me/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CreatedToken;
}

export async function revokeToken(id: string): Promise<void> {
  const res = await fetch(`/api/v1/me/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}

export async function changePassword(current: string, next: string): Promise<void> {
  const res = await fetch("/api/v1/me/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ current, next }),
  });
  if (!res.ok && res.status !== 204) throw await parseError(res, { redirect: false });
}

export async function transitionArtifact(
  type: string,
  name: string,
  body: { to: string; reason?: string },
): Promise<TransitionResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/transitions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as TransitionResponse;
}

export async function validateVersion(
  type: string,
  name: string,
  version: string,
  body: { model_compat?: string[]; note?: string } = {},
): Promise<VersionDetail> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/validate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as VersionDetail;
}

export async function setVersionChannel(
  type: string,
  name: string,
  version: string,
  channel: VersionChannel,
): Promise<{ version: VersionDetail; latest_version: string | null }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/channel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel }),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { version: VersionDetail; latest_version: string | null };
}

export async function getBoard(): Promise<LifecycleBoard> {
  const res = await fetch("/api/v1/lifecycle/board");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LifecycleBoard;
}

export async function sweepLifecycle(body?: { dry_run?: boolean }): Promise<SweepResult> {
  const res = await fetch("/api/v1/admin/lifecycle/sweep", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as SweepResult;
}

export async function getLifecyclePolicy(): Promise<LifecyclePolicyView> {
  const res = await fetch("/api/v1/admin/lifecycle/policy");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LifecyclePolicyView;
}

export async function getArtifactLifecycle(type: string, name: string): Promise<ArtifactLifecycle> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/lifecycle`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ArtifactLifecycle;
}

export async function setLifecycleHold(
  type: string,
  name: string,
  body: { until: string; reason: string },
): Promise<{ hold: LifecycleHold }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/lifecycle-hold`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { hold: LifecycleHold };
}

export async function clearLifecycleHold(type: string, name: string): Promise<{ hold: null }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/lifecycle-hold`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { hold: null };
}

export async function importPreview(body: ImportPreviewRequest): Promise<ImportPreviewResponse> {
  const res = await fetch("/api/v1/imports/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ImportPreviewResponse;
}

export async function importRun(body: ImportRunRequest): Promise<ImportRunResponse> {
  const res = await fetch("/api/v1/imports/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ImportRunResponse;
}

export async function getVersionDiff(
  type: string,
  name: string,
  from: string,
  to: string,
): Promise<VersionDiff> {
  const q = new URLSearchParams({ from, to });
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/diff?${q}`,
    { credentials: "include" },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as VersionDiff;
}

export async function listOrphans(): Promise<{ items: Orphan[] }> {
  const res = await fetch("/api/v1/admin/orphans", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: Orphan[] };
}

export async function setReplacement(
  type: string,
  name: string,
  replacedBy: string | null,
): Promise<{ replaced_by: string | null }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/replacement`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replaced_by: replacedBy }),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { replaced_by: string | null };
}

export async function getAvailability(type: string, name: string): Promise<Availability> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/availability`,
    { credentials: "include" },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as Availability;
}

export async function setAvailability(
  type: string,
  name: string,
  body: { team: string; state: AvailabilityState },
): Promise<Availability> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/availability`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as Availability;
}

export async function listMirrors(): Promise<{ items: Mirror[] }> {
  const res = await fetch("/api/v1/admin/mirrors", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: Mirror[] };
}

export async function addMirror(body: {
  url: string;
  ref?: string;
  path?: string;
}): Promise<{ mirror: Mirror }> {
  const res = await fetch("/api/v1/admin/mirrors", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { mirror: Mirror };
}

export async function checkMirror(id: string): Promise<{ report: MirrorReport }> {
  const res = await fetch(`/api/v1/admin/mirrors/${encodeURIComponent(id)}/check`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { report: MirrorReport };
}

export async function deleteMirror(id: string): Promise<void> {
  const res = await fetch(`/api/v1/admin/mirrors/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
}

export async function getSecurityPolicy(): Promise<{ policy: SecurityPolicy }> {
  const res = await fetch("/api/v1/admin/security-policy", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { policy: SecurityPolicy };
}

export async function putSecurityPolicy(body: SecurityPolicy): Promise<{ policy: SecurityPolicy }> {
  const res = await fetch("/api/v1/admin/security-policy", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { policy: SecurityPolicy };
}

export async function getMcpCard(name: string, version: string): Promise<McpCard> {
  const res = await fetch(
    `/api/v1/artifacts/mcp-server/${encodeURIComponent(name)}/mcp?version=${encodeURIComponent(version)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as McpCard;
}

export async function getMcpPolicy(): Promise<{ policy: McpPolicy }> {
  const res = await fetch("/api/v1/admin/mcp-policy", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { policy: McpPolicy };
}

export async function putMcpPolicy(body: McpPolicy): Promise<{ policy: McpPolicy }> {
  const res = await fetch("/api/v1/admin/mcp-policy", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { policy: McpPolicy };
}

export async function getImportPolicy(): Promise<{ policy: ImportPolicy }> {
  const res = await fetch("/api/v1/admin/import-policy", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { policy: ImportPolicy };
}

export async function putImportPolicy(
  body: Partial<ImportPolicy>,
): Promise<{ policy: ImportPolicy }> {
  const res = await fetch("/api/v1/admin/import-policy", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { policy: ImportPolicy };
}

export async function getInstallInfo(): Promise<InstallInfo> {
  const res = await fetch("/api/v1/install-info");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as InstallInfo;
}

export type StarterPackSummary = {
  id: string;
  title: string;
  description: string;
  license: string;
  artifacts: number;
  installed: number;
};

export type StarterPackInstallResult = {
  type: string;
  name: string;
  status: "created" | "exists" | "failed";
  error?: string;
};

export async function listStarterPacks(): Promise<{ items: StarterPackSummary[] }> {
  const res = await fetch("/api/v1/admin/starter-packs");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: StarterPackSummary[] };
}

export async function installStarterPack(
  id: string,
): Promise<{ results: StarterPackInstallResult[] }> {
  const res = await fetch(`/api/v1/admin/starter-packs/${encodeURIComponent(id)}/install`, {
    method: "POST",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { results: StarterPackInstallResult[] };
}

export type BatchTransitionItem = {
  type: string;
  name: string;
  to: string;
  reason?: string | null;
};

export type BatchTransitionResultItem = {
  type: string;
  name: string;
  ok: boolean;
  error?: string;
};

export async function batchTransitions(body: {
  items: BatchTransitionItem[];
  reason?: string | null;
}): Promise<{ results: BatchTransitionResultItem[] }> {
  const res = await fetch("/api/v1/lifecycle/batch-transitions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { results: BatchTransitionResultItem[] };
}

export async function listBackups(): Promise<{ items: BackupListItem[]; dir: string }> {
  const res = await fetch("/api/v1/admin/backups");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: BackupListItem[]; dir: string };
}

export async function createBackup(): Promise<BackupCreated> {
  const res = await fetch("/api/v1/admin/backups", { method: "POST" });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { backup: BackupCreated };
  return body.backup;
}

export async function deleteBackup(name: string): Promise<void> {
  const res = await fetch(`/api/v1/admin/backups/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}

export async function listAdminPlugins(): Promise<AdminPluginsResponse> {
  const res = await fetch("/api/v1/admin/plugins", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminPluginsResponse;
}

export async function patchAdminPlugin(
  name: string,
  body: { enabled?: boolean; config?: Record<string, unknown> },
): Promise<AdminPluginItem> {
  const res = await fetch(`/api/v1/admin/plugins/${encodeURIComponent(name)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AdminPluginItem;
}

export async function getPluginsUi(): Promise<PluginsUiResponse> {
  const res = await fetch("/api/v1/plugins/ui", { credentials: "include" });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as PluginsUiResponse;
}

export async function getPluginPage(plugin: string, page: string): Promise<PluginPageResponse> {
  const res = await fetch(
    `/api/v1/plugins/ui/pages/${encodeURIComponent(plugin)}/${encodeURIComponent(page)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as PluginPageResponse;
}

export async function getPluginTab(
  plugin: string,
  tab: string,
  type: string,
  name: string,
): Promise<PluginTabResponse> {
  const res = await fetch(
    `/api/v1/plugins/ui/tabs/${encodeURIComponent(plugin)}/${encodeURIComponent(tab)}/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as PluginTabResponse;
}

export async function runPluginAction(
  plugin: string,
  actionPath: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`/api/v1/ext/${encodeURIComponent(plugin)}${actionPath}`, {
    method: "POST",
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as unknown;
}

/** Server runtime table (`GET /api/v1/runtimes`). */
export async function listRuntimes(): Promise<RuntimesResponse> {
  const res = await fetch("/api/v1/runtimes", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as RuntimesResponse;
}

export async function listMyAgents(): Promise<AgentListResponse> {
  const res = await fetch("/api/v1/me/agents", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AgentListResponse;
}

export async function getMyAgent(
  name: string,
  opts?: { registry_status?: string },
): Promise<AgentDetailResponse> {
  const q = qs({ registry_status: opts?.registry_status });
  const res = await fetch(`/api/v1/me/agents/${encodeURIComponent(name)}${q}`, {
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AgentDetailResponse;
}

export async function putMyAgent(
  name: string,
  body: AgentScanUploadRequest,
): Promise<AgentDetailResponse> {
  const res = await fetch(`/api/v1/me/agents/${encodeURIComponent(name)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AgentDetailResponse;
}

export async function deleteMyAgent(name: string): Promise<void> {
  const res = await fetch(`/api/v1/me/agents/${encodeURIComponent(name)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}

export async function scanMyAgent(name: string): Promise<AgentDetailResponse> {
  const res = await fetch(`/api/v1/me/agents/${encodeURIComponent(name)}/scan`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AgentDetailResponse;
}

export async function publishAgentItem(
  agentName: string,
  type: string,
  itemName: string,
  body: { version?: string; changelog?: string } = {},
): Promise<PublishResponse> {
  const res = await fetch(
    `/api/v1/me/agents/${encodeURIComponent(agentName)}/items/${encodeURIComponent(type)}/${encodeURIComponent(itemName)}/publish`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as PublishResponse;
}

export async function listAdminAgents(): Promise<AdminAgentsResponse> {
  const res = await fetch("/api/v1/admin/agents", { credentials: "include" });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminAgentsResponse;
}

export async function createAdminAgent(body: {
  name: string;
  server_path: string;
  runtime?: string | null;
}): Promise<AgentDetailResponse> {
  const res = await fetch("/api/v1/admin/agents", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AgentDetailResponse;
}

export async function scanAdminAgent(id: string): Promise<AgentDetailResponse> {
  const res = await fetch(`/api/v1/admin/agents/${encodeURIComponent(id)}/scan`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as AgentDetailResponse;
}

export async function deleteAdminAgent(id: string): Promise<void> {
  const res = await fetch(`/api/v1/admin/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}

export async function getArtifactMetrics(type: string, name: string): Promise<ArtifactMetrics> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/metrics`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as ArtifactMetrics;
}

export async function getMetricsOverview(
  params: MetricsOverviewParams = {},
): Promise<MetricsOverviewResponse> {
  const res = await fetch(`/api/v1/metrics/overview${qs(params)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as MetricsOverviewResponse;
}

export async function exportMetrics(
  params: MetricsExportParams,
): Promise<{ blob: Blob; filename: string }> {
  const { format, ...rest } = params;
  const res = await fetch(`/api/v1/metrics/export${qs({ ...rest, format })}`, {
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="([^"]+)"/i.exec(cd);
  const filename = m?.[1] ?? `skillforge-metrics.${format}`;
  const blob = await res.blob();
  return { blob, filename };
}

export async function deleteMySessionFacts(source?: string): Promise<{ deleted: number }> {
  const q = source ? `?source=${encodeURIComponent(source)}` : "";
  const res = await fetch(`/api/v1/me/session-facts${q}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { deleted: number };
}

export async function getMeOverview(): Promise<MeOverview> {
  const res = await fetch("/api/v1/me/overview");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as MeOverview;
}

export async function addEvidence(
  type: string,
  name: string,
  version: string,
  body: {
    kind: EvidenceKind;
    url?: string;
    document?: { name: string; text: string };
    summary?: string;
    data?: {
      tasks: number;
      passed_with: number;
      passed_without: number;
      runner?: string;
    };
  },
): Promise<{ evidence: EvidenceRecord[]; validated_at: string | null }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/evidence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { evidence: EvidenceRecord[]; validated_at: string | null };
}

export async function getUsage(type: string, name: string): Promise<UsageSummary> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/usage`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as UsageSummary;
}

export async function reportUsage(
  type: string,
  name: string,
  body: { version?: string; uses: number; helped: number; source?: string; report_id?: string },
): Promise<UsageReportResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/usage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as UsageReportResponse;
}

export type OwnershipResponse = { owner: string; maintainers: string[] };
export type MaintainersResponse = { maintainers: string[] };

export async function transferArtifactOwner(
  type: string,
  name: string,
  body: { owner: string; reason: string },
): Promise<OwnershipResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/owner`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as OwnershipResponse;
}

export async function addArtifactMaintainer(
  type: string,
  name: string,
  username: string,
): Promise<MaintainersResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/maintainers`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as MaintainersResponse;
}

export async function removeArtifactMaintainer(
  type: string,
  name: string,
  username: string,
): Promise<MaintainersResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/maintainers/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as MaintainersResponse;
}

export async function listTeams(): Promise<{ items: import("./types.ts").TeamSummary[] }> {
  const res = await fetch("/api/v1/teams");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: import("./types.ts").TeamSummary[] };
}

export async function getTeam(name: string): Promise<import("./types.ts").TeamDetail> {
  const res = await fetch(`/api/v1/teams/${encodeURIComponent(name)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").TeamDetail;
}

export async function createTeam(body: {
  name: string;
  lead: string;
  display_name?: string;
  description?: string;
}): Promise<import("./types.ts").TeamDetail> {
  const res = await fetch("/api/v1/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").TeamDetail;
}

export async function addTeamMember(
  name: string,
  username: string,
  role?: string,
): Promise<import("./types.ts").TeamMember> {
  const res = await fetch(`/api/v1/teams/${encodeURIComponent(name)}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, ...(role ? { role } : {}) }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").TeamMember;
}

export async function removeTeamMember(name: string, username: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    `/api/v1/teams/${encodeURIComponent(name)}/members/${encodeURIComponent(username)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { ok: boolean };
}

export async function getArtifactFacets(): Promise<import("./types.ts").ArtifactsFacets> {
  const res = await fetch("/api/v1/artifacts/facets");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").ArtifactsFacets;
}

export async function putArtifactScope(
  type: string,
  name: string,
  body: { visibility: string; owner_team?: string | null; reason?: string },
): Promise<import("./types.ts").ScopeResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/scope`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").ScopeResponse;
}

const sourceUrl = (type: string, name: string) =>
  `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/source`;

/** Tracked source of an artifact, or null when it has none (404) or the viewer is not signed in (401). */
export async function getArtifactSource(
  type: string,
  name: string,
): Promise<import("./types.ts").TrackedSource | null> {
  const res = await fetch(sourceUrl(type, name), { credentials: "include" });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw await parseError(res, { redirect: false });
  return ((await res.json()) as { source: import("./types.ts").TrackedSource }).source;
}

export async function putArtifactSource(
  type: string,
  name: string,
  body: { enabled?: boolean; ref?: string | null },
): Promise<import("./types.ts").TrackedSource> {
  const res = await fetch(sourceUrl(type, name), {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return ((await res.json()) as { source: import("./types.ts").TrackedSource }).source;
}

export async function checkArtifactSource(
  type: string,
  name: string,
): Promise<import("./types.ts").SourceCheckResult> {
  const res = await fetch(`${sourceUrl(type, name)}/check`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").SourceCheckResult;
}

export async function putArtifactLabels(
  type: string,
  name: string,
  labels: string[],
): Promise<import("./types.ts").LabelsResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/labels`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labels }),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").LabelsResponse;
}

export type {
  CommentDto,
  CommentsListResponse,
  NotificationDto,
  NotificationsListResponse,
  NotificationPrefs,
};

export async function listComments(
  type: string,
  name: string,
  opts: { version?: string; ref?: string; limit?: number; cursor?: string } = {},
): Promise<CommentsListResponse> {
  const qs = new URLSearchParams();
  if (opts.version) qs.set("version", opts.version);
  if (opts.ref) qs.set("ref", opts.ref);
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const q = qs.toString() ? `?${qs}` : "";
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/comments${q}`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as CommentsListResponse;
}

export async function createComment(
  type: string,
  name: string,
  body: { body: string; version?: string; parent_id?: string; ref?: string },
): Promise<{ comment: CommentDto }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { comment: CommentDto };
}

export async function patchComment(id: string, body: string): Promise<{ comment: CommentDto }> {
  const res = await fetch(`/api/v1/comments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { comment: CommentDto };
}

export async function deleteComment(id: string): Promise<{ comment: CommentDto }> {
  const res = await fetch(`/api/v1/comments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { comment: CommentDto };
}

export async function putWatch(
  type: string,
  name: string,
  watching: boolean,
): Promise<{ watching: boolean }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/watch`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watching }),
    },
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { watching: boolean };
}

export async function listNotifications(
  opts: { unread?: boolean; limit?: number; cursor?: string } = {},
): Promise<NotificationsListResponse> {
  const qs = new URLSearchParams();
  if (opts.unread) qs.set("unread", "1");
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const q = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`/api/v1/me/notifications${q}`);
  if (!res.ok) throw await parseError(res, { redirect: false });
  return (await res.json()) as NotificationsListResponse;
}

export async function markNotificationsRead(
  body: { all: true } | { ids: string[] },
): Promise<{ updated: number }> {
  const res = await fetch("/api/v1/me/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { updated: number };
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const res = await fetch("/api/v1/me/notification-prefs");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as NotificationPrefs;
}

export async function putNotificationPrefs(
  prefs: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const res = await fetch("/api/v1/me/notification-prefs", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as NotificationPrefs;
}

export async function getEvalSuite(
  type: string,
  name: string,
): Promise<import("./types.ts").EvalSuiteResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<import("./types.ts").EvalSuiteResponse>;
}

export async function putEvalSuite(
  type: string,
  name: string,
  body: { gate?: import("./types.ts").EvalGate; cases: import("./types.ts").EvalCase[] },
): Promise<import("./types.ts").EvalSuiteResponse> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<import("./types.ts").EvalSuiteResponse>;
}

export async function startEvalRun(
  type: string,
  name: string,
  body: {
    kind: import("./types.ts").EvalRunKind;
    version: string;
    against?: string;
    runner?: string;
    scope?: import("./types.ts").EvalRunScope;
  },
): Promise<{ run: import("./types.ts").EvalRun }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals/runs`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: import("./types.ts").EvalRun }>;
}

export async function listEvalRuns(
  type: string,
  name: string,
): Promise<{ items: import("./types.ts").EvalRun[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals/runs`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: import("./types.ts").EvalRun[] }>;
}

export async function getEvalRun(
  type: string,
  name: string,
  id: string,
): Promise<{ run: import("./types.ts").EvalRun }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals/runs/${encodeURIComponent(id)}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: import("./types.ts").EvalRun }>;
}

export async function getEvalJournal(
  type: string,
  name: string,
): Promise<{ items: import("./types.ts").EvalJournalItem[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals/journal`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: import("./types.ts").EvalJournalItem[] }>;
}

/** cost-per-solve: runner x side cells, cheapest per solved task first. */
export async function getEvalCost(
  type: string,
  name: string,
): Promise<{ items: import("./types.ts").EvalCostCell[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/evals/cost`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: import("./types.ts").EvalCostCell[] }>;
}

// ---- Workflows (workflow-engine) ----
export type WorkflowListItem = {
  workflow_id: string;
  name: string | null;
  updated_at: string;
  updated_by: string;
};

export type WorkflowRunStep = {
  step_id: string;
  status: string;
  exit_code: number | null;
  timed_out: number;
  next_step: string | null;
  duration_ms: number | null;
  error: string | null;
};

export type WorkflowRun = {
  id: number;
  workflow_id: string;
  status: "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
  input: unknown;
  /** workflow gates: the step the run waits at or stopped at. */
  current_step?: string | null;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  steps?: WorkflowRunStep[];
};

export type RunOutputItem = {
  id: number;
  run_id: string;
  run_kind: string;
  stream: string;
  name: string | null;
  size: number;
  truncated: number;
};

const wfBase = (type: string, name: string) =>
  `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/workflows`;

export async function listWorkflows(
  type: string,
  name: string,
): Promise<{ items: WorkflowListItem[] }> {
  const res = await fetch(wfBase(type, name), { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: WorkflowListItem[] }>;
}

export async function getWorkflow(
  type: string,
  name: string,
  wf: string,
): Promise<{ workflow: { workflow_id: string; name: string | null; definition: unknown } }> {
  const res = await fetch(`${wfBase(type, name)}/${encodeURIComponent(wf)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{
    workflow: { workflow_id: string; name: string | null; definition: unknown };
  }>;
}

export async function putWorkflow(
  type: string,
  name: string,
  wf: string,
  definition: unknown,
): Promise<{ workflow_id: string; ok: boolean }> {
  const res = await fetch(`${wfBase(type, name)}/${encodeURIComponent(wf)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ definition }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ workflow_id: string; ok: boolean }>;
}

export async function startWorkflowRun(
  type: string,
  name: string,
  wf: string,
  input?: unknown,
): Promise<{ run: WorkflowRun }> {
  const res = await fetch(`${wfBase(type, name)}/${encodeURIComponent(wf)}/runs`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input === undefined ? {} : { input }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: WorkflowRun }>;
}

export async function listWorkflowRuns(
  type: string,
  name: string,
): Promise<{ items: WorkflowRun[] }> {
  const res = await fetch(`${wfBase(type, name)}/runs`, { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: WorkflowRun[] }>;
}

export async function getWorkflowRun(
  type: string,
  name: string,
  id: number,
): Promise<{ run: WorkflowRun }> {
  const res = await fetch(`${wfBase(type, name)}/runs/${id}`, { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: WorkflowRun }>;
}

export async function cancelWorkflowRun(
  type: string,
  name: string,
  id: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${wfBase(type, name)}/runs/${id}/cancel`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ ok: boolean }>;
}

/** workflow gates: approve or reject the gate the run waits at. */
export async function decideWorkflowGate(
  type: string,
  name: string,
  id: number,
  step: string,
  decision: "approve" | "reject",
  reason: string,
): Promise<{ run: WorkflowRun }> {
  const res = await fetch(`${wfBase(type, name)}/runs/${id}/gates/${encodeURIComponent(step)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: WorkflowRun }>;
}

/** workflow gates: continue a stopped run from the step it stopped at. */
export async function resumeWorkflowRun(
  type: string,
  name: string,
  id: number,
): Promise<{ run: WorkflowRun }> {
  const res = await fetch(`${wfBase(type, name)}/runs/${id}/resume`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: WorkflowRun }>;
}

export async function replayWorkflowRun(
  type: string,
  name: string,
  id: number,
): Promise<{ run: WorkflowRun }> {
  const res = await fetch(`${wfBase(type, name)}/runs/${id}/replay`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: WorkflowRun }>;
}

export async function listRunOutputs(
  type: string,
  name: string,
  runId: string,
): Promise<{ items: RunOutputItem[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/run-outputs?run_id=${encodeURIComponent(runId)}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: RunOutputItem[] }>;
}

export async function getRunOutputContent(type: string, name: string, id: number): Promise<string> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/run-outputs/${id}/content`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await parseError(res);
  return res.text();
}

// ---- Routines (routines-engine) ----
export type RoutineListItem = {
  routine_id: string;
  name: string | null;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  updated_at: string;
  updated_by: string;
};

export type RoutineRun = {
  id: number;
  routine_id: string;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  trigger: "schedule" | "manual";
  triggered_by: string;
  exit_code: number | null;
  timed_out: number;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type RoutineDetail = {
  routine_id: string;
  name: string | null;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  definition: unknown;
};

const rtBase = (type: string, name: string) =>
  `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/routines`;

export async function listRoutines(
  type: string,
  name: string,
): Promise<{ items: RoutineListItem[] }> {
  const res = await fetch(rtBase(type, name), { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: RoutineListItem[] }>;
}

export async function getRoutine(
  type: string,
  name: string,
  rt: string,
): Promise<{ routine: RoutineDetail }> {
  const res = await fetch(`${rtBase(type, name)}/${encodeURIComponent(rt)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ routine: RoutineDetail }>;
}

export async function putRoutine(
  type: string,
  name: string,
  rt: string,
  definition: unknown,
): Promise<{ routine_id: string; ok: boolean }> {
  const res = await fetch(`${rtBase(type, name)}/${encodeURIComponent(rt)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ definition }),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ routine_id: string; ok: boolean }>;
}

export async function runRoutineNow(
  type: string,
  name: string,
  rt: string,
): Promise<{ run: RoutineRun }> {
  const res = await fetch(`${rtBase(type, name)}/${encodeURIComponent(rt)}/run`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ run: RoutineRun }>;
}

export async function setRoutineEnabled(
  type: string,
  name: string,
  rt: string,
  enabled: boolean,
): Promise<{ routine_id: string; enabled: number }> {
  const res = await fetch(
    `${rtBase(type, name)}/${encodeURIComponent(rt)}/${enabled ? "enable" : "disable"}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ routine_id: string; enabled: number }>;
}

export async function listRoutineRuns(
  type: string,
  name: string,
): Promise<{ items: RoutineRun[] }> {
  const res = await fetch(`${rtBase(type, name)}/runs`, { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<{ items: RoutineRun[] }>;
}

export type HealthInfo = { orchestration_enabled?: boolean; version?: string };

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch("/api/v1/health", { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<HealthInfo>;
}

function journalParams(filters: JournalFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.action?.trim()) params.set("action", filters.action.trim());
  if (filters.actor?.trim()) params.set("actor", filters.actor.trim());
  return params;
}

/** One page of the admin audit journal; `after` is the `next` cursor of the previous page. */
export async function listJournal(filters: JournalFilters, after?: string): Promise<JournalPage> {
  const params = journalParams(filters);
  params.set("limit", "100");
  if (after) params.set("after", after);
  const res = await fetch(`/api/v1/admin/audit?${params.toString()}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as JournalPage;
}

/** Download link for the whole journal with the same filters, one JSON event per line. */
export function journalExportUrl(filters: JournalFilters): string {
  const params = journalParams(filters);
  params.set("format", "ndjson");
  return `/api/v1/admin/audit?${params.toString()}`;
}

/** Usage by consuming team and artifact over `days`, with the trend and unused artifacts (admin). */
export async function getExecutiveReport(
  days: number,
): Promise<import("./types.ts").ExecutiveReport> {
  const res = await fetch(`/api/v1/admin/report?days=${days}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").ExecutiveReport;
}

type RubricBody = { rubric: import("./types.ts").QualityRubric };

async function rubricRequest(
  path: string,
  method: "GET" | "PUT",
  body?: unknown,
): Promise<RubricBody> {
  const res = await fetch(path, {
    method,
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as RubricBody;
}

export const getCompanyRubric = () => rubricRequest("/api/v1/admin/quality-rubric", "GET");
export const putCompanyRubric = (r: import("./types.ts").QualityRubric) =>
  rubricRequest("/api/v1/admin/quality-rubric", "PUT", r);
export const getTeamRubric = (team: string) =>
  rubricRequest(`/api/v1/teams/${encodeURIComponent(team)}/quality-rubric`, "GET");
export const putTeamRubric = (team: string, r: import("./types.ts").QualityRubric) =>
  rubricRequest(`/api/v1/teams/${encodeURIComponent(team)}/quality-rubric`, "PUT", r);

/** What stands on people's machines across the organisation (admin). */
export async function getInventory(): Promise<import("./types.ts").OrganisationInventory> {
  const res = await fetch("/api/v1/admin/inventory");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as import("./types.ts").OrganisationInventory;
}

export async function listRollouts(): Promise<{
  items: import("./types.ts").Rollout[];
  configured: boolean;
}> {
  const res = await fetch("/api/v1/rollouts");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: import("./types.ts").Rollout[]; configured: boolean };
}

/** Opens a pull request in each repository; the result is per repository. */
export async function createRollout(body: {
  repos: string[];
  artifacts: Array<{ type: string; name: string }>;
}): Promise<{ rollout: import("./types.ts").Rollout }> {
  const res = await fetch("/api/v1/rollouts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { rollout: import("./types.ts").Rollout };
}

export async function listHarvests(): Promise<{ items: import("./types.ts").Harvest[] }> {
  const res = await fetch("/api/v1/harvests");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: import("./types.ts").Harvest[] };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

/** Reads review comments of a repository and keeps the rules that recur. */
export const createHarvest = (body: { source: "github"; repo: string; days: number }) =>
  postJson<{ harvest: import("./types.ts").Harvest }>("/api/v1/harvests", body);

/** Publishes the rules as a candidate rule (default) or skill; it goes to the usual review. */
export const draftFromHarvest = (id: number, name: string, type: "rule" | "skill" = "rule") =>
  postJson<{ version: string }>(`/api/v1/harvests/${id}/draft`, { name, type });

export async function listPacks(): Promise<{ items: import("./types.ts").PackSummary[] }> {
  const res = await fetch("/api/v1/packs");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { items: import("./types.ts").PackSummary[] };
}

export async function getPack(name: string): Promise<{
  pack: import("./types.ts").PackSummary;
  latest: import("./types.ts").PackVersion | null;
}> {
  const res = await fetch(`/api/v1/packs/${encodeURIComponent(name)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as {
    pack: import("./types.ts").PackSummary;
    latest: import("./types.ts").PackVersion | null;
  };
}

/** Layers of edits that apply to the caller, in the order the CLI applies them. */
export async function getOverlays(
  type: string,
  name: string,
): Promise<{ layers: import("./types.ts").OverlayLayer[] }> {
  const res = await fetch(
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/overlays`,
  );
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { layers: import("./types.ts").OverlayLayer[] };
}
