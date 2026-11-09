import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMirror, checkMirror, deleteMirror, listMirrors } from "../api/client.ts";
import type { Mirror } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { errorText, formatDateTime } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";

/** Upstream mirrors (upstream-mirror): admins only, under the import source policy. */
export function MirrorsPanel({ role }: { role: string }) {
  return role === "admin" ? <MirrorsForm /> : null;
}

function reportLine(m: Mirror): string {
  const r = m.last_report;
  if (!r) return STR.import.mirrorNever;
  if (r.status === "quarantined")
    return STR.import.mirrorQuarantined(formatDateTime(r.ready_at ?? ""));
  if (r.status === "failed") return STR.import.mirrorFailed(r.error ?? "");
  return STR.import.mirrorReport(
    r.imported.length,
    r.updated.length,
    r.unchanged.length,
    r.failed.length,
  );
}

function MirrorRow({ m, onDone }: { m: Mirror; onDone: (text: string) => void }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["mirrors"] });
  const check = useMutation({
    mutationFn: () => checkMirror(m.id),
    onSuccess: refresh,
    onError: (e) => onDone(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteMirror(m.id),
    onSuccess: refresh,
    onError: (e) => onDone(errorText(e)),
  });
  return (
    <li data-testid="mirror-item" className="space-y-1 rounded-sf border border-line p-2">
      <div translate="no" className="break-all font-mono text-xs text-ink">
        {m.url}
        {m.ref ? ` @ ${m.ref}` : ""}
        {m.path ? ` : ${m.path}` : ""}
      </div>
      <div className="text-xs text-ink-2">
        {m.last_checked_at ? `${formatDateTime(m.last_checked_at)} · ` : ""}
        {reportLine(m)}
      </div>
      <div className="flex gap-2">
        <HelpTip action="mirror-check">
          <button
            type="button"
            data-testid="mirror-check"
            disabled={check.isPending}
            onClick={() => check.mutate()}
            className="rounded-sf border border-line px-2 py-1 text-xs disabled:opacity-50"
          >
            {STR.import.mirrorCheck}
          </button>
        </HelpTip>
        <HelpTip action="mirror-delete">
          <button
            type="button"
            data-testid="mirror-delete"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="rounded-sf border border-line px-2 py-1 text-xs text-danger disabled:opacity-50"
          >
            {STR.import.mirrorDelete}
          </button>
        </HelpTip>
      </div>
    </li>
  );
}

function MirrorsForm() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["mirrors"], queryFn: listMirrors });
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => addMirror({ url: url.trim() }),
    onSuccess: () => {
      setUrl("");
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["mirrors"] });
    },
    onError: (e) => setMessage(errorText(e)),
  });
  return (
    <details data-testid="mirrors" className="rounded-sf border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        {STR.import.mirrorsTitle}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-ink-2">{STR.import.mirrorsHint}</p>
        <ul className="space-y-2">
          {(list.data?.items ?? []).map((m) => (
            <MirrorRow key={m.id} m={m} onDone={setMessage} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <input
            data-testid="mirror-url"
            className="min-w-64 flex-1 rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-xs"
            placeholder={STR.import.mirrorUrlPlaceholder}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            translate="no"
          />
          <HelpTip action="mirror-add">
            <button
              type="button"
              data-testid="mirror-add"
              disabled={add.isPending || url.trim() === ""}
              onClick={() => add.mutate()}
              className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
            >
              {STR.import.mirrorAdd}
            </button>
          </HelpTip>
        </div>
        {message ? (
          <p data-testid="mirror-message" role="alert" className="text-danger">
            {message}
          </p>
        ) : null}
      </div>
    </details>
  );
}
