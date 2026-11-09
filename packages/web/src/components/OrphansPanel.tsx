import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listOrphans, transferArtifactOwner } from "../api/client.ts";
import type { Orphan } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";

/** Artifacts whose owner is disabled or gone (orphaned-artifacts), with a hand-over to a new owner. */
export function OrphansPanel() {
  const q = useQuery({ queryKey: ["orphans"], queryFn: listOrphans });
  const items = q.data?.items ?? [];
  return (
    <section
      id="orphans"
      data-testid="orphans"
      className="space-y-2 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">
        {STR.adm.users.orphansTitle}
      </h2>
      {items.length === 0 ? (
        <p className="text-ink-2">{STR.adm.users.orphansNone}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((o) => (
            <OrphanRow key={`${o.type}/${o.name}`} orphan={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OrphanRow({ orphan }: { orphan: Orphan }) {
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState(orphan.suggested_owner ?? "");
  const [error, setError] = useState<string | null>(null);
  const hand = useMutation({
    mutationFn: () =>
      transferArtifactOwner(orphan.type, orphan.name, {
        owner: owner.trim(),
        reason: STR.adm.users.orphanReason(orphan.owner),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["orphans"] }),
    onError: (e) => setError(errorText(e)),
  });
  return (
    <li data-testid="orphan" className="flex flex-wrap items-center gap-2">
      <Link
        translate="no"
        to={`/artifacts/${orphan.type}/${orphan.name}`}
        className="font-mono text-xs text-accent"
      >
        {orphan.type}/{orphan.name}
      </Link>
      <span className="text-muted">
        {STR.adm.users.orphanOwner(orphan.owner, orphan.owner_state)}
      </span>
      <input
        data-testid="orphan-owner"
        className="rounded-sf border border-line bg-bg px-2 py-1 text-xs"
        placeholder={STR.adm.users.orphanNewOwner}
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
      />
      <HelpTip action="orphan-transfer">
        <button
          type="button"
          data-testid="orphan-transfer"
          disabled={hand.isPending || owner.trim() === ""}
          onClick={() => hand.mutate()}
          className="rounded-sf border border-line px-2 py-1 text-xs disabled:opacity-50"
        >
          {STR.adm.users.orphanTransfer}
        </button>
      </HelpTip>
      {error ? <span className="text-danger">{error}</span> : null}
    </li>
  );
}
