import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  batchTransitions,
  getBoard,
  getInstallInfo,
  installStarterPack,
  listStarterPacks,
  type StarterPackSummary,
} from "../api/client.ts";
import type { ArtifactSummary, LifecycleBoard } from "../api/types.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorState } from "../components/ErrorState.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { RequireUser } from "../components/RequireUser.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import type { MeUser } from "../api/client.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { Button } from "../components/Button.tsx";

type StepStatus = "done" | "todo" | "blocked";
type StepId = "signed_in" | "starter_installed" | "candidates_promoted" | "connect_ready";

type ChecklistStep = {
  id: StepId;
  label: string;
  hint: string;
  status: StepStatus;
};

function stepStatus(ok: boolean, blocked: boolean): StepStatus {
  if (blocked) return "blocked";
  return ok ? "done" : "todo";
}

function starterHint(isAdmin: boolean, starterOk: boolean): string {
  if (!isAdmin) {
    return starterOk ? STR.ws.start.starterRegistryHas : STR.ws.start.starterAskAdmin;
  }
  return starterOk ? STR.ws.start.starterPresent : STR.ws.start.starterInstallBelow;
}

function buildChecklist(input: {
  user: MeUser | null | undefined;
  isReviewer: boolean;
  isAdmin: boolean;
  anyPackInstalled: boolean;
  batchDone: boolean;
  board: LifecycleBoard | undefined;
  candidateCount: number;
  marketplaceUrl: string | undefined;
}): ChecklistStep[] {
  const signedOk = Boolean(input.user && input.isReviewer);
  const starterOk = input.anyPackInstalled;
  const promotedOk =
    input.batchDone || Boolean(input.isReviewer && input.board && input.candidateCount === 0);
  const connectOk = Boolean(input.marketplaceUrl);
  const gate = !signedOk;
  const promotedHint =
    input.candidateCount === 0
      ? STR.ws.start.promotedNone
      : STR.ws.start.promotedReady(input.candidateCount);

  return [
    {
      id: "signed_in",
      label: STR.ws.start.signedInLabel,
      hint: signedOk ? STR.ws.start.signedInOk : STR.ws.start.signedInTodo,
      status: stepStatus(signedOk, false),
    },
    {
      id: "starter_installed",
      label: STR.ws.start.starterLabel,
      hint: starterHint(input.isAdmin, starterOk),
      status: stepStatus(starterOk, gate),
    },
    {
      id: "candidates_promoted",
      label: STR.ws.start.promotedLabel,
      hint: promotedHint,
      status: stepStatus(promotedOk, gate),
    },
    {
      id: "connect_ready",
      label: STR.ws.start.connectLabel,
      hint: connectOk ? STR.ws.start.connectOk : STR.ws.start.connectWaiting,
      status: stepStatus(connectOk, false),
    },
  ];
}

