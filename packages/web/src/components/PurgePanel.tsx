import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, purgeArtifact, type PurgeResult } from "../api/client.ts";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

/** Outcome of a completed purge: deleted/failed/shared blobs and affected backups. */
function PurgeResultView({ result }: { result: PurgeResult }) {
  const t = STR.art.purge;
  return (
    <div className="space-y-2 text-sm">
      <p>{t.result(result.blobs_deleted, result.blobs_failed?.length ?? 0)}</p>
      <p>{t.sharedBlobs}</p>
      <ul>
        {result.blobs_shared?.map((b) => (
          <li key={b.sha256} className="font-mono">
            {b.sha256}: {b.versions.join(", ")}
          </li>
        ))}
      </ul>
      <p>{t.backupsPredating}</p>
      <ul>
        {result.backups_predating?.map((b) => (
          <li key={b} className="font-mono">
            {b}
          </li>
        ))}
      </ul>
      <p>{t.backupsDeleted(result.backups_deleted?.length ?? 0)}</p>
    </div>
  );
}

export function PurgePanel({
  type,
  name,
  version,
  onSuccess,
  initiallyOpen = false,
  hideTrigger = false,
  onClose,
}: {
  type: string;
  name: string;
  version: string | null;
  onSuccess?: () => void;
  initiallyOpen?: boolean;
  hideTrigger?: boolean;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(initiallyOpen);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleteBackups, setDeleteBackups] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PurgeResult | null>(null);
  const reference = `${type}/${name}${version ? `@${version}` : ""}`;
  function close() {
    setOpen(false);
    setReason("");
    setConfirm("");
    setDeleteBackups(false);
    setResult(null);
    setError("");
    onClose?.();
  }
  async function submit() {
    if (busy || reason.length < 10 || reason.length > 500 || confirm !== reference) return;
    setBusy(true);
    setError("");
    try {
      const data = await purgeArtifact(type, name, version, {
        reason,
        confirm,
        delete_backups: deleteBackups,
      });
      setResult(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["artifact", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["versions", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["version", type, name] }),
        queryClient.invalidateQueries({ queryKey: ["audit", type, name] }),
      ]);
      onSuccess?.();
    } catch (err) {
      const code = err instanceof ApiError ? err.error : "request_failed";
      const t = STR.art.purge.errors;
      setError(
        (
          {
            reason_required: t.reasonRequired,
            confirm_mismatch: t.confirmMismatch,
            forbidden: t.forbidden,
            purged: t.purged,
          } as Record<string, string>
        )[code] ?? errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <span data-testid="purge-panel">
      {!hideTrigger && (
        <HelpTip action={version ? "purge-version" : "purge-artifact"}>
          <button
            type="button"
            data-testid={version ? `purge-version-${version}` : "purge-artifact"}
            className="rounded-sf border border-danger px-2 py-1 text-xs text-danger"
            onClick={() => setOpen(true)}
          >
            {version ? STR.art.purge.purgeVersion : STR.art.purge.purgeArtifact}
          </button>
        </HelpTip>
      )}
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${STR.art.purge.title} ${reference}`}
            className="w-full max-w-lg space-y-3 rounded-sf border border-line bg-surface p-5 shadow-lg"
          >
            <h2 className="font-semibold">
              {STR.art.purge.title} <span translate="no">{reference}</span>
            </h2>
            {result ? (
              <PurgeResultView result={result} />
            ) : (
              <>
                <p className="text-sm text-danger">{STR.art.purge.warning}</p>
                <label className="block text-sm">
                  {STR.art.purge.reason}
                  <textarea
                    data-testid="purge-reason"
                    className="mt-1 w-full rounded-sf border border-line bg-bg p-2"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  {STR.art.purge.typeBefore} <span translate="no">{reference}</span>{" "}
                  {STR.art.purge.typeAfter}
                  <input
                    data-testid="purge-confirm-input"
                    className="mt-1 w-full rounded-sf border border-line bg-bg p-2"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid="purge-delete-backups"
                    checked={deleteBackups}
                    onChange={(e) => setDeleteBackups(e.target.checked)}
                  />
                  {STR.art.purge.deleteBackups}
                </label>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  data-testid="purge-submit"
                  disabled={
                    busy || reason.length < 10 || reason.length > 500 || confirm !== reference
                  }
                  className="rounded-sf bg-danger px-3 py-1.5 text-white disabled:opacity-50"
                  onClick={() => void submit()}
                >
                  {STR.art.purge.submit}
                </button>
              </>
            )}
            <button
              type="button"
              className="ml-2 rounded-sf border border-line px-3 py-1.5 text-sm"
              onClick={close}
            >
              {result ? STR.art.common.close : STR.art.common.cancel}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
