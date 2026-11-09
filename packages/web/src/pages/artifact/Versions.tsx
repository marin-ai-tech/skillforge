import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, setVersionChannel, validateVersion } from "../../api/client.ts";
import type { VersionChannel, VersionDetail } from "../../api/types.ts";
import { shortDigest } from "../../lib/format.ts";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { useHelp } from "../../help/HelpProvider.tsx";
import { useMe } from "../../lib/auth.tsx";
import { roleAtLeast } from "../../lib/auth.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";
import { PurgePanel } from "../../components/PurgePanel.tsx";
import { VersionCompare } from "../../components/VersionCompare.tsx";

type Props = {
  type: string;
  name: string;
  versions: VersionDetail[];
  onSelect: (version: string) => void;
  isAdmin: boolean;
};

/** Semver pre-release suffix (e.g. 0.3.0-beta.1) — server rejects promote to stable. */
function hasPrereleaseSuffix(version: string): boolean {
  return version.includes("-");
}

function notOwnerMessage(owner: string | undefined): string {
  return owner ? STR.art.versions.notOwner(owner) : STR.art.versions.notOwnerAnon;
}

function evalGateFailedMessage(reason: string): string {
  const t = STR.art.versions.gate;
  if (reason === "task_regression") return t.taskRegression;
  if (reason === "trigger_regression") return t.triggerRegression;
  if (reason === "errors") return t.errors;
  return reason ? t.reason(reason) : t.failed;
}

function humanChannelError(err: unknown): string {
  const t = STR.art.versions;
  if (!(err instanceof ApiError)) return STR.art.common.requestFailed;
  switch (err.error) {
    case "channel_invalid":
      return t.channelInvalid;
    case "forbidden":
      return t.forbidden;
    case "not_owner":
      return notOwnerMessage(err.owner);
    case "mcp_token_forbidden":
      return t.mcpForbidden;
    case "bad_request":
      return err.message && err.message !== err.error ? err.message : STR.art.common.invalidRequest;
    case "eval_gate_missing":
      return t.gate.missing;
    case "eval_gate_failed":
      return evalGateFailedMessage(err.reason ?? "");
    case "eval_gate_required":
      return t.gate.required;
    default:
      return err.message && err.message !== err.error
        ? `${err.error}: ${errorText(err)}`
        : err.error;
  }
}

function isEvalGateError(code: string): boolean {
  return (
    code === "eval_gate_missing" || code === "eval_gate_failed" || code === "eval_gate_required"
  );
}

type ChannelError = { version: string; error: string; code?: string };

