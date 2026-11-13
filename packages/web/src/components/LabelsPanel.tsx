import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, putArtifactLabels } from "../api/client.ts";
import type { ArtifactSummary } from "../api/types.ts";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { Button } from "./Button.tsx";

type Props = { artifact: ArtifactSummary; canEdit: boolean };

function humanLabelsError(err: unknown): string {
  const t = STR.art.labels.errors;
  if (!(err instanceof ApiError)) return STR.art.common.requestFailed;
  switch (err.error) {
    case "labels_invalid":
      return t.invalid;
    case "not_owner":
      return t.notOwner;
    case "forbidden":
      return t.forbidden;
    case "mcp_token_forbidden":
      return t.mcpForbidden;
    default:
      return err.message && err.message !== err.error
        ? `${err.error}: ${errorText(err)}`
        : err.error;
  }
}

export function LabelsPanel({ artifact, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState((artifact.labels ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      const labels = input
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return putArtifactLabels(artifact.type, artifact.name, labels);
    },
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["artifact", artifact.type, artifact.name] }),
        queryClient.invalidateQueries({ queryKey: ["audit", artifact.type, artifact.name] }),
        queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
      ]);
    },
    onError: (err: unknown) => setError(humanLabelsError(err)),
  });

  if (!canEdit) return null;

  return (
    <div
      data-testid="labels-panel"
      className="space-y-3 rounded-sf border border-line bg-surface-2 p-3"
    >
      <div className="text-xs uppercase tracking-wide text-muted">{STR.art.labels.title}</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[240px] flex-1 text-sm text-muted">
          {STR.art.labels.label}
          <input
            data-testid="labels-input"
            className="mt-1 block w-full rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-sm text-ink"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={STR.art.labels.placeholder}
            autoComplete="off"
          />
        </label>
        <HelpTip action="labels-save">
          <Button
            type="button"
            data-testid="labels-save"
            className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            pending={mut.isPending}
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
          >
            {STR.art.labels.save}
          </Button>
        </HelpTip>
        {error ? (
          <span data-testid="labels-error" className="text-xs text-danger">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
