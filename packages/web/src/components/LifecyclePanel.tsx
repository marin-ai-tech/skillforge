import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  clearLifecycleHold,
  getArtifactLifecycle,
  setLifecycleHold,
  transitionArtifact,
} from "../api/client.ts";
import type { ArtifactSummary } from "../api/types.ts";
import { StatusChip } from "./StatusChip.tsx";
import { TransitionDialog } from "./TransitionDialog.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { RelativeTime } from "./RelativeTime.tsx";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText, formatDateTime } from "../i18n/index.ts";

type Props = {
  artifact: ArtifactSummary;
  allowedTransitions: string[];
  /** `published_by` of the latest version (self-promotion-guard). */
  latestAuthor?: string | null;
};

/** The latest version's author: a non-admin cannot promote it; an admin needs a reason (self-promotion-guard). */
function selfPromotion(
  user: ReturnType<typeof useMe>["data"],
  latestAuthor: string | null | undefined,
): "none" | "forbidden" | "reason" {
  if (!user || !latestAuthor || user.username !== latestAuthor) return "none";
  return user.role === "admin" ? "reason" : "forbidden";
}

type SelfPromotion = ReturnType<typeof selfPromotion>;

function selfPromotionDialog(
  target: string | null,
  self: SelfPromotion,
): { reasonRequired: boolean; note?: string } {
  return target === "active" && self === "reason"
    ? { reasonRequired: true, note: STR.art.transition.selfPromotion }
    : { reasonRequired: false };
}

function TransitionButtons({
  allowed,
  self,
  onPick,
}: {
  allowed: string[];
  self: SelfPromotion;
  onPick: (to: string) => void;
}) {
  const blocked = (to: string) => to === "active" && self === "forbidden";
  return (
    <>
      {allowed.map((to) => (
        <HelpTip key={to} family="transition-*">
          <button
            type="button"
            data-testid={`transition-${to}`}
            disabled={blocked(to)}
            title={blocked(to) ? STR.art.lifecycle.selfPromotionForbidden : undefined}
            className="rounded-sf border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onPick(to)}
          >
            {(STR.art.lifecycle.transitions as Record<string, string | undefined>)[to] ?? to}
          </button>
        </HelpTip>
      ))}
      {allowed.some(blocked) ? (
        <span data-testid="self-promotion-hint" className="text-xs text-muted">
          {STR.art.lifecycle.selfPromotionForbidden}
        </span>
      ) : null}
    </>
  );
}

function formatRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

function humanHoldError(err: unknown): string {
  const t = STR.art.lifecycle.holdErrors;
  if (!(err instanceof ApiError)) return STR.art.common.requestFailed;
  switch (err.error) {
    case "hold_invalid":
      return t.invalid;
    case "forbidden":
      return t.forbidden;
    case "mcp_token_forbidden":
      return t.mcpForbidden;
    default:
      return err.message && err.message !== err.error
        ? `${err.error}: ${errorText(err)}`
        : err.error;
  }
}

type LifecycleData = Awaited<ReturnType<typeof getArtifactLifecycle>>;
type LifecycleSignals = NonNullable<LifecycleData["signals"]>;

/** Reviewers+ may set a hold, but not on their own artifact. */
function canSetHold(user: ReturnType<typeof useMe>["data"], owner: string | undefined): boolean {
  return (
    !!user &&
    roleAtLeast(user.role, "reviewer") &&
    user.username.toLowerCase() !== (owner ?? "").toLowerCase()
  );
}

function SignalsList({ signals }: { signals: LifecycleSignals }) {
  const t = STR.art.lifecycle.signals;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase text-muted">{t.lastActivity}</dt>
        <dd data-testid="signal-last-activity" className="mt-1 text-ink">
          {signals.last_activity_at ? <RelativeTime iso={signals.last_activity_at} /> : "—"}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted">{t.uses}</dt>
        <dd data-testid="signal-uses" className="mt-1 font-mono text-ink">
          {signals.uses_window}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted">{t.transferRate}</dt>
        <dd data-testid="signal-transfer-rate" className="mt-1 font-mono text-ink">
          {formatRate(signals.transfer_rate_window)}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted">{t.reporters}</dt>
        <dd data-testid="signal-reporters" className="mt-1 font-mono text-ink">
          {signals.reporters_window}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-muted">{t.ablation}</dt>
        <dd data-testid="signal-ablation" className="mt-1 font-mono text-ink">
          {signals.ablation ? signals.ablation.uplift : "—"}
        </dd>
      </div>
    </dl>
  );
}

function WouldTransition({ would }: { would: LifecycleData["would_transition"] | undefined }) {
  return would ? (
    <p data-testid="would-transition" className="mt-3 text-sm text-ink-2">
      {STR.art.lifecycle.wouldMove} <span className="font-mono">{would.to}</span>{" "}
      {STR.art.lifecycle.byRule} <span className="font-mono">{would.rule}</span>.
    </p>
  ) : null;
}

function HoldStatus({ hold }: { hold: LifecycleData["hold"] | undefined }) {
  return hold ? (
    <p className="text-sm text-ink-2">
      {STR.art.lifecycle.holdActive} <span className="font-mono">{formatDateTime(hold.until)}</span>{" "}
      {STR.art.lifecycle.holdBy} <span className="font-mono">{hold.set_by}</span>:{" "}
      <span translate="no">{hold.reason}</span>
    </p>
  ) : (
    <p className="text-xs text-muted">{STR.art.lifecycle.noHold}</p>
  );
}

