import { McpServerCard } from "../../components/McpServerCard.tsx";
import { ReplacementPanel } from "../../components/ReplacementPanel.tsx";
import { AvailabilityPanel } from "../../components/AvailabilityPanel.tsx";
import { OverlaysPanel } from "../../components/OverlaysPanel.tsx";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getFileText } from "../../api/client.ts";
import type { ArtifactSummary, VersionDetail } from "../../api/types.ts";
import { Markdown } from "../../components/Markdown.tsx";
import { CodeView } from "../../components/CodeView.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import { Tag } from "../../components/Tag.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { primaryFile, isTextPath } from "../../lib/markdown.ts";
import { shortDigest } from "../../lib/format.ts";
import { STR } from "../../lib/strings.ts";
import { formatDateTime } from "../../i18n/index.ts";
import { MetricsPanel } from "../../components/MetricsPanel.tsx";
import { AgentsSection } from "../../components/AgentsSection.tsx";

type Props = {
  artifact: ArtifactSummary;
  version: VersionDetail;
};

function settingsJsonPath(artifact: ArtifactSummary, version: VersionDetail): string | null {
  const exact = `settings/${artifact.name}/settings.json`;
  const hit = version.files.find((f) => f.path === exact);
  if (hit) return hit.path;
  return version.files.find((f) => /(^|\/)settings\.json$/i.test(f.path))?.path ?? null;
}

type FileText = Awaited<ReturnType<typeof getFileText>>;

function settingsScope(artifact: ArtifactSummary, version: VersionDetail): string | null {
  return artifact.type === "settings" &&
    version.frontmatter &&
    typeof version.frontmatter.scope === "string"
    ? version.frontmatter.scope
    : null;
}

/** Pretty-printed settings.json (raw text when it is not valid JSON). */
function formatSettingsJson(raw: string): string {
  let settingsFormatted = raw;
  if (settingsFormatted) {
    try {
      settingsFormatted = `${JSON.stringify(JSON.parse(settingsFormatted), null, 2)}\n`;
    } catch {
      /* keep raw */
    }
  }
  return settingsFormatted;
}

/** Primary file of the version: markdown, code/text, or just its path. */
function MainFileView({
  mainPath,
  fileQ,
}: {
  mainPath: string | null;
  fileQ: UseQueryResult<FileText>;
}) {
  const isMd = !!mainPath && mainPath.endsWith(".md");
  const isJson = !!mainPath && mainPath.endsWith(".json");
  return !mainPath ? (
    <p className="text-sm text-muted">{STR.detail.emptyFiles}</p>
  ) : fileQ.isError ? (
    <ErrorState onRetry={() => void fileQ.refetch()} />
  ) : fileQ.isLoading ? (
    <Skeleton className="h-40" />
  ) : isMd ? (
    <div translate="no">
      <Markdown source={fileQ.data ?? ""} />
    </div>
  ) : isJson || isTextPath(mainPath) ? (
    <CodeView text={fileQ.data ?? ""} />
  ) : (
    <p className="text-sm text-muted" translate="no">
      {mainPath}
    </p>
  );
}

function SettingsSection({
  scope,
  settingsQ,
  settingsFormatted,
}: {
  scope: string | null;
  settingsQ: UseQueryResult<FileText>;
  settingsFormatted: string;
}) {
  return (
    <section className="space-y-4 rounded-sf border border-line bg-surface p-4">
      <HelpTip action="settings-scope">
        <div>
          <div className="text-xs uppercase text-muted">{STR.art.overview.recommendedScope}</div>
          <p data-testid="settings-scope" className="mt-1 font-mono text-sm">
            {scope ?? "project"}
          </p>
        </div>
      </HelpTip>
      <HelpTip action="settings-json">
        <div>
          <div className="mb-2 text-xs uppercase text-muted">
            <code translate="no">settings.json</code>
          </div>
          {settingsQ.isLoading ? (
            <Skeleton className="h-32" />
          ) : settingsQ.isError ? (
            <ErrorState onRetry={() => void settingsQ.refetch()} />
          ) : (
            <div data-testid="settings-json">
              <CodeView text={settingsFormatted} />
            </div>
          )}
        </div>
      </HelpTip>
    </section>
  );
}

