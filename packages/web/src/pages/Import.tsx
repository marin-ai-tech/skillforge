import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, Navigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { importPreview, importRun } from "../api/client.ts";
import type {
  ImportCandidate,
  ImportPreviewResponse,
  ImportResultItem,
  ImportSkipped,
} from "../api/types.ts";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { filesFromInput, type LocalFile } from "../lib/files.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { IssueList } from "../components/IssueList.tsx";
import { ImportPolicyPanel } from "../components/ImportPolicyPanel.tsx";
import { MirrorsPanel } from "../components/MirrorsPanel.tsx";
import { ImportFreshness } from "../components/ImportFreshness.tsx";
import { Button } from "../components/Button.tsx";

type SourceKind = "zip" | "git" | "folder";

function dryRunLabel(c: ImportCandidate): string {
  const t = STR.flow.import.dryRun;
  if (c.dry_run.conflicts.length > 0) return t.conflict;
  if (c.dry_run.errors.length > 0) return t.errorsCount(c.dry_run.errors.length);
  if (c.dry_run.warnings.length > 0) return t.warningsCount(c.dry_run.warnings.length);
  if (c.dry_run.ok) return t.ready;
  return t.errors;
}

/** Caption of an API value from a dictionary map; unknown values are shown as they are. */
function pick(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(STR.flow.import.readFailed));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error(STR.flow.import.readError));
    reader.readAsDataURL(file);
  });
}

