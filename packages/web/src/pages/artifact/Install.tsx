import { useState } from "react";
import { HelpTip } from "../../components/HelpTip.tsx";
import { CopyButton } from "../../components/CopyButton.tsx";
import type { ArtifactDetailResponse, RuntimeInstall } from "../../api/types.ts";
import { STR } from "../../lib/strings.ts";

type Props = {
  detail: ArtifactDetailResponse;
};

function RuntimeBlock({ runtimes }: { runtimes: RuntimeInstall[] }) {
  const [selected, setSelected] = useState(runtimes[0]?.runtime ?? "");
  const current = runtimes.find((r) => r.runtime === selected) ?? runtimes[0];
  if (!current) return null;
  return (
    <section
      data-testid="install-runtime"
      className="space-y-3 rounded-sf border border-line bg-surface p-4"
    >
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.install.runtimeTitle}
      </h3>
      <p className="text-sm text-ink-2">{STR.install.runtimeHint}</p>
      <HelpTip action="install-runtime-select">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          {STR.install.runtimeLabel}
          <select
            data-testid="install-runtime-select"
            className="rounded-sf border border-line bg-bg px-2 py-1 text-sm"
            value={current.runtime}
            onChange={(e) => setSelected(e.target.value)}
          >
            {runtimes.map((r) => (
              <option key={r.runtime} value={r.runtime}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </HelpTip>
      {current.supported && current.command ? (
        <HelpTip action="install-runtime-cmd">
          <div className="flex flex-wrap items-center gap-2">
            <code
              data-testid="install-runtime-cmd"
              className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs"
            >
              {current.command}
            </code>
            <CopyButton value={current.command} />
          </div>
        </HelpTip>
      ) : (
        <HelpTip action="install-runtime-unsupported">
          <p
            data-testid="install-runtime-unsupported"
            className="rounded-sf border border-line bg-bg px-3 py-2 text-sm text-ink-2"
          >
            {STR.install.runtimeUnsupported(current.label, current.reason ?? "")}
          </p>
        </HelpTip>
      )}
    </section>
  );
}

export function Install({ detail }: Props) {
  const { artifact, install } = detail;
  const isActive = artifact.status === "active";
  const downloads = artifact.download_count ?? 0;
  const isSettings = artifact.type === "settings";

  if (!install) {
    return (
      <div className="rounded-sf border border-line bg-surface p-4 text-sm text-muted">
        {STR.install.unavailable}
      </div>
    );
  }

  const marketplaceCmd = `/plugin marketplace add ${install.marketplace_url}`;
  const pluginCmd = `/plugin install ${install.plugin_name}@${install.marketplace_name}`;
  const settingsCli =
    install.cli ?? `skillforge settings apply settings/${artifact.name} --scope project`;

  return (
    <div className="space-y-6">
      {isSettings ? (
        <>
          {isActive ? null : (
            <div
              data-testid="install-not-active"
              className="rounded-sf border border-line bg-surface p-4 text-sm text-ink-2"
            >
              {STR.install.notActive}
            </div>
          )}
          <section className="space-y-3 rounded-sf border border-line bg-surface p-4">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
              {STR.art.install.settingsTitle}
            </h3>
            <p className="text-sm text-ink-2">{STR.art.install.settingsHint}</p>
            <HelpTip action="install-settings-cli">
              <div className="flex flex-wrap items-center gap-2">
                <code
                  data-testid="install-settings-cli"
                  className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs"
                >
                  {settingsCli}
                </code>
                <CopyButton value={settingsCli} />
              </div>
            </HelpTip>
          </section>
        </>
      ) : isActive ? (
        <section
          data-testid="install-claude-code"
          className="space-y-3 rounded-sf border border-line bg-surface p-4"
        >
          <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
            {STR.install.claudeCode}
          </h3>
          <p className="text-sm text-ink-2">{STR.install.claudeCodeHint}</p>
          <div className="space-y-2">
            <HelpTip action="install-marketplace-cmd">
              <div className="flex flex-wrap items-center gap-2">
                <code
                  data-testid="install-marketplace-cmd"
                  className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs"
                >
                  {marketplaceCmd}
                </code>
                <CopyButton value={marketplaceCmd} />
              </div>
            </HelpTip>
            <HelpTip action="install-plugin-cmd">
              <div className="flex flex-wrap items-center gap-2">
                <code
                  data-testid="install-plugin-cmd"
                  className="flex-1 rounded-sf border border-line bg-bg px-3 py-2 font-mono text-xs"
                >
                  {pluginCmd}
                </code>
                <CopyButton value={pluginCmd} />
              </div>
            </HelpTip>
          </div>
        </section>
      ) : (
        <div
          data-testid="install-not-active"
          className="rounded-sf border border-line bg-surface p-4 text-sm text-ink-2"
        >
          {STR.install.notActive}
        </div>
      )}

      {isActive && install.runtimes && install.runtimes.length > 0 ? (
        <RuntimeBlock key={`${artifact.type}/${artifact.name}`} runtimes={install.runtimes} />
      ) : null}

      <section className="space-y-3 rounded-sf border border-line bg-surface p-4">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
          {STR.install.downloadsTitle}
        </h3>
        <div className="flex flex-wrap gap-3">
          {isSettings ? null : (
            <HelpTip action="install-download-tgz">
              <a
                data-testid="install-download-tgz"
                href={install.tgz_url}
                className="inline-flex items-center rounded-sf border border-line px-3 py-2 text-sm text-accent no-underline hover:border-accent"
              >
                {STR.install.downloadTgz}
              </a>
            </HelpTip>
          )}
          <HelpTip action="install-download-zip">
            <a
              data-testid="install-download-zip"
              href={install.zip_url}
              className="inline-flex items-center rounded-sf border border-line px-3 py-2 text-sm text-accent no-underline hover:border-accent"
            >
              {STR.install.downloadZip}
            </a>
          </HelpTip>
        </div>
        <p data-testid="install-downloads" className="text-sm text-muted">
          {STR.install.downloadsCount(downloads)}
        </p>
      </section>
    </div>
  );
}
