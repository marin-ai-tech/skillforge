import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ArtifactDetailResponse,
  ArtifactSummary,
  PluginsUiResponse,
  VersionDetail,
} from "../api/types.ts";
import {
  ApiError,
  getArtifact,
  getVersion,
  listVersions,
  getPluginsUi,
  getPluginTab,
  getHealth,
  runPluginAction,
} from "../api/client.ts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TypeChip } from "../components/TypeChip.tsx";
import { StatusChip } from "../components/StatusChip.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { NotFound } from "./NotFound.tsx";
import { Overview } from "./artifact/Overview.tsx";
import { Files } from "./artifact/Files.tsx";
import { Versions } from "./artifact/Versions.tsx";
import { Audit } from "./artifact/Audit.tsx";
import { Install } from "./artifact/Install.tsx";
import { Quality } from "./artifact/Quality.tsx";
import { Evidence } from "./artifact/Evidence.tsx";
import { Evals } from "./artifact/Evals.tsx";
import { Workflows } from "./artifact/Workflows.tsx";
import { Routines } from "./artifact/Routines.tsx";
import { Comments } from "./artifact/Comments.tsx";
import { STR } from "../lib/strings.ts";
import { errorText, formatDateTime } from "../i18n/index.ts";
import { shortDigest } from "../lib/format.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpButton } from "../components/HelpButton.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { LifecyclePanel } from "../components/LifecyclePanel.tsx";
import { OwnershipPanel } from "../components/OwnershipPanel.tsx";
import { ScopePanel } from "../components/ScopePanel.tsx";
import { LabelsPanel } from "../components/LabelsPanel.tsx";
import { SourcePanel } from "../components/SourcePanel.tsx";
import { MetadataPanel } from "../components/MetadataPanel.tsx";
import { PurgePanel } from "../components/PurgePanel.tsx";
import { useMe, roleAtLeast } from "../lib/auth.tsx";
import { getTeam, putWatch } from "../api/client.ts";

const TAB_IDS = [
  "overview",
  "files",
  "versions",
  "audit",
  "install",
  "quality",
  "evidence",
  "evals",
  "workflows",
  "routines",
  "comments",
] as const;

type ArtifactPermissions = {
  canEditLabels: boolean;
  canManageEvals: boolean;
  canEditMetadata: boolean;
  canEditScope: boolean;
  canManageSource: boolean;
};

type TeamMembers = NonNullable<Awaited<ReturnType<typeof getTeam>>["members"]>;

function isOwnerOf(artifact: ArtifactSummary, username: string | undefined): boolean {
  return !!username && !!artifact.owner && username.toLowerCase() === artifact.owner.toLowerCase();
}

function isMaintainerOf(artifact: ArtifactSummary, username: string | undefined): boolean {
  return (
    !!username &&
    (artifact.maintainers ?? []).some((u) => u.toLowerCase() === username.toLowerCase())
  );
}

function isTeamLead(
  members: TeamMembers | null | undefined,
  username: string | undefined,
): boolean {
  return (
    !!username &&
    !!members?.some((m) => m.username.toLowerCase() === username.toLowerCase() && m.role === "lead")
  );
}

/** What the viewer may edit on this artifact (labels, evals, metadata, scope, tracked source). */
function artifactPermissions({
  artifact,
  username,
  isAdmin,
  isReviewerPlus,
  meReady,
  teamMembers,
}: {
  artifact: ArtifactSummary;
  username: string | undefined;
  isAdmin: boolean;
  isReviewerPlus: boolean;
  meReady: boolean;
  teamMembers: TeamMembers | null | undefined;
}): ArtifactPermissions {
  const isOwner = isOwnerOf(artifact, username);
  const isMaintainer = isMaintainerOf(artifact, username);
  const canEditLabels = isAdmin || isReviewerPlus || isOwner || isMaintainer;
  const canManageEvals =
    meReady && artifact.type === "skill" && (isAdmin || isReviewerPlus || isOwner || isMaintainer);
  const canEditMetadata = canEditLabels && !artifact.purged_at;
  const isLead = isTeamLead(teamMembers, username);
  const canEditScope = isAdmin || isOwner || isLead;
  const canManageSource = isAdmin || isOwner || isMaintainer;
  return { canEditLabels, canManageEvals, canEditMetadata, canEditScope, canManageSource };
}

