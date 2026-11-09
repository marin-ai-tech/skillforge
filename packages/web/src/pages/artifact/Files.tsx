import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fileUrl, getFileText } from "../../api/client.ts";
import type { ArtifactSummary, VersionDetail } from "../../api/types.ts";
import { CodeView } from "../../components/CodeView.tsx";
import { FileTree } from "../../components/FileTree.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { isTextPath, primaryFile, splitFrontmatter } from "../../lib/markdown.ts";
import { STR } from "../../lib/strings.ts";

const MAX = 512 * 1024;

type Props = {
  artifact: ArtifactSummary;
  version: VersionDetail;
};

type ViewMode = "rendered" | "source";

function FrontmatterTable({ entries }: { entries: Array<[string, string]> }) {
  return (
    <table data-testid="file-frontmatter" className="w-full border-collapse text-sm">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-line align-top last:border-b-0">
            <th className="w-40 py-1 pr-3 text-left font-mono text-xs font-medium text-muted">
              {key}
            </th>
            <td className="whitespace-pre-wrap break-words py-1 font-mono text-xs text-ink-2">
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ViewModeSwitch({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const button = (m: ViewMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={
        mode === m
          ? "rounded-sf border border-accent bg-accent/15 px-3 py-1 text-xs font-medium text-accent"
          : "rounded-sf border border-line px-3 py-1 text-xs text-muted hover:text-ink"
      }
    >
      {label}
    </button>
  );
  return (
    <div
      data-testid="file-view-mode"
      role="group"
      aria-label={STR.art.files.viewMode}
      className="flex gap-2"
    >
      {button("rendered", STR.art.files.rendered)}
      {button("source", STR.art.files.source)}
    </div>
  );
}

/** A markdown file: rendered body with a frontmatter table, or the exact source. */
function MarkdownFileView({
  text,
  mode,
  onMode,
}: {
  text: string;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
}) {
  const { frontmatter, body } = splitFrontmatter(text);
  const showSource = mode === "source" || (frontmatter !== null && !frontmatter.ok);
  return (
    <div className="space-y-4">
      <HelpTip action="file-view-mode">
        <ViewModeSwitch mode={mode} onChange={onMode} />
      </HelpTip>
      {showSource ? (
        <>
          {mode === "rendered" ? (
            <p className="text-sm text-muted">{STR.art.files.frontmatterUnreadable}</p>
          ) : null}
          <CodeView text={text} />
        </>
      ) : (
        <>
          {frontmatter && frontmatter.entries.length > 0 ? (
            <FrontmatterTable entries={frontmatter.entries} />
          ) : null}
          <div translate="no">
            <Markdown source={body} />
          </div>
        </>
      )}
    </div>
  );
}

/** The selected file: download link, loading/error state, rendered markdown, or code. */
function FileBody({
  path,
  tooLarge,
  downloadHref,
  fileQ,
  mode,
  onMode,
}: {
  path: string | null;
  tooLarge: boolean;
  downloadHref: string;
  fileQ: UseQueryResult<string>;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
}) {
  if (!path) return <p className="text-sm text-muted">{STR.art.files.selectFile}</p>;
  if (tooLarge || !isTextPath(path)) {
    return (
      <div className="space-y-2 text-sm">
        <p translate={tooLarge ? undefined : "no"}>{tooLarge ? STR.detail.tooLarge : path}</p>
        <a className="text-accent underline" href={downloadHref}>
          {STR.detail.download}
        </a>
      </div>
    );
  }
  if (fileQ.isError) return <ErrorState onRetry={() => void fileQ.refetch()} />;
  if (fileQ.isLoading) return <Skeleton className="h-40" />;
  const text = fileQ.data ?? "";
  if (/\.md$/i.test(path)) return <MarkdownFileView text={text} mode={mode} onMode={onMode} />;
  return <CodeView text={text} />;
}

export function Files({ artifact, version }: Props) {
  const [params, setParams] = useSearchParams();
  const defaultPath = primaryFile(artifact.type, artifact.name, version.files);
  const selected = params.get("file") || defaultPath || "";

  useEffect(() => {
    if (!params.get("file") && defaultPath) {
      const sp = new URLSearchParams(params);
      sp.set("file", defaultPath);
      setParams(sp, { replace: true });
    }
  }, [defaultPath, params, setParams]);

  const entry = version.files.find((f) => f.path === selected);
  const tooLarge = entry ? entry.size > MAX : false;
  const canLoad = !!selected && !!entry && isTextPath(selected) && !tooLarge;

  const fileQ = useQuery({
    queryKey: ["file", artifact.type, artifact.name, version.version, selected],
    queryFn: () => getFileText(artifact.type, artifact.name, version.version, selected),
    enabled: canLoad,
    staleTime: 30_000,
  });

  const mode: ViewMode = params.get("view") === "source" ? "source" : "rendered";

  function setMode(m: ViewMode) {
    const sp = new URLSearchParams(params);
    if (m === "source") sp.set("view", "source");
    else sp.delete("view");
    setParams(sp, { replace: true });
  }

  function selectFile(p: string) {
    const sp = new URLSearchParams(params);
    sp.set("file", p);
    setParams(sp);
  }

  if (version.files.length === 0) {
    return <EmptyState title={STR.detail.emptyFiles} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <FileTree
        entries={version.files}
        selected={selected}
        onSelect={selectFile}
        treeTestId="files-tree"
      />
      <div data-testid="file-viewer" className="rounded-sf border border-line bg-surface p-4">
        <FileBody
          path={entry ? selected : null}
          tooLarge={tooLarge}
          downloadHref={fileUrl(artifact.type, artifact.name, version.version, selected)}
          fileQ={fileQ}
          mode={mode}
          onMode={setMode}
        />
      </div>
    </div>
  );
}