/** Channel switch button for one version plus its (eval-gate aware) error. */
function ChannelControls({
  v,
  nextChannel,
  pending,
  channelError,
  requestChannelChange,
  setSearchParams,
}: {
  v: VersionDetail;
  nextChannel: VersionChannel;
  pending: boolean;
  channelError: ChannelError | null;
  requestChannelChange: (version: string, channel: VersionChannel) => void;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <HelpTip action="set-channel">
        <button
          type="button"
          data-testid={`set-channel-${v.version}`}
          className="rounded-sf border border-line px-2 py-1 text-xs text-ink-2 hover:border-accent"
          disabled={pending}
          onClick={() => requestChannelChange(v.version, nextChannel)}
        >
          {v.channel === "beta" ? STR.art.versions.promoteStable : STR.art.versions.moveBeta}
        </button>
      </HelpTip>
      {channelError?.version === v.version ? (
        <span data-testid={`set-channel-error-${v.version}`} className="text-xs text-danger">
          {channelError.error}{" "}
          {channelError.code && isEvalGateError(channelError.code) ? (
            <button
              type="button"
              className="underline text-accent"
              onClick={() => {
                const sp = new URLSearchParams(window.location.search);
                sp.set("tab", "evals");
                setSearchParams(sp);
              }}
            >
              {STR.detail.evals}
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function Versions({ type, name, versions, onSelect, isAdmin }: Props) {
  const me = useMe();
  const [, setSearchParams] = useSearchParams();
  const canValidate = roleAtLeast(me.data?.role, "reviewer");
  const canSetChannel = roleAtLeast(me.data?.role, "contributor");
  const queryClient = useQueryClient();
  const { openTopic } = useHelp();
  const [target, setTarget] = useState<string | null>(null);
  const [compat, setCompat] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const models = compat
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return validateVersion(type, name, target!, {
        model_compat: models.length ? models : undefined,
        note: note.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setTarget(null);
      setCompat("");
      setNote("");
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["versions", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["version", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["artifact", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["audit", type, name] }),
      ]);
    },
    onError: (err: unknown) => {
      setError(errorText(err));
    },
  });

  const [channelError, setChannelError] = useState<ChannelError | null>(null);
  const [channelConfirm, setChannelConfirm] = useState<{
    version: string;
    channel: VersionChannel;
  } | null>(null);

  const channelMut = useMutation({
    mutationFn: (v: { version: string; channel: VersionChannel }) =>
      setVersionChannel(type, name, v.version, v.channel),
    onSuccess: async () => {
      setChannelError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["versions", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["version", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["artifact", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["audit", type, name] }),
      ]);
    },
    onError: (err: unknown, v) => {
      const code = err instanceof ApiError ? err.error : undefined;
      setChannelError({
        version: v.version,
        error: humanChannelError(err),
        code,
      });
    },
  });

  function requestChannelChange(version: string, channel: VersionChannel) {
    setChannelError(null);
    setChannelConfirm({ version, channel });
  }

  if (versions.length === 0) return <EmptyState title={STR.detail.emptyVersions} />;

  return (
    <>
      <VersionCompare type={type} name={name} versions={versions} />
      <ul data-testid="versions-list" className="space-y-2">
        {versions.map((v) => {
          if (v.purged)
            return (
              <li
                key={v.version}
                data-testid={`version-purged-${v.version}`}
                className="rounded-sf border border-line bg-surface-2 p-3 text-sm text-muted"
              >
                <span className="font-mono">{v.version}</span> {STR.art.versions.purged}
                {v.purged_at ? ` ${formatDateTime(v.purged_at)}` : ""}
              </li>
            );
          const nextChannel: VersionChannel = v.channel === "beta" ? "stable" : "beta";
          const hidePromote = nextChannel === "stable" && hasPrereleaseSuffix(v.version);
          return (
            <li key={v.version}>
              <div
                data-testid="version-entry"
                data-version={v.version}
                className="flex w-full flex-col gap-1 rounded-sf border border-line bg-surface p-3 text-left"
              >
                <button
                  type="button"
                  className="flex flex-wrap items-center gap-2 text-left hover:underline"
                  onClick={() => onSelect(v.version)}
                >
                  <span className="font-mono font-semibold">{v.version}</span>
                  <span
                    data-testid={`version-channel-${v.version}`}
                    className={
                      v.channel === "beta"
                        ? "rounded-sf bg-warning-bg px-1.5 py-0.5 text-xs text-warning"
                        : "rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2"
                    }
                  >
                    {v.channel}
                  </span>
                  <span className="text-xs text-muted" translate="no">
                    {v.published_by}
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(v.published_at)}</span>
                  <span className="font-mono text-xs text-muted">{shortDigest(v.digest)}</span>
                </button>
                {v.changelog ? (
                  <p className="text-sm text-ink-2" translate="no">
                    {v.changelog}
                  </p>
                ) : null}
                {v.validated_at ? (
                  <span data-testid="version-validated-at" className="text-xs text-muted">
                    {STR.art.versions.validated} {formatDateTime(v.validated_at)}
                  </span>
                ) : null}
                {v.model_compat.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {v.model_compat.map((m) => (
                      <span
                        key={m}
                        className="rounded-sf bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-2"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                ) : null}
                {canSetChannel && !hidePromote ? (
                  <ChannelControls
                    v={v}
                    nextChannel={nextChannel}
                    pending={channelMut.isPending}
                    channelError={channelError}
                    requestChannelChange={requestChannelChange}
                    setSearchParams={setSearchParams}
                  />
                ) : null}
                {canValidate ? (
                  <div>
                    <HelpTip action="version-validate">
                      <button
                        type="button"
                        data-testid="version-validate"
                        className="rounded-sf border border-line px-2 py-1 text-xs text-ink-2 hover:border-accent"
                        onClick={() => {
                          setError(null);
                          setCompat("");
                          setNote("");
                          setTarget(v.version);
                        }}
                      >
                        {STR.art.versions.validate}
                      </button>
                    </HelpTip>
                  </div>
                ) : null}
                {isAdmin ? (
                  <HelpTip action="purge-version">
                    <button
                      type="button"
                      data-testid={`purge-version-${v.version}`}
                      className="rounded-sf border border-danger px-2 py-1 text-xs text-danger"
                      onClick={() => setPurgeTarget(v.version)}
                    >
                      {STR.art.versions.purgeVersion}
                    </button>
                  </HelpTip>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {purgeTarget ? (
        <PurgePanel
          key={purgeTarget}
          type={type}
          name={name}
          version={purgeTarget}
          initiallyOpen
          hideTrigger
          onClose={() => setPurgeTarget(null)}
        />
      ) : null}

      <ConfirmDialog
        open={channelConfirm !== null}
        title={
          channelConfirm?.channel === "stable"
            ? STR.art.versions.confirmPromoteTitle(channelConfirm.version)
            : STR.art.versions.confirmMoveTitle(channelConfirm?.version ?? "")
        }
        body={
          channelConfirm
            ? STR.art.versions.confirmBody(channelConfirm.version, channelConfirm.channel)
            : ""
        }
        helpText={STR.art.versions.confirmHelp}
        helpTopic="getting-started/channels-and-pinning"
        confirmLabel={
          channelConfirm?.channel === "stable"
            ? STR.art.versions.promote
            : STR.art.versions.moveBeta
        }
        onCancel={() => setChannelConfirm(null)}
        onConfirm={() => {
          if (!channelConfirm) return;
          const pending = channelConfirm;
          setChannelConfirm(null);
          setChannelError(null);
          channelMut.mutate(pending);
        }}
      />

      {target ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div
            data-testid="validate-dialog"
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-sf border border-line bg-surface p-4 shadow-lg"
          >
            <h2 className="text-base font-semibold text-ink">
              {STR.art.versions.validateTitle(target)}
            </h2>
            <label className="mt-3 block text-sm text-muted">
              {STR.art.versions.modelCompat}
              <HelpTip action="validate-model-compat">
                <input
                  data-testid="validate-model-compat"
                  className="mt-1 w-full rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
                  value={compat}
                  onChange={(e) => setCompat(e.target.value)}
                />
              </HelpTip>
            </label>
            <label className="mt-3 block text-sm text-muted">
              {STR.art.versions.note}
              <HelpTip action="validate-note">
                <textarea
                  data-testid="validate-note"
                  className="mt-1 w-full rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </HelpTip>
            </label>
            <p data-testid="dialog-help" className="mt-3 text-sm text-muted">
              {STR.art.versions.validateHelp}{" "}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => openTopic("getting-started/lifecycle")}
              >
                {STR.art.common.learnMore}
              </button>
            </p>
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sf border border-line px-3 py-1.5 text-sm"
                onClick={() => setTarget(null)}
              >
                {STR.art.common.cancel}
              </button>
              <HelpTip action="validate-confirm">
                <button
                  type="button"
                  data-testid="validate-confirm"
                  className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white"
                  disabled={mut.isPending}
                  onClick={() => mut.mutate()}
                >
                  {STR.art.versions.validate}
                </button>
              </HelpTip>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
