import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, addEvidence, getUsage, reportUsage } from "../../api/client.ts";
import type {
  ArtifactSummary,
  EvidenceKind,
  UsageSummary,
  VersionDetail,
} from "../../api/types.ts";
import { EmptyState } from "../../components/EmptyState.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { roleAtLeast, useMe } from "../../lib/auth.tsx";
import { formatTransferRate, isSafeEvidenceHref } from "../../lib/evidence-url.ts";
import { STR } from "../../lib/strings.ts";
import { errorText, formatDateTime } from "../../i18n/index.ts";
import { Button } from "../../components/Button.tsx";

const KINDS: EvidenceKind[] = ["gate", "run", "diff", "review", "eval", "ablation"];

type Props = {
  type: string;
  name: string;
  artifact: ArtifactSummary;
  version: VersionDetail;
};

const MAX_DOCUMENT_BYTES = 65536;

/** Request body: the chosen file as a document, else the link (evidence-documents). */
async function evidenceSource(
  file: File | null,
  url: string,
): Promise<{ url: string } | { document: { name: string; text: string } }> {
  return file ? { document: { name: file.name, text: await file.text() } } : { url: url.trim() };
}

/** Client-side check before sending; null when the input is fine. */
function sourceError(file: File | null, url: string): string | null {
  if (file) return file.size > MAX_DOCUMENT_BYTES ? STR.evidence.errors.document_invalid : null;
  return isSafeEvidenceHref(url.trim()) ? null : STR.evidence.errors.url_invalid;
}

function evidenceErrorText(err: unknown): string {
  const code = err instanceof ApiError ? err.error : "request_failed";
  const known = (STR.evidence.errors as Record<string, string>)[code];
  if (known) return known;
  return err instanceof ApiError && err.message && err.message !== code
    ? `${errorText(err)} (${code})`
    : `${STR.evidence.errors.request_failed} (${code})`;
}

type MeUserData = NonNullable<ReturnType<typeof useMe>["data"]>;

/** Owner, maintainers and reviewers+ may attach evidence and report usage. */
function canPublishEvidence(user: MeUserData | null, artifact: ArtifactSummary): boolean {
  return (
    !!user &&
    (user.username === artifact.owner ||
      (artifact.maintainers ?? []).includes(user.username) ||
      roleAtLeast(user.role, "reviewer"))
  );
}

/** Usage counters of the version (server-computed when present, else derived from the counts). */
function usageStats(version: VersionDetail) {
  return (
    version.usage ?? {
      uses: version.use_count,
      helped: version.help_count,
      transfer_rate: version.use_count > 0 ? version.help_count / version.use_count : null,
    }
  );
}

