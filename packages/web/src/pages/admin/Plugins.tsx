import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, listAdminPlugins, patchAdminPlugin } from "../../api/client.ts";
import type { AdminPluginItem } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { STR } from "../../lib/strings.ts";
import { apiErrorMessage, errorText } from "../../i18n/index.ts";

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const text = errorText(err);
    return text && text !== err.error ? `${err.error}: ${text}` : err.error;
  }
  return errorText(err);
}

/** Client-side check failed: same text as the server's `config_invalid`. */
function configInvalid(): string {
  return `config_invalid: ${apiErrorMessage("config_invalid")}`;
}

function PluginsPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["admin-plugins"],
    queryFn: listAdminPlugins,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    document.title = STR.adm.plugins.docTitle;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!listQuery.data) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const item of listQuery.data.items) {
        if (next[item.name] === undefined) {
          next[item.name] = JSON.stringify(item.config, null, 2);
        }
      }
      return next;
    });
  }, [listQuery.data]);

  const patchMut = useMutation({
    mutationFn: (args: {
      name: string;
      body: { enabled?: boolean; config?: Record<string, unknown> };
    }) => patchAdminPlugin(args.name, args.body),
    onSuccess: async () => {
      setError(null);
      setNotice(STR.adm.plugins.saved);
      await queryClient.invalidateQueries({ queryKey: ["admin-plugins"] });
    },
    onError: (err) => setError(formatError(err)),
  });

  const items: AdminPluginItem[] = listQuery.data?.items ?? [];
  const pluginsDir = listQuery.data?.dir ?? "";

  return (
    <div className="space-y-6">
      <PageHeader title={STR.adm.plugins.title} topic="pages/admin-plugins" />

      {error ? (
        <div
          data-testid="admin-error"
          className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          data-testid="admin-notice"
          className="rounded-sf bg-accent/10 px-2 py-1.5 text-sm text-accent"
        >
          {notice}
        </div>
      ) : null}

      <p data-testid="plugins-dir" className="text-sm text-ink-2">
        {STR.adm.plugins.dir}{" "}
        <code translate="no" className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
          {pluginsDir}
        </code>
      </p>

      <div className="rounded-sf border border-line bg-surface px-3 py-2 text-sm text-ink-2">
        {STR.adm.plugins.warning}
      </div>

      {items.length === 0 && !listQuery.isLoading ? (
        <p data-testid="plugins-empty" className="text-sm text-muted">
          {STR.adm.plugins.empty}
        </p>
      ) : (
        <div data-testid="plugins-table" className="space-y-4">
          {items.map((item) => (
            <div
              key={item.name}
              data-testid="plugin-row"
              className="rounded-sf border border-line bg-surface p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink" translate="no">
                    {item.name} <span className="text-sm text-muted">{item.version}</span>
                  </div>
                  <p className="text-sm text-ink-2" translate="no">
                    {item.description}
                  </p>
                  <p className="text-xs text-muted">
                    {STR.adm.plugins.contribution(
                      item.contributions.routes,
                      item.contributions.nav,
                      item.contributions.tabs,
                    )}
                    {item.contributions.events.length ? (
                      <>
                        , {STR.adm.plugins.events}{" "}
                        <span translate="no">{item.contributions.events.join(", ")}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <span
                  data-testid="plugin-status"
                  className="rounded-sf border border-line px-2 py-0.5 text-xs"
                >
                  {STR.adm.plugins.status[item.status] ?? item.status}
                </span>
                {item.restart_required ? (
                  <span
                    data-testid="plugin-restart-required"
                    className="rounded-sf bg-accent/10 px-2 py-0.5 text-xs text-accent"
                  >
                    {STR.adm.plugins.restartRequired}
                  </span>
                ) : null}
                <HelpTip action="plugin-toggle">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      data-testid="plugin-toggle"
                      checked={item.enabled}
                      onChange={(e) => {
                        setError(null);
                        patchMut.mutate({ name: item.name, body: { enabled: e.target.checked } });
                      }}
                    />
                    {STR.adm.plugins.enabled}
                  </label>
                </HelpTip>
              </div>
              {item.error ? (
                <p data-testid="plugin-error" className="text-sm text-danger" translate="no">
                  {item.error}
                </p>
              ) : null}
              <div className="space-y-2">
                <label className="block text-xs font-medium text-ink-2">
                  {STR.adm.plugins.config}
                </label>
                <textarea
                  data-testid="plugin-config"
                  className="w-full min-h-[96px] rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-xs text-ink"
                  value={drafts[item.name] ?? JSON.stringify(item.config, null, 2)}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [item.name]: e.target.value,
                    }))
                  }
                />
                <HelpTip action="plugin-config-save">
                  <button
                    type="button"
                    data-testid="plugin-config-save"
                    className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    disabled={patchMut.isPending}
                    onClick={() => {
                      setError(null);
                      try {
                        const parsed = JSON.parse(drafts[item.name] ?? "{}") as unknown;
                        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                          setError(configInvalid());
                          return;
                        }
                        patchMut.mutate({
                          name: item.name,
                          body: { config: parsed as Record<string, unknown> },
                        });
                      } catch {
                        setError(configInvalid());
                      }
                    }}
                  >
                    {STR.adm.plugins.saveConfig}
                  </button>
                </HelpTip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Plugins() {
  return <RequireUser requireAdmin>{() => <PluginsPage />}</RequireUser>;
}