function OverviewMeta({ artifact, version }: Props) {
  return (
    <aside
      data-testid="overview-meta"
      className="space-y-4 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <div>
        <div className="text-xs uppercase text-muted">{STR.detail.description}</div>
        <p className="mt-1 text-ink-2" translate="no">
          {version.description || artifact.description}
        </p>
      </div>
      {version.tags.length > 0 ? (
        <div>
          <div className="text-xs uppercase text-muted">{STR.detail.tags}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {version.tags.map((t) => (
              <Tag key={t} tag={t} to={`/artifacts?tag=${encodeURIComponent(t)}`} />
            ))}
          </div>
        </div>
      ) : null}
      <div>
        <div className="text-xs uppercase text-muted">{STR.detail.latest}</div>
        <p className="mt-1 font-mono">{artifact.latest_version}</p>
      </div>
      <div data-testid="meta-downloads">
        <div className="text-xs uppercase text-muted">{STR.detail.downloads}</div>
        <p className="mt-1">{artifact.download_count ?? 0}</p>
      </div>
      <div>
        <div className="text-xs uppercase text-muted">{STR.detail.digest}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono">{shortDigest(version.digest)}</span>
          <CopyButton value={version.digest} />
        </div>
      </div>
      <div data-testid="meta-published-by">
        <div className="text-xs uppercase text-muted">{STR.detail.publishedBy}</div>
        <p className="mt-1">
          <span translate="no">{version.published_by}</span>
          <span className="text-muted"> - {formatDateTime(version.published_at)}</span>
        </p>
      </div>
      <div data-testid="meta-provenance">
        <div className="text-xs uppercase text-muted">{STR.detail.provenance}</div>
        <p className="mt-1" translate="no">
          {version.provenance.source}
          {version.provenance.ref ? ` / ${version.provenance.ref}` : ""}
        </p>
      </div>
      {version.model_compat.length > 0 ? (
        <div>
          <div className="text-xs uppercase text-muted">{STR.detail.modelCompat}</div>
          <p className="mt-1 font-mono text-xs">{version.model_compat.join(", ")}</p>
        </div>
      ) : null}
      {version.changelog ? (
        <div>
          <div className="text-xs uppercase text-muted">{STR.detail.changelog}</div>
          <p className="mt-1 text-ink-2" translate="no">
            {version.changelog}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

export function Overview({ artifact, version }: Props) {
  const mainPath = primaryFile(artifact.type, artifact.name, version.files);
  const fileQ = useQuery({
    queryKey: ["file", artifact.type, artifact.name, version.version, mainPath],
    queryFn: () => getFileText(artifact.type, artifact.name, version.version, mainPath!),
    enabled: !!mainPath && isTextPath(mainPath),
    staleTime: 30_000,
  });

  const settingsPath = artifact.type === "settings" ? settingsJsonPath(artifact, version) : null;
  const settingsQ = useQuery({
    queryKey: [
      "file",
      artifact.type,
      artifact.name,
      version.version,
      settingsPath,
      "settings-json",
    ],
    queryFn: () => getFileText(artifact.type, artifact.name, version.version, settingsPath!),
    enabled: !!settingsPath,
    staleTime: 30_000,
  });

  const scope = settingsScope(artifact, version);
  const settingsFormatted = formatSettingsJson(settingsQ.data ?? "");

  return (
    <div className="space-y-6">
      <div data-testid="overview-markdown" className="rounded-sf border border-line bg-surface p-4">
        <MainFileView mainPath={mainPath} fileQ={fileQ} />
      </div>

      <ReplacementPanel artifact={artifact} />
      <AvailabilityPanel type={artifact.type} name={artifact.name} />
      <OverlaysPanel type={artifact.type} name={artifact.name} />

      {artifact.type === "plugin" && version.components && version.components.length > 0 ? (
        <section
          data-testid="plugin-components"
          className="rounded-sf border border-line bg-surface p-4"
        >
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">
            {STR.art.overview.components}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {version.components.map((c) => (
              <li
                key={c.type + ":" + c.name + ":" + c.path}
                data-testid="plugin-component"
                data-type={c.type}
                data-name={c.name}
                className="rounded-sf border border-line px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-muted">{c.type}</span>{" "}
                <span className="font-medium text-ink" translate="no">
                  {c.name}
                </span>
                <div className="font-mono text-xs text-muted">{c.path}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {artifact.type === "settings" ? (
        <SettingsSection
          scope={scope}
          settingsQ={settingsQ}
          settingsFormatted={settingsFormatted}
        />
      ) : null}

      <McpServerCard type={artifact.type} name={artifact.name} version={version.version} />

      <AgentsSection artifact={artifact} />

      <MetricsPanel type={artifact.type} name={artifact.name} />

      <OverviewMeta artifact={artifact} version={version} />
    </div>
  );
}