/** Version just published (passed via router state after Publish), if any. */
function publishedVersionFrom(state: unknown): string | null {
  return state && typeof state === "object" && state !== null && "published" in state
    ? String((state as { published: unknown }).published)
    : null;
}

function resolveTab(tabParam: string, extTabIds: Set<string>): string {
  return (TAB_IDS as readonly string[]).includes(tabParam) || extTabIds.has(tabParam)
    ? tabParam
    : "overview";
}

/** Who published the latest version (self-promotion-guard: the lifecycle panel limits promotion). */
function latestAuthorOf(data: ArtifactDetailResponse): string | null {
  return data.latest?.published_by ?? null;
}

function pickSelectedVersion(
  versionParam: string | null,
  data: ArtifactDetailResponse | undefined,
): string {
  return versionParam || data?.artifact.latest_version || data?.latest?.version || "";
}

/** Stable/beta heads and whether the beta head is worth a badge. */
function channelHeads(detailData: ArtifactDetailResponse) {
  const artifact = detailData.artifact;
  const stableHead = detailData.channels?.stable ?? null;
  const betaHead = detailData.channels?.beta ?? null;
  const betaOnly = artifact.latest_channel === "beta";
  const versionOrder = detailData.versions.map((v) => v.version);
  const betaNewer =
    !!betaHead &&
    !!stableHead &&
    versionOrder.indexOf(betaHead.version) < versionOrder.indexOf(stableHead.version);
  return { stableHead, betaHead, betaOnly, betaNewer };
}

type ExtTab = PluginsUiResponse["artifact_tabs"][number];

function buildArtifactTabs({
  canManageEvals,
  orchestrationEnabled,
  commentsCount,
  extTabs,
}: {
  canManageEvals: boolean;
  orchestrationEnabled: boolean;
  commentsCount: ArtifactSummary["comments_count"];
  extTabs: ExtTab[];
}) {
  return [
    { id: "overview", label: STR.detail.overview, testId: "tab-overview" },
    { id: "files", label: STR.detail.files, testId: "tab-files" },
    { id: "versions", label: STR.detail.versions, testId: "tab-versions" },
    { id: "audit", label: STR.detail.audit, testId: "tab-audit" },
    { id: "install", label: STR.detail.install, testId: "tab-install" },
    { id: "quality", label: STR.detail.quality, testId: "tab-quality" },
    { id: "evidence", label: STR.detail.evidence, testId: "tab-evidence" },
    ...(canManageEvals
      ? [
          { id: "evals", label: STR.detail.evals, testId: "tab-evals" },
          ...(orchestrationEnabled
            ? [
                { id: "workflows", label: STR.detail.workflows, testId: "tab-workflows" },
                { id: "routines", label: STR.detail.routines, testId: "tab-routines" },
              ]
            : []),
        ]
      : []),
    {
      id: "comments",
      label:
        commentsCount != null ? STR.art.page.commentsCount(commentsCount) : STR.art.page.comments,
      testId: "tab-comments",
    },
    ...extTabs.map((t) => ({
      id: `ext-${t.plugin}-${t.id}`,
      label: t.label,
      content: true,
      testId: `tab-ext-${t.plugin}-${t.id}`,
    })),
  ];
}

function ArtifactTitle({ artifact }: { artifact: ArtifactSummary }) {
  return (
    <h1 data-testid="detail-name" translate="no" className="text-xl font-semibold">
      {artifact.display_name || artifact.name}
      {artifact.display_name ? (
        <span className="ml-2 text-base font-normal text-muted">{artifact.name}</span>
      ) : null}
    </h1>
  );
}

type TabCtx = {
  tab: string;
  type: string;
  name: string;
  artifact: ArtifactSummary;
  detailData: ArtifactDetailResponse;
  version: VersionDetail | undefined;
  versionQ: UseQueryResult<VersionDetail>;
  versionsQ: UseQueryResult<{ items: VersionDetail[] }>;
  isAdmin: boolean;
  setQuery: (patch: Record<string, string | null>) => void;
  meReady: boolean;
  canManageEvals: boolean;
  orchestrationEnabled: boolean;
  selectedVersion: string;
  extTabs: ExtTab[];
  extTabIds: Set<string>;
};

