import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAvailability, listTeams, setAvailability } from "../api/client.ts";
import type { AvailabilityState } from "../api/types.ts";
import { useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";

const STATES: AvailabilityState[] = ["unavailable", "available", "default", "required"];

/**
 * Availability per team (team-availability). Admins edit any team; members of a team see a selector too and the
 * server accepts it only from that team's lead.
 */
export function AvailabilityPanel({ type, name }: { type: string; name: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  // Teams need a session: an anonymous visitor must not trigger the 401 redirect to sign-in.
  const signedIn = Boolean(me.data);
  const teams = useQuery({ queryKey: ["teams"], queryFn: listTeams, enabled: signedIn });
  const q = useQuery({
    queryKey: ["availability", type, name],
    queryFn: () => getAvailability(type, name),
    enabled: signedIn,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: { team: string; state: AvailabilityState }) => setAvailability(type, name, v),
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(["availability", type, name], next);
    },
    onError: (e) => setError(errorText(e)),
  });
  const items = teams.data?.items ?? [];
  if (!me.data || items.length === 0 || !q.data) return null;
  const stateOf = (team: string) =>
    q.data.items.find((i) => i.team === team)?.state ?? ("available" as AvailabilityState);
  const admin = me.data.role === "admin";
  return (
    <section
      data-testid="availability"
      className="rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-muted">
        {STR.art.overview.availabilityTitle}
      </h3>
      <table className="w-full">
        <tbody>
          {items.map((t) => (
            <tr key={t.name} className="border-b border-line/50">
              <th translate="no" className="py-1 pr-3 text-left font-mono text-xs font-normal">
                {t.name}
              </th>
              <td className="py-1">
                {admin || t.is_member ? (
                  <HelpTip action="availability-set">
                    <select
                      data-testid={`availability-${t.name}`}
                      className="rounded-sf border border-line bg-bg px-2 py-1 text-xs"
                      value={stateOf(t.name)}
                      aria-disabled={save.isPending || undefined}
                      onChange={(e) => {
                        // Focus stays on the select while it saves; a change meanwhile is ignored.
                        if (!save.isPending)
                          save.mutate({ team: t.name, state: e.target.value as AvailabilityState });
                      }}
                    >
                      {STATES.map((s) => (
                        <option key={s} value={s}>
                          {STR.art.overview.availabilityState[s]}
                        </option>
                      ))}
                    </select>
                  </HelpTip>
                ) : (
                  <span className="text-ink-2">
                    {STR.art.overview.availabilityState[stateOf(t.name)]}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
