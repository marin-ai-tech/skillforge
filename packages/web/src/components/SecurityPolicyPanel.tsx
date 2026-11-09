import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSecurityPolicy, putSecurityPolicy } from "../api/client.ts";
import type { SecurityPolicy } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";

/** Whether the content scan blocks publishing (content-security-scan); admin page only. */
export function SecurityPolicyPanel() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["security-policy"], queryFn: getSecurityPolicy });
  const [level, setLevel] = useState<SecurityPolicy["block_publish_on"]>("none");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setLevel(q.data.policy.block_publish_on);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => putSecurityPolicy({ block_publish_on: level }),
    onSuccess: (next) => {
      setMessage(STR.adm.lifecycle.securitySaved);
      queryClient.setQueryData(["security-policy"], next);
    },
    onError: (e) => setMessage(errorText(e)),
  });
  if (!q.data) return null;
  return (
    <section
      data-testid="security-policy"
      className="space-y-3 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.adm.lifecycle.securityTitle}
      </h2>
      <label className="block space-y-1">
        <span className="text-ink-2">{STR.adm.lifecycle.securityLevel}</span>
        <select
          data-testid="security-policy-level"
          className="rounded-sf border border-line bg-bg px-2 py-1.5"
          value={level}
          onChange={(e) => setLevel(e.target.value as SecurityPolicy["block_publish_on"])}
        >
          <option value="none">{STR.adm.lifecycle.securityNone}</option>
          <option value="high">{STR.adm.lifecycle.securityHigh}</option>
          <option value="medium">{STR.adm.lifecycle.securityMedium}</option>
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <HelpTip action="security-policy-save">
          <button
            type="button"
            data-testid="security-policy-save"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-sf bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50"
          >
            {STR.adm.lifecycle.securitySave}
          </button>
        </HelpTip>
        {message ? (
          <span data-testid="security-policy-message" role="status" className="text-ink-2">
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