/** Usage by source over all versions (evidence-usage-sources): agent self-reports apart from other data. */
function UsageBySource({ summary }: { summary: UsageSummary }) {
  const rows = summary.by_source ?? [];
  if (rows.length === 0) return null;
  const t = STR.evidence.bySourceCols;
  // Assigned reports are not in the total, so they do not close the gap either.
  const reported = rows.reduce((n, r) => (r.basis === "assigned" ? n : n + r.uses), 0);
  return (
    <div className="mt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
        {STR.evidence.bySource}
      </h3>
      <table data-testid="usage-by-source" className="mt-1 w-full text-left text-xs">
        <thead className="text-muted">
          <tr>
            <th className="py-1 pr-3 font-medium">{t.source}</th>
            <th className="py-1 pr-3 font-medium">{t.basis}</th>
            <th className="py-1 pr-3 font-medium">{t.reports}</th>
            <th className="py-1 pr-3 font-medium">{t.reporters}</th>
            <th className="py-1 pr-3 font-medium">{t.uses}</th>
            <th className="py-1 pr-3 font-medium">{t.helped}</th>
            <th className="py-1 font-medium">{t.rate}</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr
              key={`${r.source}/${r.basis ?? ""}`}
              data-source={r.source}
              data-basis={r.basis ?? ""}
              className="border-t border-line"
            >
              <td className="py-1 pr-3" translate="no">
                {r.source}
              </td>
              <td className="py-1 pr-3" translate="no">
                {r.basis ?? "—"}
              </td>
              <td className="py-1 pr-3">{r.reports}</td>
              <td className="py-1 pr-3">{r.reporters}</td>
              <td className="py-1 pr-3">{r.uses}</td>
              <td className="py-1 pr-3">{r.helped}</td>
              <td className="py-1">{formatTransferRate(r.transfer_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reported < summary.total.uses ? (
        <p data-testid="usage-by-source-gap" className="mt-1 text-xs text-muted">
          {STR.evidence.bySourceGap}
        </p>
      ) : null}
    </div>
  );
}

export function Evidence({ type, name, artifact, version }: Props) {
  const me = useMe();
  const user = me.data ?? null;
  const canPublish = canPublishEvidence(user, artifact);
  const queryClient = useQueryClient();

  const usageQ = useQuery({
    queryKey: ["usage", type, name],
    queryFn: () => getUsage(type, name),
    staleTime: 30_000,
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["version", type, name] }),
      queryClient.invalidateQueries({ queryKey: ["versions", type, name] }),
      queryClient.invalidateQueries({ queryKey: ["artifact", type, name] }),
      queryClient.invalidateQueries({ queryKey: ["usage", type, name] }),
      queryClient.invalidateQueries({ queryKey: ["audit", type, name] }),
    ]);
  }

  const [kind, setKind] = useState<EvidenceKind>("gate");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [summary, setSummary] = useState("");
  const [tasks, setTasks] = useState("");
  const [passedWith, setPassedWith] = useState("");
  const [passedWithout, setPassedWithout] = useState("");
  const [runner, setRunner] = useState("");
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const evidenceMut = useMutation({
    mutationFn: async () => {
      const body: {
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
      } = {
        kind,
        ...(await evidenceSource(file, url)),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      };
      if (kind === "ablation") {
        body.data = {
          tasks: Number(tasks),
          passed_with: Number(passedWith),
          passed_without: Number(passedWithout),
          ...(runner.trim() ? { runner: runner.trim() } : {}),
        };
      }
      return addEvidence(type, name, version.version, body);
    },
    onSuccess: async () => {
      setUrl("");
      setFile(null);
      setFileKey((k) => k + 1);
      setSummary("");
      setTasks("");
      setPassedWith("");
      setPassedWithout("");
      setRunner("");
      setEvidenceError(null);
      await refresh();
    },
    onError: (err: unknown) => setEvidenceError(evidenceErrorText(err)),
  });

  const [uses, setUses] = useState("");
  const [helped, setHelped] = useState("");
  const [usageError, setUsageError] = useState<string | null>(null);
  const usageMut = useMutation({
    mutationFn: () =>
      reportUsage(type, name, {
        version: version.version,
        uses: Number(uses),
        helped: Number(helped),
        source: "web",
      }),
    onSuccess: async () => {
      setUses("");
      setHelped("");
      setUsageError(null);
      await refresh();
    },
    onError: (err: unknown) => setUsageError(evidenceErrorText(err)),
  });

  function submitEvidence(e: FormEvent) {
    e.preventDefault();
    const badSource = sourceError(file, url);
    if (badSource) {
      setEvidenceError(badSource);
      return;
    }
    if (kind === "ablation") {
      const nTasks = Number(tasks);
      const nWith = Number(passedWith);
      const nWithout = Number(passedWithout);
      if (
        !/^\d+$/.test(tasks) ||
        !/^\d+$/.test(passedWith) ||
        !/^\d+$/.test(passedWithout) ||
        nTasks < 1 ||
        nTasks > 1000 ||
        nWith < 0 ||
        nWithout < 0 ||
        nWith > nTasks ||
        nWithout > nTasks
      ) {
        setEvidenceError(STR.evidence.errors.ablation_invalid);
        return;
      }
    }
    evidenceMut.mutate();
  }

  function submitUsage(e: FormEvent) {
    e.preventDefault();
    const u = Number(uses);
    const h = Number(helped);
    if (!/^\d+$/.test(uses) || !/^\d+$/.test(helped) || u > 100000 || h > u) {
      setUsageError(STR.evidence.errors.usage_invalid);
      return;
    }
    usageMut.mutate();
  }

  const stats = usageStats(version);
  const total = usageQ.data?.total;

  return (
    <div className="space-y-4" data-testid="evidence-tab">
      <section
        data-testid="usage-panel"
        className="rounded-sf border border-line bg-surface p-4 text-sm"
      >
        <h2 className="mb-2 font-medium">
          {STR.evidence.usageTitle} <span className="font-mono">{version.version}</span>
        </h2>
        <dl className="flex flex-wrap gap-6">
          <div>
            <dt className="text-muted">{STR.evidence.uses}</dt>
            <dd data-testid="usage-uses" className="font-mono text-lg">
              {stats.uses}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{STR.evidence.helped}</dt>
            <dd data-testid="usage-helped" className="font-mono text-lg">
              {stats.helped}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{STR.evidence.transferRate}</dt>
            <dd data-testid="transfer-rate" className="font-mono text-lg">
              {formatTransferRate(stats.transfer_rate)}
            </dd>
          </div>
        </dl>
        {usageQ.isError ? (
          <p className="mt-2 text-xs text-muted">{STR.evidence.errors.request_failed}</p>
        ) : total ? (
          <p data-testid="usage-total" className="mt-2 text-xs text-muted">
            {STR.evidence.allVersions}: {total.uses} / {total.helped} ·{" "}
            {formatTransferRate(total.transfer_rate)}
          </p>
        ) : null}
        {usageQ.data ? <UsageBySource summary={usageQ.data} /> : null}
        {user ? (
          <form
            data-testid="usage-form"
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={submitUsage}
          >
            <label className="flex flex-col gap-1 text-xs text-muted">
              {STR.evidence.uses}
              <input
                data-testid="usage-form-uses"
                type="number"
                min={0}
                max={100000}
                className="w-28 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                value={uses}
                onChange={(e) => setUses(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {STR.evidence.helped}
              <input
                data-testid="usage-form-helped"
                type="number"
                min={0}
                max={100000}
                className="w-28 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                value={helped}
                onChange={(e) => setHelped(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              data-testid="usage-report"
              pending={usageMut.isPending}
              className="rounded-sf border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              {STR.evidence.report}
            </Button>
            {usageError ? (
              <p data-testid="usage-error" role="alert" className="w-full text-xs text-danger">
                {usageError}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {STR.evidence.listTitle} <span className="font-mono">{version.version}</span>
          {version.validated_at ? (
            <span className="ml-2 text-xs font-normal text-muted">
              {STR.evidence.validatedAt} {formatDateTime(version.validated_at)}
            </span>
          ) : null}
        </h2>
        {version.evidence.length === 0 ? (
          <EmptyState title={STR.evidence.empty} />
        ) : (
          <ul data-testid="evidence-list" className="space-y-2">
            {[...version.evidence].reverse().map((e, i) => (
              <li
                key={`${e.kind}:${e.url}:${i}`}
                data-testid="evidence-row"
                data-kind={e.kind}
                className="rounded-sf border border-line bg-surface p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="evidence-kind-label"
                    className="rounded-sf bg-surface-2 px-1.5 py-0.5 font-mono text-xs"
                  >
                    {e.kind}
                  </span>
                  {isSafeEvidenceHref(e.url) ? (
                    <a
                      data-testid="evidence-link"
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-accent underline"
                    >
                      {e.document?.name ?? e.url}
                    </a>
                  ) : (
                    <span
                      data-testid="evidence-url-text"
                      className="break-all font-mono text-muted"
                    >
                      {e.url}
                    </span>
                  )}
                </div>
                {e.summary ? (
                  <p className="mt-1 text-ink-2" translate="no">
                    {e.summary}
                  </p>
                ) : null}
                {e.kind === "ablation" ? (
                  <p data-testid="evidence-uplift" className="mt-1 text-xs text-ink-2">
                    {STR.art.evidence.uplift}{" "}
                    <span className="font-mono">{e.uplift ?? e.data?.uplift ?? "—"}</span>
                    {e.data
                      ? STR.art.evidence.ablationData(
                          e.data.tasks,
                          e.data.passed_with,
                          e.data.passed_without,
                        )
                      : ""}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted">
                  <span data-testid="evidence-by" translate={e.by ? "no" : undefined}>
                    {e.by ?? STR.evidence.unknownAuthor}
                  </span>
                  {" · "}
                  <span data-testid="evidence-at">
                    {e.at ? formatDateTime(e.at) : STR.evidence.unknownTime}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canPublish ? (
        <form
          data-testid="evidence-form"
          className="space-y-2 rounded-sf border border-line bg-surface p-4 text-sm"
          onSubmit={submitEvidence}
        >
          <h2 className="font-medium">{STR.evidence.formTitle}</h2>
          <div className="flex flex-wrap gap-2">
            <select
              data-testid="evidence-kind"
              aria-label={STR.evidence.kind}
              className="rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
              value={kind}
              onChange={(e) => setKind(e.target.value as EvidenceKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              data-testid="evidence-url"
              aria-label="URL"
              placeholder={STR.art.evidence.urlPlaceholder}
              maxLength={2048}
              className="min-w-64 flex-1 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <HelpTip action="evidence-file">
              <label className="flex items-center gap-2 text-xs text-muted">
                {STR.art.evidence.file}
                <input
                  key={fileKey}
                  data-testid="evidence-file"
                  type="file"
                  accept=".md,.txt,.json,.log,.yaml,.yml,text/*"
                  className="text-xs text-ink"
                  onChange={(e) => {
                    setEvidenceError(null);
                    setFile(e.target.files?.[0] ?? null);
                  }}
                />
              </label>
            </HelpTip>
          </div>
          <textarea
            data-testid="evidence-summary"
            aria-label={STR.evidence.summary}
            placeholder={STR.evidence.summaryPlaceholder}
            maxLength={500}
            rows={2}
            className="w-full rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          {kind === "ablation" ? (
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                {STR.art.evidence.tasks}
                <input
                  data-testid="evidence-tasks"
                  type="number"
                  min={1}
                  max={1000}
                  className="w-28 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                  value={tasks}
                  onChange={(e) => setTasks(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {STR.art.evidence.passedWith}
                <input
                  data-testid="evidence-passed-with"
                  type="number"
                  min={0}
                  max={1000}
                  className="w-28 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                  value={passedWith}
                  onChange={(e) => setPassedWith(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {STR.art.evidence.passedWithout}
                <input
                  data-testid="evidence-passed-without"
                  type="number"
                  min={0}
                  max={1000}
                  className="w-28 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                  value={passedWithout}
                  onChange={(e) => setPassedWithout(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {STR.art.evidence.runner}
                <input
                  data-testid="evidence-runner"
                  type="text"
                  maxLength={64}
                  className="w-40 rounded-sf border border-line bg-bg px-2 py-1 text-sm text-ink"
                  value={runner}
                  onChange={(e) => setRunner(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <HelpTip action="evidence-add">
              <Button
                type="submit"
                data-testid="evidence-add"
                pending={evidenceMut.isPending}
                disabled={url.trim() === "" && !file}
                className="rounded-sf border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
              >
                {STR.evidence.add}
              </Button>
            </HelpTip>
            {evidenceError ? (
              <p data-testid="evidence-error" role="alert" className="text-xs text-danger">
                {evidenceError}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
