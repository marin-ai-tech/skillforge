import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, patchArtifactMetadata } from "../api/client.ts";
import type { ArtifactSummary } from "../api/types.ts";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { formatDeclaration } from "../lib/runtimes.ts";
import { Button } from "./Button.tsx";

type Field = "description" | "display_name" | "tags" | "agents";

const NO_ERRORS: Record<Field, string> = {
  description: "",
  display_name: "",
  tags: "",
  agents: "",
};

function message(err: unknown, owner: string): string {
  const t = STR.art.metadata.errors;
  if (!(err instanceof ApiError)) return t.requestFailed;
  if (err.error === "not_owner") return t.notOwner(err.owner || owner);
  if (err.error === "mcp_token_forbidden") return t.mcpForbidden;
  if (err.error === "agents_invalid") return err.detail ?? errorText(err);
  if (err.error === "metadata_invalid")
    return t.invalid(err.message === err.error ? t.invalidDefault : err.message);
  return errorText(err);
}

export function MetadataPanel({ artifact }: { artifact: ArtifactSummary }) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(artifact.description);
  const [displayName, setDisplayName] = useState(artifact.display_name ?? "");
  const [tags, setTags] = useState(artifact.tags.join(", "));
  const declared = formatDeclaration(artifact.agents?.declared ?? []);
  const [agents, setAgents] = useState(declared);
  const [error, setError] = useState<Record<Field, string>>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDescription(artifact.description);
    setDisplayName(artifact.display_name ?? "");
    setTags(artifact.tags.join(", "));
    setAgents(declared);
  }, [artifact.description, artifact.display_name, artifact.tags, declared]);

  async function save(
    body: {
      display_name?: string | null;
      description?: string | null;
      tags?: string[] | null;
      agents?: string | null;
    },
    field?: Field,
  ) {
    setBusy(true);
    setError(NO_ERRORS);
    try {
      await patchArtifactMetadata(artifact.type, artifact.name, body);
      await queryClient.invalidateQueries({ queryKey: ["artifact", artifact.type, artifact.name] });
      await queryClient.invalidateQueries({ queryKey: ["audit", artifact.type, artifact.name] });
    } catch (err) {
      const text = message(err, artifact.owner);
      // A rejected agent declaration belongs to its own field, not to the whole form.
      const target = err instanceof ApiError && err.error === "agents_invalid" ? "agents" : field;
      setError(
        target
          ? { ...NO_ERRORS, [target]: text }
          : { description: text, display_name: text, tags: text, agents: "" },
      );
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-1 w-full rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink";
  const reset = (field: Field) => void save({ [field]: null }, field);
  return (
    <section
      data-testid="metadata-panel"
      className="space-y-3 rounded-sf border border-line p-3 text-sm"
    >
      <h2 className="font-semibold">{STR.art.metadata.title}</h2>
      <p className="text-muted">{STR.art.metadata.hint}</p>
      <div>
        <label htmlFor="metadata-description">{STR.art.metadata.description}</label>
        <textarea
          id="metadata-description"
          data-testid="metadata-description"
          className={inputClass}
          value={description}
          maxLength={1024}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error.description && <p className="text-danger">{error.description}</p>}
        <Button
          type="button"
          data-testid="metadata-reset-description"
          pending={busy}
          onClick={() => reset("description")}
        >
          {STR.art.metadata.resetDescription}
        </Button>
      </div>
      <div>
        <label htmlFor="metadata-display-name">{STR.art.metadata.displayName}</label>
        <input
          id="metadata-display-name"
          data-testid="metadata-display-name"
          className={inputClass}
          value={displayName}
          maxLength={100}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        {error.display_name && <p className="text-danger">{error.display_name}</p>}
        <Button
          type="button"
          data-testid="metadata-reset-display_name"
          pending={busy}
          onClick={() => reset("display_name")}
        >
          {STR.art.metadata.resetDisplayName}
        </Button>
      </div>
      <div>
        <label htmlFor="metadata-tags">{STR.art.metadata.tags}</label>
        <input
          id="metadata-tags"
          data-testid="metadata-tags"
          className={inputClass}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        {error.tags && <p className="text-danger">{error.tags}</p>}
        <Button
          type="button"
          data-testid="metadata-reset-tags"
          pending={busy}
          onClick={() => reset("tags")}
        >
          {STR.art.metadata.resetTags}
        </Button>
      </div>
      <div>
        <label htmlFor="metadata-agents">{STR.art.metadata.agents}</label>
        <p className="text-xs text-muted">
          {STR.art.metadata.agentsHint} <code>claude-code&gt;=2.1, codex</code>
        </p>
        <input
          id="metadata-agents"
          data-testid="metadata-agents"
          className={inputClass}
          value={agents}
          translate="no"
          onChange={(e) => setAgents(e.target.value)}
        />
        {error.agents && (
          <p data-testid="metadata-error-agents" className="text-danger">
            {error.agents}
          </p>
        )}
        <Button
          type="button"
          data-testid="metadata-reset-agents"
          pending={busy}
          onClick={() => reset("agents")}
        >
          {STR.art.metadata.resetAgents}
        </Button>
      </div>
      <HelpTip action="metadata-save">
        <Button
          type="button"
          data-testid="metadata-save"
          className="rounded-sf bg-accent px-3 py-1.5 text-white"
          pending={busy}
          onClick={() =>
            void save({
              description,
              display_name: displayName,
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              ...(agents.trim() !== declared ? { agents: agents.trim() } : {}),
            })
          }
        >
          {STR.art.metadata.save}
        </Button>
      </HelpTip>
    </section>
  );
}
