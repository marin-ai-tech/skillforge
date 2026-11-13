import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  addArtifactMaintainer,
  removeArtifactMaintainer,
  transferArtifactOwner,
} from "../api/client.ts";
import type { ArtifactSummary } from "../api/types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { useMe, roleAtLeast } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { Button } from "./Button.tsx";

type Props = {
  artifact: ArtifactSummary;
};

function humanOwnershipError(err: unknown): string {
  const t = STR.art.ownership.errors;
  if (!(err instanceof ApiError)) return STR.art.common.requestFailed;
  switch (err.error) {
    case "owner_invalid":
      return t.ownerInvalid;
    case "maintainer_invalid":
      return t.maintainerInvalid;
    case "forbidden":
      return t.forbidden;
    case "mcp_token_forbidden":
      return t.mcpForbidden;
    case "bad_request":
      return err.message && err.message !== err.error ? err.message : STR.art.common.invalidRequest;
    default:
      return err.message && err.message !== err.error
        ? `${err.error}: ${errorText(err)}`
        : err.error;
  }
}

/** Ownership panel is shown to admins and to the artifact's current owner. */
function canManageOwnership(
  username: string | undefined,
  role: Parameters<typeof roleAtLeast>[0],
  owner: string | null | undefined,
): boolean {
  const isAdmin = roleAtLeast(role, "admin");
  const isOwner = !!username && !!owner && username.toLowerCase() === owner.toLowerCase();
  return isAdmin || isOwner;
}

export function OwnershipPanel({ artifact }: Props) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [newOwner, setNewOwner] = useState("");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [maintainerName, setMaintainerName] = useState("");
  const [maintainerError, setMaintainerError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const showPanel = canManageOwnership(me.data?.username, me.data?.role, artifact.owner);
  const maintainers = artifact.maintainers ?? [];

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["artifact", artifact.type, artifact.name] }),
      queryClient.invalidateQueries({ queryKey: ["audit", artifact.type, artifact.name] }),
    ]);
  }

  const transferMut = useMutation({
    mutationFn: () =>
      transferArtifactOwner(artifact.type, artifact.name, {
        owner: newOwner.trim(),
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      setConfirmOpen(false);
      setNewOwner("");
      setReason("");
      setTransferError(null);
      await invalidate();
    },
    onError: (err: unknown) => {
      setConfirmOpen(false);
      setTransferError(humanOwnershipError(err));
    },
  });

  const addMut = useMutation({
    mutationFn: () => addArtifactMaintainer(artifact.type, artifact.name, maintainerName.trim()),
    onSuccess: async () => {
      setMaintainerName("");
      setMaintainerError(null);
      await invalidate();
    },
    onError: (err: unknown) => setMaintainerError(humanOwnershipError(err)),
  });

  const removeMut = useMutation({
    mutationFn: (u: string) => removeArtifactMaintainer(artifact.type, artifact.name, u),
    onSuccess: async () => {
      setRemoveError(null);
      await invalidate();
    },
    onError: (err: unknown) => setRemoveError(humanOwnershipError(err)),
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">{STR.art.ownership.owner}</span>
        <span data-testid="artifact-owner" className="font-mono font-medium text-ink">
          {artifact.owner || "—"}
        </span>
        <span className="text-muted">{STR.art.ownership.maintainers}</span>
        <span data-testid="artifact-maintainers" className="font-mono text-ink-2">
          {maintainers.length > 0 ? maintainers.join(", ") : "—"}
        </span>
      </div>

      {showPanel ? (
        <div
          data-testid="ownership-panel"
          className="space-y-3 rounded-sf border border-line bg-surface-2 p-3"
        >
          <div className="text-xs uppercase tracking-wide text-muted">
            {STR.art.ownership.title}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm text-muted">
              {STR.art.ownership.newOwner}
              <input
                data-testid="transfer-owner-input"
                className="mt-1 block w-48 rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm text-muted">
              {STR.art.common.reason}
              <input
                data-testid="transfer-owner-reason"
                className="mt-1 block w-64 rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoComplete="off"
              />
            </label>
            <HelpTip action="transfer-owner">
              <Button
                type="button"
                data-testid="transfer-owner"
                className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                pending={transferMut.isPending}
                disabled={!newOwner.trim() || !reason.trim()}
                onClick={() => {
                  setTransferError(null);
                  setConfirmOpen(true);
                }}
              >
                {STR.art.ownership.transfer}
              </Button>
            </HelpTip>
            {transferError ? (
              <span data-testid="transfer-owner-error" className="text-xs text-danger">
                {transferError}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm text-muted">
              {STR.art.ownership.addMaintainer}
              <input
                data-testid="add-maintainer-input"
                className="mt-1 block w-48 rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
                value={maintainerName}
                onChange={(e) => setMaintainerName(e.target.value)}
                autoComplete="off"
              />
            </label>
            <HelpTip action="add-maintainer">
              <Button
                type="button"
                data-testid="add-maintainer"
                className="rounded-sf border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-accent disabled:opacity-50"
                pending={addMut.isPending}
                disabled={!maintainerName.trim()}
                onClick={() => {
                  setMaintainerError(null);
                  addMut.mutate();
                }}
              >
                {STR.art.ownership.addMaintainer}
              </Button>
            </HelpTip>
            {maintainerError ? (
              <span data-testid="add-maintainer-error" className="text-xs text-danger">
                {maintainerError}
              </span>
            ) : null}
          </div>

          {maintainers.length > 0 ? (
            <ul className="space-y-1">
              {maintainers.map((u) => (
                <li key={u} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{u}</span>
                  <HelpTip action="remove-maintainer">
                    <Button
                      type="button"
                      data-testid={`remove-maintainer-${u}`}
                      className="rounded-sf border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-danger hover:text-danger disabled:opacity-50"
                      pending={removeMut.isPending}
                      onClick={() => {
                        setRemoveError(null);
                        removeMut.mutate(u);
                      }}
                    >
                      {STR.art.ownership.remove}
                    </Button>
                  </HelpTip>
                </li>
              ))}
              {removeError ? (
                <li data-testid="remove-maintainer-error" className="text-xs text-danger">
                  {removeError}
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={STR.art.ownership.confirmTitle}
        body={STR.art.ownership.confirmBody(`${artifact.type}/${artifact.name}`, newOwner.trim())}
        helpText={STR.art.ownership.confirmHelp}
        helpTopic="getting-started/ownership"
        confirmLabel={STR.art.ownership.confirmLabel}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => transferMut.mutate()}
      />
    </>
  );
}