export function LifecyclePanel({ artifact, allowedTransitions, latestAuthor }: Props) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [holdUntil, setHoldUntil] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [holdError, setHoldError] = useState<string | null>(null);

  const canHold = canSetHold(me.data, artifact.owner);
  const self = selfPromotion(me.data, latestAuthor);

  const lifeQ = useQuery({
    queryKey: ["artifact-lifecycle", artifact.type, artifact.name],
    queryFn: () => getArtifactLifecycle(artifact.type, artifact.name),
    staleTime: 15_000,
  });

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["artifact", artifact.type, artifact.name] }),
      queryClient.invalidateQueries({ queryKey: ["audit", artifact.type, artifact.name] }),
      queryClient.invalidateQueries({ queryKey: ["board"] }),
      queryClient.invalidateQueries({ queryKey: ["versions", artifact.type, artifact.name] }),
      queryClient.invalidateQueries({
        queryKey: ["artifact-lifecycle", artifact.type, artifact.name],
      }),
    ]);
  }

  const mut = useMutation({
    mutationFn: (input: { to: string; reason: string }) =>
      transitionArtifact(artifact.type, artifact.name, {
        to: input.to,
        reason: input.reason || undefined,
      }),
    onSuccess: async () => {
      setTarget(null);
      setError(null);
      await invalidate();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        setError(
          err.message && err.message !== err.error ? `${err.error}: ${errorText(err)}` : err.error,
        );
      } else {
        setError(errorText(err));
      }
    },
  });

  const holdSetMut = useMutation({
    mutationFn: () =>
      setLifecycleHold(artifact.type, artifact.name, {
        until: new Date(holdUntil).toISOString(),
        reason: holdReason.trim(),
      }),
    onSuccess: async () => {
      setHoldError(null);
      setHoldUntil("");
      setHoldReason("");
      await invalidate();
    },
    onError: (err: unknown) => setHoldError(humanHoldError(err)),
  });

  const holdClearMut = useMutation({
    mutationFn: () => clearLifecycleHold(artifact.type, artifact.name),
    onSuccess: async () => {
      setHoldError(null);
      await invalidate();
    },
    onError: (err: unknown) => setHoldError(humanHoldError(err)),
  });

  const signals = lifeQ.data?.signals;
  const would = lifeQ.data?.would_transition;
  const hold = lifeQ.data?.hold;

  return (
    <div className="space-y-3">
      <div
        data-testid="lifecycle-panel"
        className="flex flex-wrap items-center gap-2 rounded-sf border border-line bg-surface-2 px-3 py-2"
      >
        <span className="text-xs uppercase text-muted">{STR.art.lifecycle.title}</span>
        <StatusChip status={artifact.status} />
        <TransitionButtons
          allowed={allowedTransitions}
          self={self}
          onPick={(to) => {
            setError(null);
            setTarget(to);
          }}
        />
        {error && !target ? (
          <span data-testid="transition-error" className="text-xs text-danger">
            {error}
          </span>
        ) : null}
        <TransitionDialog
          open={!!target}
          to={target ?? ""}
          from={artifact.status}
          error={error}
          busy={mut.isPending}
          {...selfPromotionDialog(target, self)}
          onCancel={() => {
            setTarget(null);
            setError(null);
          }}
          onConfirm={(reason) => {
            if (!target) return;
            mut.mutate({ to: target, reason });
          }}
        />
      </div>

      <section className="rounded-sf border border-line bg-surface p-3 text-sm">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          {STR.art.lifecycle.signals.title}
        </h3>
        {lifeQ.isLoading ? (
          <p className="text-xs text-muted">{STR.art.lifecycle.signals.loading}</p>
        ) : lifeQ.isError || !signals ? (
          <p className="text-xs text-danger">{STR.art.lifecycle.signals.failed}</p>
        ) : (
          <SignalsList signals={signals} />
        )}
        <WouldTransition would={would} />

        {canHold ? (
          <div className="mt-4 space-y-2 border-t border-line pt-3">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
              {STR.art.lifecycle.hold}
            </h4>
            <HoldStatus hold={hold} />
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                {STR.art.lifecycle.until}
                <input
                  data-testid="hold-until"
                  type="datetime-local"
                  className="rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                  value={holdUntil}
                  onChange={(e) => setHoldUntil(e.target.value)}
                />
              </label>
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
                {STR.art.common.reason}
                <input
                  data-testid="hold-reason"
                  type="text"
                  maxLength={500}
                  className="rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                />
              </label>
              <HelpTip action="lifecycle-hold-set">
                <button
                  type="button"
                  data-testid="hold-set"
                  disabled={holdSetMut.isPending || !holdUntil || holdReason.trim().length < 5}
                  className="rounded-sf border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
                  onClick={() => {
                    setHoldError(null);
                    holdSetMut.mutate();
                  }}
                >
                  {STR.art.lifecycle.setHold}
                </button>
              </HelpTip>
              <button
                type="button"
                data-testid="hold-clear"
                disabled={holdClearMut.isPending || !hold}
                className="rounded-sf border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
                onClick={() => {
                  setHoldError(null);
                  holdClearMut.mutate();
                }}
              >
                {STR.art.lifecycle.clearHold}
              </button>
            </div>
            {holdError ? (
              <p data-testid="hold-error" role="alert" className="text-xs text-danger">
                {holdError}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
