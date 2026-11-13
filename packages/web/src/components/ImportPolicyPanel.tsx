import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getImportPolicy, putImportPolicy } from "../api/client.ts";
import type { ImportPolicy } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";
import { Button } from "./Button.tsx";

/** Admin-only import source policy (import-source-policy): git allowlist, uploads, release quarantine. */
export function ImportPolicyPanel({ role }: { role: string }) {
  return role === "admin" ? <PolicyForm /> : null;
}

function PolicyForm() {
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: ["import-policy"], queryFn: getImportPolicy });
  const [draft, setDraft] = useState<ImportPolicy | null>(null);
  const [rules, setRules] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!policy.data) return;
    setDraft(policy.data.policy);
    setRules(policy.data.policy.allowed_sources.join("\n"));
  }, [policy.data]);

  const save = useMutation({
    mutationFn: () =>
      putImportPolicy({
        ...draft!,
        allowed_sources: rules
          .split(/\r?\n/)
          .map((r) => r.trim())
          .filter((r) => r !== ""),
      }),
    onSuccess: (next) => {
      setMessage(STR.import.policySaved);
      queryClient.setQueryData(["import-policy"], next);
    },
    onError: (e) => setMessage(errorText(e)),
  });

  if (!draft) return null;
  const set = <K extends keyof ImportPolicy>(key: K, value: ImportPolicy[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <details data-testid="import-policy" className="rounded-sf border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        {STR.import.policyTitle}
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="font-medium text-ink">{STR.import.policyMode}</span>
          <select
            data-testid="import-policy-mode"
            className="rounded-sf border border-line bg-bg px-2 py-1.5"
            value={draft.git_mode}
            onChange={(e) => set("git_mode", e.target.value as ImportPolicy["git_mode"])}
          >
            <option value="open">{STR.import.policyOpen}</option>
            <option value="allowlist">{STR.import.policyAllowlist}</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-medium text-ink">{STR.import.policyRules}</span>
          <textarea
            data-testid="import-policy-rules"
            rows={4}
            className="w-full rounded-sf border border-line bg-bg px-3 py-1.5 font-mono text-xs"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            translate="no"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="import-policy-archives"
            checked={draft.allow_archives}
            onChange={(e) => set("allow_archives", e.target.checked)}
          />
          {STR.import.policyArchives}
        </label>
        <label className="block space-y-1">
          <span className="font-medium text-ink">{STR.import.policyAge}</span>
          <input
            type="number"
            min={0}
            data-testid="import-policy-age"
            className="w-32 rounded-sf border border-line bg-bg px-3 py-1.5"
            value={draft.min_release_age_days}
            onChange={(e) => set("min_release_age_days", Number(e.target.value))}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <HelpTip action="import-policy-save">
            <Button
              type="button"
              data-testid="import-policy-save"
              pending={save.isPending}
              onClick={() => save.mutate()}
              className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
            >
              {STR.import.policySave}
            </Button>
          </HelpTip>
          {message ? (
            <span data-testid="import-policy-message" role="status" className="text-ink-2">
              {message}
            </span>
          ) : null}
        </div>
      </div>
    </details>
  );
}
