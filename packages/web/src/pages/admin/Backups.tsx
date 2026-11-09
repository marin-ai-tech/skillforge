import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createBackup, deleteBackup, listBackups } from "../../api/client.ts";
import type { BackupListItem } from "../../api/types.ts";
import { RequireUser } from "../../components/RequireUser.tsx";
import { RelativeTime } from "../../components/RelativeTime.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { HelpTip } from "../../components/HelpTip.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { formatBytes } from "../../lib/format.ts";
import { STR } from "../../lib/strings.ts";
import { errorText } from "../../i18n/index.ts";

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    const text = errorText(err);
    return text && text !== err.error ? `${err.error}: ${text}` : err.error;
  }
  return errorText(err);
}

/** Path of the newest archive inside the backups dir (with the dir's own path separator). */
function restoreArchivePath(backupsDir: string, newest: string | null): string {
  const separator = backupsDir.includes("\\") ? "\\" : "/";
  return backupsDir ? `${backupsDir}${separator}${newest ?? ""}` : (newest ?? "");
}

function BackupsPage() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["backups"],
    queryFn: listBackups,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);

  useEffect(() => {
    document.title = STR.adm.backups.docTitle;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const createMut = useMutation({
    mutationFn: createBackup,
    onSuccess: async (backup) => {
      setError(null);
      setNotice(`${STR.backups.noticeCreated} ${backup.name}`);
      await queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => setError(formatError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => deleteBackup(name),
    onSuccess: async () => {
      setError(null);
      setNotice(STR.backups.noticeDeleted);
      setDeleteName(null);
      await queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => {
      setError(formatError(err));
      setDeleteName(null);
    },
  });

  const items: BackupListItem[] = listQuery.data?.items ?? [];
  const newest = items[0]?.name ?? null;
  const backupsDir = listQuery.data?.dir ?? "";
  const archivePath = restoreArchivePath(backupsDir, newest);

  return (
    <div className="space-y-6">
      <PageHeader title={STR.backups.title} topic="pages/admin-backups" />

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

      <div className="flex flex-wrap items-center gap-3">
        <HelpTip action="backup-create">
          <button
            type="button"
            data-testid="backup-create"
            disabled={createMut.isPending}
            className="rounded-sf bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            onClick={() => {
              setError(null);
              createMut.mutate();
            }}
          >
            {createMut.isPending ? STR.backups.creating : STR.backups.create}
          </button>
        </HelpTip>
      </div>

      {newest ? (
        <div
          data-testid="backups-restore-hint"
          className="rounded-sf border border-line bg-surface px-3 py-2 text-sm text-ink-2"
        >
          {STR.backups.restoreHintPrefix}{" "}
          <code translate="no" className="rounded-sf bg-surface-2 px-1 py-0.5 text-xs">
            tar -xzf {archivePath} -C /path/to/empty-data-dir
          </code>
        </div>
      ) : null}

      {items.length === 0 && !listQuery.isLoading ? (
        <div
          data-testid="backups-empty"
          className="rounded-sf border border-dashed border-line px-4 py-8 text-center text-sm text-muted"
        >
          {STR.backups.empty}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-sf border border-line">
          <table data-testid="backups-table" className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{STR.backups.colName}</th>
                <th className="px-3 py-2 font-medium">{STR.backups.colSize}</th>
                <th className="px-3 py-2 font-medium">{STR.backups.colCreated}</th>
                <th className="px-3 py-2 font-medium">{STR.backups.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.name} data-testid="backup-row" className="border-t border-line">
                  <td className="px-3 py-2 font-medium" translate="no">
                    {b.name}
                  </td>
                  <td className="px-3 py-2">{formatBytes(b.size)}</td>
                  <td className="px-3 py-2">
                    <RelativeTime iso={b.created_at} />
                  </td>
                  <td className="px-3 py-2 space-x-2">
                    <HelpTip action="backup-download">
                      <a
                        data-testid="backup-download"
                        href={`/api/v1/admin/backups/${encodeURIComponent(b.name)}`}
                        className="rounded-sf border border-line px-2 py-1 text-xs text-ink-2 no-underline hover:bg-surface-2"
                      >
                        {STR.backups.download}
                      </a>
                    </HelpTip>
                    <HelpTip action="backup-delete">
                      <button
                        type="button"
                        data-testid="backup-delete"
                        className="rounded-sf border border-line px-2 py-1 text-xs hover:bg-surface-2"
                        onClick={() => setDeleteName(b.name)}
                      >
                        {STR.backups.delete}
                      </button>
                    </HelpTip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={deleteName != null}
        title={STR.backups.deleteTitle}
        body={deleteName ? STR.backups.deleteBody(deleteName) : ""}
        helpText={STR.backups.deleteHelp}
        helpTopic="actions/backups/backup-delete"
        confirmLabel={STR.backups.delete}
        onConfirm={() => {
          if (deleteName) deleteMut.mutate(deleteName);
        }}
        onCancel={() => setDeleteName(null)}
      />
    </div>
  );
}

export function Backups() {
  return <RequireUser requireAdmin>{() => <BackupsPage />}</RequireUser>;
}
