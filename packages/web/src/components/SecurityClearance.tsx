import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { removeSecurityClearance, setSecurityClearance } from "../api/client.ts";
import type { ArtifactSummary, SecurityClearance, VersionDetail } from "../api/types.ts";
import { errorText, formatDateTime } from "../i18n/index.ts";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { HelpTip } from "./HelpTip.tsx";

type ClearanceState = "none" | "current" | "stale";

function stateOf(clearance: SecurityClearance | null | undefined): ClearanceState {
  if (!clearance) return "none";
  return clearance.current ? "current" : "stale";
}

function statusText(
  state: ClearanceState,
  clearance: SecurityClearance | null | undefined,
): string {
  const t = STR.art.quality.clearance;
  if (state === "current" && clearance) {
    return t.current(clearance.cleared_by, formatDateTime(clearance.cleared_at), clearance.reason);
  }
  if (state === "stale" && clearance) return t.stale(clearance.cleared_by);
  return t.none;
}

function canReview(
  username: string | undefined,
  role: "viewer" | "contributor" | "reviewer" | "admin" | undefined,
  publishedBy: string,
): boolean {
  if (!roleAtLeast(role, "reviewer")) return false;
  return username !== publishedBy || role === "admin";
}

type Ids = { type: string; name: string; version: string };

function ClearanceForm({ ids, onApplied }: { ids: Ids; onApplied: () => void }) {
  const queryClient = useQueryClient();
  const hintId = "security-clearance-reason-hint";
  const errorId = "security-clearance-error";
  const fieldId = "security-clearance-reason";
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = STR.art.quality.clearance;
  const empty = reason.trim() === "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (empty || sending) return;
    setSending(true);
    setError(null);
    try {
      await setSecurityClearance(ids.type, ids.name, ids.version, reason.trim());
      await queryClient.invalidateQueries({
        queryKey: ["version", ids.type, ids.name, ids.version],
      });
      onApplied();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form data-testid="security-clearance-form" className="space-y-2" onSubmit={onSubmit}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {t.reasonLabel}
      </label>
      <p id={hintId} className="text-xs text-muted">
        {t.reasonHint}
      </p>
      <textarea
        id={fieldId}
        data-testid="security-clearance-reason"
        className="w-full rounded-sf border border-line bg-surface px-3 py-2 text-sm text-ink aria-invalid:border-danger"
        rows={3}
        maxLength={500}
        value={reason}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(ev) => setReason(ev.target.value)}
      />
      {error ? (
        <p
          id={errorId}
          data-testid="security-clearance-error"
          role="alert"
          className="text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      <HelpTip action="security-clearance-form">
        <button
          type="submit"
          data-testid="security-clearance-submit"
          className="min-h-6 min-w-6 rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
          disabled={empty || sending}
          aria-busy={sending ? "true" : undefined}
        >
          {t.submit}
        </button>
      </HelpTip>
    </form>
  );
}

function RemoveMark({ ids, onRemoved }: { ids: Ids; onRemoved: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const t = STR.art.quality.clearance;

  async function confirm() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await removeSecurityClearance(ids.type, ids.name, ids.version);
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ["version", ids.type, ids.name, ids.version],
      });
      onRemoved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <HelpTip action="security-clearance-remove">
        <button
          type="button"
          data-testid="security-clearance-remove"
          className="min-h-6 min-w-6 rounded-sf border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
          disabled={sending}
          onClick={() => setOpen(true)}
        >
          {t.remove}
        </button>
      </HelpTip>
      {error && !open ? (
        <p data-testid="security-clearance-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        title={t.removeTitle}
        body={t.removeBody}
        helpText={t.removeHelp}
        helpTopic="actions/quality/security-clearance-remove"
        confirmLabel={t.remove}
        busy={sending}
        onCancel={() => {
          if (!sendingRef.current) setOpen(false);
        }}
        onConfirm={() => void confirm()}
      >
        {error ? (
          <p
            data-testid="security-clearance-error"
            role="alert"
            className="mt-2 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

/** Reviewer mark for failed security findings: current, stale, or none. */
export function SecurityClearanceBlock({
  artifact,
  version,
}: {
  artifact: ArtifactSummary;
  version: VersionDetail;
}) {
  const me = useMe();
  const blockRef = useRef<HTMLDivElement>(null);
  const clearance = version.security_clearance ?? null;
  const state = stateOf(clearance);
  const username = me.data?.username;
  const role = me.data?.role;
  const reviewer = canReview(username, role, version.published_by);
  const canRemove = roleAtLeast(role, "reviewer");
  const authorNote = username === version.published_by && role !== "admin" && state === "none";
  const showForm = reviewer && (state === "none" || state === "stale");
  const showRemove = canRemove && state === "current";
  const ids = { type: artifact.type, name: artifact.name, version: version.version };
  const focusState = () => {
    const el = blockRef.current;
    if (!el) return;
    const focus = el.focus.bind(el) as (
      options?: FocusOptions & { focusVisible?: boolean },
    ) => void;
    focus({ focusVisible: true });
  };

  return (
    <div
      ref={blockRef}
      tabIndex={-1}
      data-testid="security-clearance"
      data-state={state}
      className="space-y-2 rounded-sf border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2 focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    >
      <p>{statusText(state, clearance)}</p>
      {authorNote ? (
        <p data-testid="security-clearance-author-note">{STR.art.quality.clearance.authorNote}</p>
      ) : null}
      {showForm ? <ClearanceForm ids={ids} onApplied={focusState} /> : null}
      {showRemove ? <RemoveMark ids={ids} onRemoved={focusState} /> : null}
    </div>
  );
}