function PublishSuccess({
  showPublished,
  published,
  onDismiss,
}: {
  showPublished: boolean;
  published: string | null;
  onDismiss: () => void;
}) {
  return showPublished && published ? (
    <div
      data-testid="publish-success"
      className="flex items-center justify-between gap-3 rounded-sf border border-line bg-accent-soft px-4 py-3 text-sm"
    >
      <span>
        {STR.publish.success}: <span className="font-mono">{published}</span>
      </span>
      <button
        type="button"
        className="rounded-sf border border-line px-2 py-0.5 text-xs"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  ) : null;
}

function PurgedNotice({ artifact, isAdmin }: { artifact: ArtifactSummary; isAdmin: boolean }) {
  return artifact.purged_at && isAdmin ? (
    <div
      data-testid="artifact-purged"
      className="rounded-sf border border-danger p-2 text-sm text-danger"
    >
      {STR.art.page.purgedNotice(formatDateTime(artifact.purged_at))}{" "}
      {artifact.purged_by ? (
        <span translate="no">{artifact.purged_by}</span>
      ) : (
        STR.art.page.purgedByAdmin
      )}
    </div>
  ) : null;
}

/** Latest stable head and, when relevant, a beta head (beta-only or newer than stable). */
function ChannelBadges({ detailData }: { detailData: ArtifactDetailResponse }) {
  const { stableHead, betaHead, betaOnly, betaNewer } = channelHeads(detailData);
  return (
    <>
      {stableHead ? (
        <span
          data-testid="artifact-latest-stable"
          title={STR.art.page.latestStable}
          className="rounded-sf bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2"
        >
          stable {stableHead.version}
        </span>
      ) : null}
      {betaHead && (betaOnly || betaNewer) ? (
        <span
          data-testid="artifact-beta"
          title={betaOnly ? STR.art.page.betaOnly : STR.art.page.betaNewer}
          className="rounded-sf bg-warning-bg px-1.5 py-0.5 font-mono text-xs text-warning"
        >
          beta {betaHead.version}
        </span>
      ) : null}
    </>
  );
}

function WatchControls({
  username,
  viewer,
  pending,
  onToggle,
  watchError,
}: {
  username: string | undefined;
  viewer: ArtifactDetailResponse["viewer"];
  pending: boolean;
  onToggle: (watching: boolean) => void;
  watchError: string | null;
}) {
  return (
    <>
      {username ? (
        <HelpTip action="watch-toggle">
          <button
            type="button"
            data-testid="watch-toggle"
            className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
            disabled={pending}
            onClick={() => onToggle(!(viewer?.watching ?? false))}
          >
            {viewer?.watching ? STR.art.page.watching : STR.art.page.watch}
          </button>
        </HelpTip>
      ) : null}
      {watchError ? (
        <span data-testid="watch-error" className="text-xs text-danger">
          {watchError}
        </span>
      ) : null}
    </>
  );
}

function DigestChip({ version }: { version: VersionDetail | undefined }) {
  return version ? (
    <HelpTip action="meta-digest">
      <span data-testid="meta-digest" className="font-mono text-sm text-muted">
        {shortDigest(version.digest)}
      </span>
    </HelpTip>
  ) : null;
}

