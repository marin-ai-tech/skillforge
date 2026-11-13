import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMcpPolicy, putMcpPolicy } from "../api/client.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";
import { Button } from "./Button.tsx";

const REGISTRY_TYPES = ["npm", "pypi", "oci"] as const;

/** Which MCP package types and remote origins may be published (mcp-policy); admin page only. */
export function McpPolicyPanel() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["mcp-policy"], queryFn: getMcpPolicy });
  const [types, setTypes] = useState<string[]>([]);
  const [origins, setOrigins] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setTypes(q.data.policy.registry_types);
    setOrigins(q.data.policy.remote_origins.join("\n"));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      putMcpPolicy({
        registry_types: types,
        remote_origins: origins
          .split(/\s+/)
          .map((o) => o.trim())
          .filter(Boolean),
      }),
    onSuccess: (next) => {
      setMessage(STR.adm.lifecycle.mcpSaved);
      queryClient.setQueryData(["mcp-policy"], next);
    },
    onError: (e) => setMessage(errorText(e)),
  });
  if (!q.data) return null;
  const S = STR.adm.lifecycle;
  const toggle = (t: string) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  return (
    <section
      data-testid="mcp-policy"
      className="space-y-3 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{S.mcpTitle}</h2>
      <fieldset className="space-y-1">
        <legend className="text-ink-2">{S.mcpTypes}</legend>
        <div className="flex flex-wrap gap-3">
          {REGISTRY_TYPES.map((t) => (
            <label key={t} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                data-testid={`mcp-policy-type-${t}`}
                checked={types.includes(t)}
                onChange={() => toggle(t)}
              />
              <span translate="no" className="font-mono text-xs">
                {t}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1">
        <span className="text-ink-2">{S.mcpOrigins}</span>
        <textarea
          data-testid="mcp-policy-origins"
          rows={4}
          className="w-full rounded-sf border border-line bg-bg px-2 py-1.5 font-mono text-xs"
          value={origins}
          onChange={(e) => setOrigins(e.target.value)}
        />
        <span className="text-xs text-muted">{S.mcpOriginsHint}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <HelpTip action="mcp-policy-save">
          <Button
            type="button"
            data-testid="mcp-policy-save"
            pending={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
          >
            {S.mcpSave}
          </Button>
        </HelpTip>
        {message ? (
          <span data-testid="mcp-policy-message" role="status" className="text-ink-2">
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
