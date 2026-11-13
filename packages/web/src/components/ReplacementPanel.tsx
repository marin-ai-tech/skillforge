import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setReplacement } from "../api/client.ts";
import type { ArtifactSummary } from "../api/types.ts";
import { useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";
import { Button } from "./Button.tsx";

/** "Replaced by" (artifact-replacement): a notice for everyone, an editor for people who may publish it. */
export function ReplacementPanel({ artifact }: { artifact: ArtifactSummary }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(artifact.replaced_by ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      setReplacement(artifact.type, artifact.name, value.trim() === "" ? null : value.trim()),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["artifact", artifact.type, artifact.name] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const notice = artifact.replaced_by ? (
    <p data-testid="replaced-by" className="text-warning">
      {STR.art.overview.replacedBy}{" "}
      <Link
        translate="no"
        to={`/artifacts/${artifact.replaced_by}`}
        className="text-accent underline"
      >
        {artifact.replaced_by}
      </Link>
    </p>
  ) : null;
  if (!me.data) return notice;
  return (
    <section
      data-testid="replacement"
      className="space-y-2 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      {notice}
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="replacement-input"
          className="rounded-sf border border-line bg-bg px-2 py-1 font-mono text-xs"
          placeholder={STR.art.overview.replacementPlaceholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          translate="no"
        />
        <HelpTip action="replacement-save">
          <Button
            type="button"
            data-testid="replacement-save"
            pending={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-sf border border-line px-2 py-1 text-xs disabled:opacity-50"
          >
            {STR.art.overview.replacementSave}
          </Button>
        </HelpTip>
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