/** Visibility/labels line and the ownership, source, scope, labels, metadata and purge panels. */
function GovernancePanels({
  artifact,
  type,
  name,
  isAdmin,
  perms,
}: {
  artifact: ArtifactSummary;
  type: string;
  name: string;
  isAdmin: boolean;
  perms: ArtifactPermissions;
}) {
  const { canEditScope, canEditLabels, canEditMetadata, canManageSource } = perms;
  const visibilityLabel =
    artifact.visibility === "team" ? `team · ${artifact.owner_team ?? "?"}` : "org";
  const labelsText = (artifact.labels ?? []).length ? (artifact.labels ?? []).join(", ") : "—";
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">{STR.art.page.visibility}</span>
        <span data-testid="artifact-visibility" className="font-mono font-medium text-ink">
          {visibilityLabel}
        </span>
        <span className="text-muted">{STR.art.page.labels}</span>
        <span data-testid="artifact-labels" className="font-mono text-ink-2">
          {labelsText}
        </span>
      </div>
      <OwnershipPanel artifact={artifact} />
      <SourcePanel type={type} name={name} canManage={canManageSource} />
      <ScopePanel artifact={artifact} canEdit={canEditScope} />
      <LabelsPanel artifact={artifact} canEdit={canEditLabels} />
      {canEditMetadata ? <MetadataPanel artifact={artifact} /> : null}
      {isAdmin ? (
        <PurgePanel type={type} name={name} version={null} hideTrigger={!!artifact.purged_at} />
      ) : null}
    </>
  );
}

