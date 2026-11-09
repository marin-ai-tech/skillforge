import { CompanyRubricPanel } from "../../components/QualityRubricPanels.tsx";
import { SecurityPolicyPanel } from "../../components/SecurityPolicyPanel.tsx";
import { McpPolicyPanel } from "../../components/McpPolicyPanel.tsx";
import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getLifecyclePolicy, sweepLifecycle } from "../../api/client.ts";
import type { SweepResult } from "../../api/types.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { RequireUser } from "../../components/RequireUser.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { roleAtLeast, useMe } from "../../lib/auth.tsx";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";

const POLICY_ROWS: Array<{
  key: keyof Awaited<ReturnType<typeof getLifecyclePolicy>>;
  label: string;
}> = [
  { key: "aging_days", label: "aging_days" },
  { key: "zombie_idle_days", label: "zombie_idle_days" },
  { key: "zombie_window_days", label: "zombie_window_days" },
  { key: "zombie_min_uses", label: "zombie_min_uses" },
  { key: "zombie_min_reporters", label: "zombie_min_reporters" },
  { key: "zombie_transfer_rate", label: "zombie_transfer_rate" },
  { key: "zombie_retire_days", label: "zombie_retire_days" },
  { key: "ablation_min_tasks", label: "ablation_min_tasks" },
  { key: "revive_window_days", label: "revive_window_days" },
  { key: "revive_min_events", label: "revive_min_events" },
  { key: "max_per_sweep", label: "max_per_sweep" },
];

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const text = errorText(err);
    return text && text !== err.error ? `${err.error}: ${text}` : err.error;
  }
  return errorText(err);
}

/** Sweep counters: API field names (kept as is) and the test id of each value. */
const SWEEP_COUNTERS = [
  ["aged", "sweep-aged"],
  ["zombied", "sweep-zombied"],
  ["revived", "sweep-revived"],
  ["held", "sweep-held"],
  ["deferred", "sweep-deferred"],
] as const;

function SweepResultView({ result }: { result: SweepResult }) {
  return (
    <div
      data-testid="sweep-result"
      className="space-y-3 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <p className="text-ink-2">
        {result.dry_run ? STR.adm.lifecycle.dryRunDone : STR.adm.lifecycle.sweepDone}{" "}
        {STR.adm.lifecycle.counters}{" "}
        {SWEEP_COUNTERS.map(([key, testId], i) => (
          <Fragment key={key}>
            {i > 0 ? ", " : ""}
            <span translate="no">{key}=</span> <span data-testid={testId}>{result[key]}</span>
          </Fragment>
        ))}
        .
      </p>
      {result.plan.length === 0 ? (
        <p className="text-muted">{STR.adm.lifecycle.planEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-1 pr-2">{STR.adm.lifecycle.colArtifact}</th>
                <th className="py-1 pr-2">{STR.adm.lifecycle.colFrom}</th>
                <th className="py-1 pr-2">{STR.adm.lifecycle.colTo}</th>
                <th className="py-1 pr-2">{STR.adm.lifecycle.colRule}</th>
              </tr>
            </thead>
            <tbody>
              {result.plan.map((p) => (
                <tr
                  key={`${p.type}/${p.name}/${p.rule}/${p.to}`}
                  className="border-b border-line/60"
                >
                  <td className="py-1 pr-2 font-mono" translate="no">
                    {p.type}/{p.name}
                  </td>
                  <td className="py-1 pr-2 font-mono">{p.from}</td>
                  <td className="py-1 pr-2 font-mono">{p.to}</td>
                  <td className="py-1 pr-2 font-mono" translate="no">
                    {p.rule}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminLifecycleBody() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    document.title = STR.adm.lifecycle.docTitle;
  }, []);

  const policyQ = useQuery({
    queryKey: ["lifecycle-policy"],
    queryFn: getLifecyclePolicy,
    staleTime: 15_000,
  });

  const dryMut = useMutation({
    mutationFn: () => sweepLifecycle({ dry_run: true }),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
    },
    onError: (err) => setError(formatError(err)),
  });

  const runMut = useMutation({
    mutationFn: () => sweepLifecycle({ dry_run: false }),
    onSuccess: async (data) => {
      setError(null);
      setResult(data);
      setConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["board"] }),
        queryClient.invalidateQueries({ queryKey: ["lifecycle-policy"] }),
        queryClient.invalidateQueries({ queryKey: ["artifact"] }),
      ]);
    },
    onError: (err) => {
      setError(formatError(err));
      setConfirmOpen(false);
    },
  });

  if (!me.data || !roleAtLeast(me.data.role, "admin")) {
    return (
      <div
        data-testid="admin-lifecycle-forbidden"
        className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
      >
        {STR.adminLifecycle.forbidden}
      </div>
    );
  }

  const policy = policyQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={STR.adminLifecycle.title}
        description={STR.adminLifecycle.subtitle}
        topic="pages/admin-lifecycle"
      />

      {error ? (
        <div
          data-testid="admin-error"
          className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <SecurityPolicyPanel />
      <McpPolicyPanel />
      <CompanyRubricPanel />

      <section className="space-y-3 rounded-sf border border-line bg-surface p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
          {STR.adm.lifecycle.policy}
        </h2>
        {policyQ.isLoading || !policy ? (
          <Skeleton className="h-32" />
        ) : (
          <>
            <p data-testid="policy-enabled" className="text-sm text-ink-2">
              {policy.enabled ? STR.adm.lifecycle.enabled : STR.adm.lifecycle.disabled}
            </p>
            <table className="w-full text-left text-sm">
              <tbody>
                {POLICY_ROWS.map((row) => (
                  <tr key={row.key} className="border-b border-line/50">
                    <th
                      className="py-1 pr-3 font-mono text-xs font-normal text-muted"
                      translate="no"
                    >
                      {row.label}
                    </th>
                    <td className="py-1 font-mono">{String(policy[row.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="sweep-dry-run"
          disabled={dryMut.isPending}
          className="rounded-sf border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
          onClick={() => {
            setError(null);
            dryMut.mutate();
          }}
        >
          {STR.adm.lifecycle.dryRun}
        </button>
        <HelpTip action="sweep-run">
          <button
            type="button"
            data-testid="sweep-run"
            disabled={runMut.isPending}
            className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => {
              setError(null);
              setConfirmOpen(true);
            }}
          >
            {STR.adm.lifecycle.runSweep}
          </button>
        </HelpTip>
      </div>

      {result ? <SweepResultView result={result} /> : null}

      <ConfirmDialog
        open={confirmOpen}
        title={STR.adm.lifecycle.confirmTitle}
        body={STR.adm.lifecycle.confirmBody}
        helpText={STR.adm.lifecycle.confirmHelp}
        helpTopic="getting-started/lifecycle-hold-sweep"
        confirmLabel={STR.adm.lifecycle.runSweep}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => runMut.mutate()}
      />
    </div>
  );
}

export function AdminLifecycle() {
  return <RequireUser>{() => <AdminLifecycleBody />}</RequireUser>;
}