function ChecklistSection({ steps }: { steps: ChecklistStep[] }) {
  return (
    <section data-testid="start-checklist" className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.ws.start.checklistTitle}
      </h2>
      <ul className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.id}
            data-testid={`checklist-step-${step.id}`}
            data-status={step.status}
            className="rounded-sf border border-line bg-surface px-4 py-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs uppercase text-muted">
                {STR.ws.start.stepStatus[step.status]}
              </span>
              <span className="font-medium text-ink">{step.label}</span>
              <span className="text-xs text-muted" translate="no">
                ({step.id})
              </span>
            </div>
            <p className="mt-1 text-ink-2">{step.hint}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StarterPacksSection({
  isAdmin,
  packs,
  loading,
  errored,
  onRetry,
  onInstall,
  pending,
  message,
}: {
  isAdmin: boolean;
  packs: StarterPackSummary[] | undefined;
  loading: boolean;
  errored: boolean;
  onRetry: () => void;
  onInstall: (id: string) => void;
  pending: boolean;
  message: string | null;
}) {
  let body;
  if (!isAdmin) {
    body = <EmptyState title={STR.ws.start.adminRequired} hint={STR.ws.start.adminRequiredHint} />;
  } else if (errored) {
    body = <ErrorState onRetry={onRetry} />;
  } else if (loading) {
    body = <Skeleton className="h-24" />;
  } else if (!packs || packs.length === 0) {
    body = <EmptyState title={STR.ws.start.noPacks} />;
  } else {
    body = (
      <ul className="space-y-2">
        {packs.map((pack) => (
          <li
            key={pack.id}
            data-testid={`starter-pack-${pack.id}`}
            className="flex flex-wrap items-center gap-3 rounded-sf border border-line bg-surface px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink" translate="no">
                {pack.title}
              </div>
              <div className="text-xs text-muted">
                <span translate="no">{pack.id}</span> ·{" "}
                {STR.ws.start.installedOf(pack.installed, pack.artifacts)}
              </div>
              {pack.description ? (
                <p className="mt-1 text-ink-2" translate="no">
                  {pack.description}
                </p>
              ) : null}
            </div>
            <HelpTip action="start-install-pack">
              <Button
                type="button"
                data-testid={`install-starter-pack-${pack.id}`}
                className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                pending={pending}
                onClick={() => onInstall(pack.id)}
              >
                {STR.ws.start.install}
              </Button>
            </HelpTip>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section data-testid="start-starter-packs" className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.ws.start.packsTitle}
      </h2>
      {body}
      {message ? (
        <p data-testid="start-install-result" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function BatchPromoteSection({
  candidates,
  loading,
  errored,
  onRetry,
  reason,
  onReason,
  onOpenConfirm,
  pending,
  message,
}: {
  candidates: ArtifactSummary[];
  loading: boolean;
  errored: boolean;
  onRetry: () => void;
  reason: string;
  onReason: (v: string) => void;
  onOpenConfirm: () => void;
  pending: boolean;
  message: string | null;
}) {
  let body;
  if (errored) {
    body = <ErrorState onRetry={onRetry} />;
  } else if (loading) {
    body = <Skeleton className="h-20" />;
  } else if (candidates.length === 0) {
    body = <EmptyState title={STR.ws.start.noCandidates} />;
  } else {
    body = (
      <>
        <p className="text-sm text-ink-2">{STR.ws.start.willMove(candidates.length)}</p>
        <label className="block text-sm text-ink-2">
          {STR.ws.start.optionalReason}
          <input
            data-testid="batch-promote-reason"
            type="text"
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            className="mt-1 w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm text-ink"
            maxLength={500}
          />
        </label>
        <HelpTip action="start-batch-promote">
          <Button
            type="button"
            data-testid="batch-promote-all"
            className="rounded-sf border border-line px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
            pending={pending}
            onClick={onOpenConfirm}
          >
            {STR.ws.start.promoteAll}
          </Button>
        </HelpTip>
      </>
    );
  }

  return (
    <section data-testid="start-batch-promote" className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.ws.start.batchTitle}
      </h2>
      {body}
      {message ? (
        <p data-testid="start-batch-result" className="text-sm text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function ConnectSection({
  command,
  loading,
  errored,
  onRetry,
}: {
  command: string;
  loading: boolean;
  errored: boolean;
  onRetry: () => void;
}) {
  let body;
  if (errored) {
    body = <ErrorState onRetry={onRetry} />;
  } else if (loading || !command) {
    body = <Skeleton className="h-16" />;
  } else {
    body = (
      <HelpTip action="start-copy-connect">
        <div className="flex flex-wrap items-center gap-2 rounded-sf border border-line bg-surface p-4 text-sm">
          <code className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs">
            {command}
          </code>
          <CopyButton value={command} />
        </div>
      </HelpTip>
    );
  }

  return (
    <section data-testid="start-connect" className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.ws.start.connectTitle}
      </h2>
      {body}
    </section>
  );
}

function marketplaceCommand(url: string | undefined): string {
  return url ? `/plugin marketplace add ${url}` : "";
}

function formatApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return `${fallback}: ${errorText(err)}`;
  return fallback;
}

function summarizeInstall(results: Array<{ status: "created" | "exists" | "failed" }>): string {
  const created = results.filter((r) => r.status === "created").length;
  const exists = results.filter((r) => r.status === "exists").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return STR.ws.start.installFinished(created, exists, failed);
}

function deriveStartFlags(input: {
  user: MeUser | null | undefined;
  board: LifecycleBoard | undefined;
  packs: StarterPackSummary[] | undefined;
  review: ArtifactSummary[];
}) {
  const isReviewer = roleAtLeast(input.user?.role, "reviewer");
  const isAdmin = input.user?.role === "admin";
  const candidateCount = input.board?.counts.candidate ?? input.review.length;
  const packInstalledCount = input.packs?.some((p) => p.installed > 0) ?? false;
  const boardHasArtifacts = Boolean(
    input.board && input.board.counts.active + input.board.counts.candidate > 0,
  );
  return {
    isReviewer,
    isAdmin,
    candidateCount,
    anyPackInstalled: packInstalledCount || boardHasArtifacts,
    allowed: Boolean(input.user && isReviewer),
  };
}

function StartBody() {
  const me = useMe();
  const user = me.data;
  const queryClient = useQueryClient();
  const previewFlags = deriveStartFlags({
    user,
    board: undefined,
    packs: undefined,
    review: [],
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchReason, setBatchReason] = useState("");
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [batchDone, setBatchDone] = useState(false);

  useEffect(() => {
    document.title = STR.ws.start.docTitle;
  }, []);

  const board = useQuery({
    queryKey: ["board"],
    queryFn: getBoard,
    staleTime: 15_000,
    enabled: previewFlags.isReviewer,
  });

  const packs = useQuery({
    queryKey: ["starter-packs"],
    queryFn: listStarterPacks,
    staleTime: 30_000,
    enabled: previewFlags.isAdmin,
  });

  const installInfo = useQuery({
    queryKey: ["install-info"],
    queryFn: getInstallInfo,
    staleTime: 60_000,
  });

  const candidates = board.data?.review ?? [];
  const { isReviewer, isAdmin, candidateCount, anyPackInstalled, allowed } = deriveStartFlags({
    user,
    board: board.data,
    packs: packs.data?.items,
    review: candidates,
  });

  const checklist = useMemo(
    () =>
      buildChecklist({
        user,
        isReviewer,
        isAdmin,
        anyPackInstalled,
        batchDone,
        board: board.data,
        candidateCount,
        marketplaceUrl: installInfo.data?.marketplace_url,
      }),
    [
      user,
      isReviewer,
      isAdmin,
      anyPackInstalled,
      batchDone,
      board.data,
      candidateCount,
      installInfo.data?.marketplace_url,
    ],
  );

  const installMut = useMutation({
    mutationFn: (id: string) => installStarterPack(id),
    onSuccess: async (res) => {
      setInstallMsg(summarizeInstall(res.results));
      setBatchDone(false);
      await queryClient.invalidateQueries({ queryKey: ["starter-packs"] });
      await queryClient.invalidateQueries({ queryKey: ["board"] });
      await queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    },
    onError: (err: unknown) => {
      setInstallMsg(formatApiError(err, STR.ws.start.installFailed));
    },
  });

  const batchMut = useMutation({
    mutationFn: () =>
      batchTransitions({
        items: candidates.map((c) => ({ type: c.type, name: c.name, to: "active" })),
        reason: batchReason.trim() || undefined,
      }),
    onSuccess: async (res) => {
      const ok = res.results.filter((r) => r.ok).length;
      const bad = res.results.filter((r) => !r.ok).length;
      setBatchMsg(STR.ws.start.batchResult(ok, bad));
      setConfirmOpen(false);
      setBatchDone(ok > 0 && bad === 0);
      await queryClient.invalidateQueries({ queryKey: ["board"] });
      await queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      await queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
    onError: (err: unknown) => {
      setBatchMsg(formatApiError(err, STR.ws.start.batchFailed));
      setConfirmOpen(false);
    },
  });

  if (!allowed) {
    return (
      <div
        data-testid="start-forbidden"
        className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
      >
        {STR.ws.start.forbidden}
      </div>
    );
  }

  const marketplaceCmd = marketplaceCommand(installInfo.data?.marketplace_url);

  return (
    <div className="space-y-8">
      <PageHeader
        title={STR.ws.start.title}
        description={STR.ws.start.description}
        topic="pages/start"
      />
      <ChecklistSection steps={checklist} />
      <StarterPacksSection
        isAdmin={isAdmin}
        packs={packs.data?.items}
        loading={packs.isLoading}
        errored={packs.isError}
        onRetry={() => void packs.refetch()}
        onInstall={(id) => {
          setInstallMsg(null);
          installMut.mutate(id);
        }}
        pending={installMut.isPending}
        message={installMsg}
      />
      <BatchPromoteSection
        candidates={candidates}
        loading={board.isLoading}
        errored={board.isError}
        onRetry={() => void board.refetch()}
        reason={batchReason}
        onReason={setBatchReason}
        onOpenConfirm={() => setConfirmOpen(true)}
        pending={batchMut.isPending}
        message={batchMsg}
      />
      <ConnectSection
        command={marketplaceCmd}
        loading={installInfo.isLoading}
        errored={installInfo.isError}
        onRetry={() => void installInfo.refetch()}
      />
      <ConfirmDialog
        open={confirmOpen}
        title={STR.ws.start.confirmTitle}
        body={STR.ws.start.confirmBody(candidates.length)}
        helpText={STR.ws.start.confirmHelp}
        helpTopic="pages/start"
        confirmLabel={STR.ws.start.confirmLabel}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => batchMut.mutate()}
      />
    </div>
  );
}

export function Start() {
  return <RequireUser>{() => <StartBody />}</RequireUser>;
}