function VersionSelect({
  selectedVersion,
  items,
  fallback,
  onSelect,
}: {
  selectedVersion: string;
  items: VersionDetail[] | undefined;
  fallback: ArtifactDetailResponse["versions"];
  onSelect: (version: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {STR.detail.version}
      <HelpTip action="version-select">
        <select
          data-testid="version-select"
          className="rounded-sf border border-line bg-bg px-2 py-1 font-mono text-sm text-ink"
          value={selectedVersion}
          onChange={(e) => onSelect(e.target.value)}
        >
          {(items ?? fallback)
            .filter((v) => !v.purged)
            .map((v) => (
              <option key={v.version} value={v.version}>
                {v.version}
              </option>
            ))}
        </select>
      </HelpTip>
    </label>
  );
}

/** A tab showing the selected version's content: purged notice, error, loading, or the content. */
function VersionTab({
  versionQ,
  version,
  render,
}: {
  versionQ: UseQueryResult<VersionDetail>;
  version: VersionDetail | undefined;
  render: (version: VersionDetail) => ReactNode;
}) {
  return versionQ.isError && versionQ.error instanceof ApiError && versionQ.error.status === 410 ? (
    <p data-testid="version-purged-message" className="rounded-sf border border-line p-4">
      {STR.art.page.versionPurged}
    </p>
  ) : versionQ.isError ? (
    <ErrorState onRetry={() => void versionQ.refetch()} />
  ) : versionQ.isLoading || !version ? (
    <Skeleton className="h-40" />
  ) : (
    render(version)
  );
}

/** A tab for owners, maintainers and reviewers only (evals, workflows, routines). */
function ManagedTab({
  meReady,
  canManage,
  forbiddenTestId,
  forbiddenText,
  children,
}: {
  meReady: boolean;
  canManage: boolean;
  forbiddenTestId: string;
  forbiddenText: string;
  children: ReactNode;
}) {
  return !meReady ? (
    <Skeleton className="h-40" />
  ) : canManage ? (
    children
  ) : (
    <p className="text-sm text-muted" data-testid={forbiddenTestId}>
      {forbiddenText}
    </p>
  );
}

function VersionsTab({ ctx }: { ctx: TabCtx }) {
  const { type, name, versionsQ, isAdmin, setQuery } = ctx;
  return versionsQ.isError ? (
    <ErrorState onRetry={() => void versionsQ.refetch()} />
  ) : versionsQ.isLoading || !versionsQ.data ? (
    <Skeleton className="h-40" />
  ) : (
    <Versions
      type={type}
      name={name}
      versions={versionsQ.data.items}
      onSelect={(v) => setQuery({ version: v })}
      isAdmin={isAdmin}
    />
  );
}

/** Built-in content tabs: overview, files, versions, audit, install, quality, evidence. */
function CoreTabContent({ ctx }: { ctx: TabCtx }) {
  const { tab, type, name, artifact, detailData, version, versionQ } = ctx;
  return (
    <>
      {tab === "overview" ? (
        <VersionTab
          versionQ={versionQ}
          version={version}
          render={(v) => <Overview artifact={artifact} version={v} />}
        />
      ) : null}
      {tab === "files" ? (
        <VersionTab
          versionQ={versionQ}
          version={version}
          render={(v) => <Files artifact={artifact} version={v} />}
        />
      ) : null}
      {tab === "versions" ? <VersionsTab ctx={ctx} /> : null}
      {tab === "audit" ? <Audit type={type} name={name} /> : null}
      {tab === "install" ? <Install detail={detailData} /> : null}
      {tab === "quality" ? (
        <VersionTab
          versionQ={versionQ}
          version={version}
          render={(v) => <Quality artifact={artifact} version={v} />}
        />
      ) : null}
      {tab === "evidence" ? (
        <VersionTab
          versionQ={versionQ}
          version={version}
          render={(v) => <Evidence type={type} name={name} artifact={artifact} version={v} />}
        />
      ) : null}
    </>
  );
}

/** Managed tabs (evals, workflows, routines), comments and plugin-provided tabs. */
function ExtraTabContent({ ctx }: { ctx: TabCtx }) {
  const {
    tab,
    type,
    name,
    detailData,
    versionsQ,
    isAdmin,
    meReady,
    canManageEvals,
    orchestrationEnabled,
    selectedVersion,
    extTabs,
    extTabIds,
  } = ctx;
  return (
    <>
      {tab === "evals" ? (
        <ManagedTab
          meReady={meReady}
          canManage={canManageEvals}
          forbiddenTestId="evals-forbidden"
          forbiddenText={STR.art.page.evalsForbidden}
        >
          <Evals
            type={type}
            name={name}
            versions={versionsQ.data?.items ?? []}
            canManage={canManageEvals}
          />
        </ManagedTab>
      ) : null}
      {tab === "workflows" && orchestrationEnabled ? (
        <ManagedTab
          meReady={meReady}
          canManage={canManageEvals}
          forbiddenTestId="workflows-forbidden"
          forbiddenText={STR.art.page.workflowsForbidden}
        >
          <Workflows type={type} name={name} canManage={canManageEvals} isAdmin={isAdmin} />
        </ManagedTab>
      ) : null}
      {tab === "routines" && orchestrationEnabled ? (
        <ManagedTab
          meReady={meReady}
          canManage={canManageEvals}
          forbiddenTestId="routines-forbidden"
          forbiddenText={STR.art.page.routinesForbidden}
        >
          <Routines type={type} name={name} canManage={canManageEvals} isAdmin={isAdmin} />
        </ManagedTab>
      ) : null}
      {tab === "comments" ? (
        <Comments
          type={type}
          name={name}
          versions={(versionsQ.data?.items ?? detailData.versions).map((v) => v.version)}
          selectedVersion={selectedVersion}
        />
      ) : null}
      {extTabIds.has(tab) ? (
        <ExtTabBody
          meta={extTabs.find((t) => `ext-${t.plugin}-${t.id}` === tab)!}
          type={type}
          name={name}
        />
      ) : null}
    </>
  );
}

function ArtifactTabContent({ ctx }: { ctx: TabCtx }) {
  return (
    <div>
      <CoreTabContent ctx={ctx} />
      <ExtraTabContent ctx={ctx} />
    </div>
  );
}

/** Plugin-provided artifact tabs and whether orchestration tabs are enabled on the server. */
function usePluginTabs() {
  const pluginsUiQ = useQuery({
    queryKey: ["plugins-ui"],
    queryFn: getPluginsUi,
    staleTime: 60_000,
  });
  const healthQ = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    staleTime: 60_000,
  });
  const orchestrationEnabled = healthQ.data?.orchestration_enabled === true;
  const extTabs = pluginsUiQ.data?.artifact_tabs ?? [];
  return { orchestrationEnabled, extTabs };
}

function useViewerRoles() {
  const me = useMe();
  const username = me.data?.username;
  const isAdmin = roleAtLeast(me.data?.role, "admin");
  const isReviewerPlus = roleAtLeast(me.data?.role, "reviewer");
  return { me, username, isAdmin, isReviewerPlus };
}