export function ImportPage() {
  const meQuery = useMe();
  const user = meQuery.data;
  const queryClient = useQueryClient();
  const zipRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const [sourceKind, setSourceKind] = useState<SourceKind>("zip");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<LocalFile[]>([]);
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitPath, setGitPath] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [provenance, setProvenance] = useState("");
  const [skipConflicts, setSkipConflicts] = useState(true);
  const [results, setResults] = useState<ImportResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    document.title = STR.flow.import.pageTitle;
  }, []);

  if (meQuery.isLoading) {
    return <p className="text-sm text-muted">{STR.common.loading}</p>;
  }
  if (!user) {
    return <Navigate to="/login?next=/import" replace />;
  }
  if (!roleAtLeast(user.role, "contributor")) {
    return (
      <div
        data-testid="import-forbidden"
        className="rounded-sf border border-line bg-surface p-4 text-sm"
      >
        {STR.import.forbidden}
      </div>
    );
  }

  function toggleAll(checked: boolean) {
    if (!preview) return;
    if (checked) setSelected(new Set(preview.candidates.map((c) => c.id)));
    else setSelected(new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function onPreview() {
    setError(null);
    setResults(null);
    setBusy(true);
    try {
      let source: Parameters<typeof importPreview>[0]["source"];
      if (sourceKind === "zip") {
        if (!zipFile) {
          setError(STR.flow.import.chooseZip);
          return;
        }
        const content_base64 = await readFileAsBase64(zipFile);
        source = { kind: "zip", content_base64 };
      } else if (sourceKind === "folder") {
        if (folderFiles.length === 0) {
          setError(STR.flow.import.chooseFolder);
          return;
        }
        const files = await Promise.all(
          folderFiles.map(async (f) => ({
            path: f.path,
            content_base64: await readFileAsBase64(f.file),
          })),
        );
        source = { kind: "files", files };
      } else {
        if (!gitUrl.trim()) {
          setError(STR.flow.import.enterGitUrl);
          return;
        }
        source = {
          kind: "git",
          url: gitUrl.trim(),
          ...(gitRef.trim() ? { ref: gitRef.trim() } : {}),
          ...(gitPath.trim() ? { path: gitPath.trim() } : {}),
        };
      }
      const data = await importPreview({ source });
      setPreview(data);
      setSelected(new Set(data.candidates.map((c) => c.id)));
    } catch (e) {
      setError(errorText(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function onRun() {
    if (!preview || selected.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      const body = {
        import_id: preview.import_id,
        selected: [...selected],
        skip_conflicts: skipConflicts,
        ...(provenance ? { provenance_source: provenance } : {}),
        ...(overrideReason.trim() ? { age_override_reason: overrideReason.trim() } : {}),
      };
      const data = await importRun(body);
      setResults(data.results);
      await queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      setPreview(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function onZipChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setZipFile(f);
    setPreview(null);
    setResults(null);
  }

  function onDirChange(e: ChangeEvent<HTMLInputElement>) {
    setFolderFiles(filesFromInput(e.target.files));
    setPreview(null);
    setResults(null);
    e.target.value = "";
  }

  const canRun = !!preview && selected.size > 0 && !busy;

  return (
    <div className="space-y-6">
      <PageHeader title={STR.import.title} description={STR.import.subtitle} topic="pages/import" />
      <ImportPolicyPanel role={user.role} />
      <MirrorsPanel role={user.role} />

      <div className="space-y-3 rounded-sf border border-line bg-surface p-4">
        <HelpTip action="import-source">
          <label className="block text-sm">
            <span className="text-muted">{STR.import.source}</span>
            <select
              data-testid="import-source"
              className="mt-1 block w-full max-w-xs rounded-sf border border-line bg-surface-2 px-2 py-1.5 text-sm"
              value={sourceKind}
              onChange={(e) => {
                setSourceKind(e.target.value as SourceKind);
                setPreview(null);
                setResults(null);
              }}
            >
              <option value="zip">{STR.flow.import.sources.zip}</option>
              <option value="git">{STR.flow.import.sources.git}</option>
              <option value="folder">{STR.flow.import.sources.folder}</option>
            </select>
          </label>
        </HelpTip>

        {sourceKind === "zip" ? (
          <HelpTip action="import-zip-input">
            <input
              ref={zipRef}
              data-testid="import-zip-input"
              type="file"
              accept=".zip,application/zip"
              className="block text-sm"
              onChange={onZipChange}
            />
          </HelpTip>
        ) : null}

        {sourceKind === "git" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <HelpTip action="import-git-url">
              <input
                data-testid="import-git-url"
                type="text"
                placeholder={STR.flow.import.gitUrlPlaceholder}
                className="w-full max-w-md rounded-sf border border-line px-2 py-1.5 text-sm"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
              />
            </HelpTip>
            <HelpTip action="import-git-ref">
              <input
                data-testid="import-git-ref"
                type="text"
                placeholder={STR.flow.import.gitRefPlaceholder}
                className="w-40 rounded-sf border border-line px-2 py-1.5 text-sm"
                value={gitRef}
                onChange={(e) => setGitRef(e.target.value)}
              />
            </HelpTip>
            <HelpTip action="import-git-path">
              <input
                data-testid="import-git-path"
                type="text"
                placeholder={STR.flow.import.gitPathPlaceholder}
                className="w-40 rounded-sf border border-line px-2 py-1.5 text-sm"
                value={gitPath}
                onChange={(e) => setGitPath(e.target.value)}
              />
            </HelpTip>
          </div>
        ) : null}

        {sourceKind === "folder" ? (
          <HelpTip action="import-dir-input">
            <input
              ref={dirRef}
              data-testid="import-dir-input"
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              directory=""
              multiple
              className="block text-sm"
              onChange={onDirChange}
            />
          </HelpTip>
        ) : null}

        <HelpTip action="import-preview">
          <Button
            type="button"
            data-testid="import-preview"
            className="rounded-sf bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50"
            pending={busy}
            onClick={() => void onPreview()}
          >
            {STR.import.preview}
          </Button>
        </HelpTip>
      </div>

      {error ? (
        <div
          data-testid="import-error"
          className="rounded-sf border border-line bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {preview ? (
        <ImportFreshness
          source={preview.source}
          isAdmin={user.role === "admin"}
          reason={overrideReason}
          onReason={setOverrideReason}
        />
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <HelpTip action="import-select-all">
              <label className="flex items-center gap-2 text-sm">
                <input
                  data-testid="import-select-all"
                  type="checkbox"
                  checked={
                    preview.candidates.length > 0 && selected.size === preview.candidates.length
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                />
                {STR.import.selectAll}
              </label>
            </HelpTip>
            <HelpTip action="import-provenance">
              <select
                data-testid="import-provenance"
                className="rounded-sf border border-line px-2 py-1 text-sm"
                value={provenance}
                onChange={(e) => setProvenance(e.target.value)}
              >
                <option value="">{STR.flow.import.keepProvenance}</option>
                <option value="human">human</option>
                <option value="reckon">reckon</option>
                <option value="agentspace">agentspace</option>
                <option value="dreamteam">dreamteam</option>
                <option value="import">import</option>
              </select>
            </HelpTip>
            <HelpTip action="import-skip-conflicts">
              <label className="flex items-center gap-2 text-sm">
                <input
                  data-testid="import-skip-conflicts"
                  type="checkbox"
                  checked={skipConflicts}
                  onChange={(e) => setSkipConflicts(e.target.checked)}
                />
                {STR.import.skipConflicts}
              </label>
            </HelpTip>
            <HelpTip action="import-run">
              <button
                type="button"
                data-testid="import-run"
                className="rounded-sf bg-accent px-3 py-1.5 text-sm text-accent-fg disabled:opacity-50"
                disabled={!canRun}
                onClick={() => void onRun()}
              >
                {STR.import.run}
              </button>
            </HelpTip>
          </div>

          <ul data-testid="import-candidates" className="space-y-2">
            {preview.candidates.map((c) => (
              <li
                key={c.id}
                data-testid="import-candidate"
                data-id={c.id}
                className="rounded-sf border border-line bg-surface px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <HelpTip action="candidate-select">
                    <input
                      data-testid="candidate-select"
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={(e) => toggleOne(c.id, e.target.checked)}
                    />
                  </HelpTip>
                  <span className="font-mono text-xs">{c.type}</span>
                  <span className="font-medium" translate="no">
                    {c.name}
                  </span>
                  <span className="text-muted">{STR.flow.import.filesCount(c.files.length)}</span>
                  <span className="rounded-sf bg-surface-2 px-2 py-0.5 text-xs">
                    {dryRunLabel(c)}
                  </span>
                </div>
                {c.dry_run.errors.length > 0 ? (
                  <div className="mt-2">
                    <IssueList
                      issues={c.dry_run.errors.map((e) => ({
                        code: e.code,
                        message: e.message,
                        path: e.path,
                      }))}
                      level="error"
                      testId={`import-errors-${c.id}`}
                    />
                  </div>
                ) : null}
                {c.dry_run.warnings.length > 0 ? (
                  <div className="mt-2">
                    <IssueList
                      issues={c.dry_run.warnings.map((w) => ({
                        code: w.code,
                        message: w.message,
                        path: w.path,
                      }))}
                      level="warning"
                      testId={`import-warnings-${c.id}`}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {preview.skipped.length > 0 ? (
            <div
              data-testid="import-skipped"
              className="rounded-sf border border-line bg-surface-2 px-3 py-2 text-sm text-muted"
            >
              <div className="mb-1 font-medium text-ink-2">{STR.import.skipped}</div>
              <ul className="space-y-0.5 font-mono text-xs">
                {preview.skipped.map((s: ImportSkipped) => (
                  <li key={s.path}>
                    {s.path} —{" "}
                    <span className="font-sans">{pick(STR.flow.import.skipReasons, s.reason)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {results ? (
        <ul data-testid="import-results" className="space-y-2">
          {results.map((r) => (
            <li
              key={r.id}
              data-testid="import-result"
              data-status={r.status}
              data-id={r.id}
              className="rounded-sf border border-line bg-surface px-3 py-2 text-sm"
            >
              <span className="text-xs">{pick(STR.flow.import.resultStatus, r.status)}</span>{" "}
              <span className="font-medium" translate="no">
                {r.id}
              </span>
              {r.status === "created" ? (
                <>
                  {" "}
                  <Link className="text-accent underline" to={`/artifacts/${r.type}/${r.name}`}>
                    {r.version ?? STR.flow.import.open}
                  </Link>
                </>
              ) : null}
              {r.reason ? (
                <span className="ml-2 text-muted">{pick(STR.flow.import.reasons, r.reason)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