/** Artifact detail failed (404 → NotFound) or is still loading. */
function ArtifactUnavailable({
  detail,
  name,
}: {
  detail: UseQueryResult<ArtifactDetailResponse>;
  name: string;
}) {
  if (detail.isError) {
    const err = detail.error;
    if (err instanceof ApiError && err.status === 404) {
      return <NotFound name={name} />;
    }
    return (
      <div className="space-y-4">
        <PageHeader title={name || STR.art.page.fallbackTitle} topic="pages/artifact" />
        <ErrorState onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title={name || STR.art.page.fallbackTitle} topic="pages/artifact" />
      <Skeleton className="h-48" />
    </div>
  );
}

export function Artifact() {
  const { type = "", name = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const published = publishedVersionFrom(location.state);
  const [showPublished, setShowPublished] = useState(!!published);
  const tabParam = params.get("tab") ?? "overview";
  const { orchestrationEnabled, extTabs } = usePluginTabs();
  const extTabIds = new Set(extTabs.map((t) => `ext-${t.plugin}-${t.id}`));
  const tab = resolveTab(tabParam, extTabIds);
  const versionParam = params.get("version");

  const { me, username, isAdmin, isReviewerPlus } = useViewerRoles();
  const queryClient = useQueryClient();
  const [watchError, setWatchError] = useState<string | null>(null);
  const watchMut = useMutation({
    mutationFn: (watching: boolean) => putWatch(type, name, watching),
    onSuccess: async () => {
      setWatchError(null);
      await queryClient.invalidateQueries({ queryKey: ["artifact", type, name] });
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.error : "request_failed";
      setWatchError(
        code === "mcp_token_forbidden"
          ? STR.art.page.watchMcpForbidden
          : code === "not_found"
            ? STR.art.page.watchNotFound
            : STR.art.page.watchFailed(code),
      );
    },
  });

  const detail = useQuery({
    queryKey: ["artifact", type, name],
    queryFn: () => getArtifact(type, name),
    staleTime: 30_000,
    retry: false,
  });

  const ownerTeam = detail.data?.artifact.owner_team ?? null;
  const teamDetailQ = useQuery({
    queryKey: ["team", ownerTeam],
    queryFn: () => getTeam(ownerTeam!),
    enabled: !!me.data && !!ownerTeam,
    staleTime: 30_000,
    retry: false,
  });

  const versionsQ = useQuery({
    queryKey: ["versions", type, name],
    queryFn: () => listVersions(type, name),
    enabled: !!detail.data,
    staleTime: 30_000,
  });

  const selectedVersion = pickSelectedVersion(versionParam, detail.data);

  const versionQ = useQuery({
    queryKey: ["version", type, name, selectedVersion],
    queryFn: () => getVersion(type, name, selectedVersion),
    enabled: !!detail.data && !!selectedVersion,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (name) document.title = `${name} · SkillForge`;
  }, [name]);

  function setQuery(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    setParams(sp);
  }

  if (detail.isError || detail.isLoading || !detail.data) {
    return <ArtifactUnavailable detail={detail} name={name} />;
  }

  const { artifact } = detail.data;
  const version = versionQ.data;
  const meReady = !me.isLoading;
  const perms = artifactPermissions({
    artifact,
    username,
    isAdmin,
    isReviewerPlus,
    meReady,
    teamMembers: teamDetailQ.data?.members,
  });
  const { canManageEvals } = perms;

  return (
    <div className="space-y-4">
      <PublishSuccess
        showPublished={showPublished}
        published={published}
        onDismiss={() => {
          setShowPublished(false);
          navigate(".", { replace: true, state: null });
        }}
      />
      <header className="space-y-3 rounded-sf border border-line bg-surface p-4">
        <PurgedNotice artifact={artifact} isAdmin={isAdmin} />
        <div className="flex flex-wrap items-center gap-2">
          <ArtifactTitle artifact={artifact} />
          <span data-testid="detail-type">
            <TypeChip type={artifact.type} />
          </span>
          <span data-testid="detail-status">
            <StatusChip status={artifact.status} />
          </span>
          <span data-testid="detail-version" className="font-mono text-sm">
            {selectedVersion}
          </span>
          <ChannelBadges detailData={detail.data} />
          <HelpButton topic="pages/artifact" />
          <WatchControls
            username={username}
            viewer={detail.data.viewer}
            pending={watchMut.isPending}
            onToggle={(watching) => watchMut.mutate(watching)}
            watchError={watchError}
          />
          <DigestChip version={version} />
        </div>
        <p data-testid="detail-description" translate="no" className="text-sm text-ink-2">
          {artifact.description}
        </p>
        <GovernancePanels
          artifact={artifact}
          type={type}
          name={name}
          isAdmin={isAdmin}
          perms={perms}
        />
        <VersionSelect
          selectedVersion={selectedVersion}
          items={versionsQ.data?.items}
          fallback={detail.data.versions}
          onSelect={(v) => setQuery({ version: v })}
        />
      </header>

      <LifecyclePanel
        artifact={artifact}
        allowedTransitions={detail.data.allowed_transitions ?? []}
        latestAuthor={latestAuthorOf(detail.data)}
      />

      <Tabs
        tabs={buildArtifactTabs({
          canManageEvals,
          orchestrationEnabled,
          commentsCount: artifact.comments_count,
          extTabs,
        })}
        active={tab}
        onChange={(id) => setQuery({ tab: id === "overview" ? null : id })}
      />

      <ArtifactTabContent
        ctx={{
          tab,
          type,
          name,
          artifact,
          detailData: detail.data,
          version,
          versionQ,
          versionsQ,
          isAdmin,
          setQuery,
          meReady,
          canManageEvals,
          orchestrationEnabled,
          selectedVersion,
          extTabs,
          extTabIds,
        }}
      />
    </div>
  );
}

function ExtTabBody({
  meta,
  type,
  name,
}: {
  meta: { plugin: string; id: string; label: string };
  type: string;
  name: string;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshMs, setRefreshMs] = useState<number | false>(false);
  const q = useQuery({
    queryKey: ["plugin-tab", meta.plugin, meta.id, type, name],
    queryFn: () => getPluginTab(meta.plugin, meta.id, type, name),
    retry: false,
    refetchInterval: refreshMs,
  });
  useEffect(() => {
    const ms = q.data?.refresh_ms;
    setRefreshMs(typeof ms === "number" && ms >= 1000 ? ms : false);
  }, [q.data?.refresh_ms]);

  const clickAction = async (action: {
    id: string;
    label: string;
    path: string;
    body?: Record<string, unknown>;
    confirm?: string;
  }) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setErrors((prev) => ({ ...prev, [action.id]: "" }));
    try {
      await runPluginAction(meta.plugin, action.path, action.body);
      setErrors((prev) => ({ ...prev, [action.id]: "" }));
      void q.refetch();
    } catch (e) {
      const msg = errorText(e);
      setErrors((prev) => ({ ...prev, [action.id]: msg }));
    }
  };

  if (q.isError) {
    return <ErrorState onRetry={() => void q.refetch()} />;
  }
  if (q.isLoading || !q.data) {
    return <Skeleton className="h-40" />;
  }

  const topActions = q.data.actions ?? [];
  const sections = q.data.sections ?? [];

  const renderActions = (
    actions: Array<{
      id: string;
      label: string;
      path: string;
      body?: Record<string, unknown>;
      confirm?: string;
    }>,
  ) => (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <span key={a.id} className="inline-flex flex-col items-start gap-1">
          <button
            type="button"
            id={`ext-action-${a.id}`}
            data-testid={`ext-action-${a.id}`}
            translate="no"
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
            onClick={() => void clickAction(a)}
          >
            {a.label}
          </button>
          {errors[a.id] ? (
            <span className="ext-action-error text-xs text-red-600">{errors[a.id]}</span>
          ) : null}
        </span>
      ))}
    </div>
  );

  return (
    <div data-testid="ext-tab-content" className="space-y-3 text-sm leading-relaxed">
      <div className="prose-sf" translate="no">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {q.data.markdown}
        </ReactMarkdown>
      </div>
      {topActions.length > 0 ? <div className="pt-1">{renderActions(topActions)}</div> : null}
      {sections.map((s) => (
        <div key={s.id} className="ext-section" data-section={s.id} data-testid="ext-section">
          <div className="prose-sf" translate="no">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
              {s.markdown}
            </ReactMarkdown>
          </div>
          {s.actions && s.actions.length > 0 ? (
            <div className="pt-1">{renderActions(s.actions)}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
