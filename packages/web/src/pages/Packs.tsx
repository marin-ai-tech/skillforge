import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getPack, listPacks } from "../api/client.ts";
import type { PackSummary } from "../api/types.ts";
import { RequireUser } from "../components/RequireUser.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

function PackDetail({ name }: { name: string }) {
  const S = STR.ws.packs;
  const q = useQuery({ queryKey: ["pack", name], queryFn: () => getPack(name) });
  const latest = q.data?.latest;
  if (!latest) return null;
  return (
    <div data-testid="pack-detail" className="space-y-3">
      {latest.roles.map((role) => {
        const command = `skillforge pack install ${name}@${latest.version} --role ${role.name}`;
        return (
          <section key={role.name} data-testid="pack-role" className="space-y-1">
            <h3 translate="no" className="font-mono text-sm font-semibold">
              {role.name}
            </h3>
            {role.description ? <p className="text-xs text-ink-2">{role.description}</p> : null}
            <ul className="flex flex-wrap gap-2 text-xs">
              {role.items.map((i) => (
                <li key={`${i.type}/${i.name}`}>
                  <Link
                    translate="no"
                    to={`/artifacts/${i.type}/${i.name}`}
                    className="font-mono text-accent"
                  >
                    {i.type}/{i.name}@{i.version}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <code className="rounded-sf bg-surface-2 px-2 py-1 text-xs">{command}</code>
              <CopyButton value={command} label={S.copy} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PackRow({ pack }: { pack: PackSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <li data-testid="pack" className="space-y-2 rounded-sf border border-line bg-surface p-4">
      <button
        type="button"
        data-testid="pack-open"
        className="text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="font-semibold">{pack.title}</span>{" "}
        <span translate="no" className="font-mono text-xs text-muted">
          {pack.name}@{pack.latest_version}
        </span>
      </button>
      {pack.description ? <p className="text-sm text-ink-2">{pack.description}</p> : null}
      {open ? <PackDetail name={pack.name} /> : null}
    </li>
  );
}

function PacksPage() {
  const S = STR.ws.packs;
  useEffect(() => {
    document.title = S.docTitle;
  }, [S.docTitle]);
  const q = useQuery({ queryKey: ["packs"], queryFn: listPacks });
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={S.title} topic="pages/packs" />
      <p className="text-sm text-ink-2">{S.description}</p>
      {q.error ? <p className="text-sm text-danger">{errorText(q.error)}</p> : null}
      {items.length === 0 && !q.isLoading ? (
        <p data-testid="packs-empty" className="text-sm text-ink-2">
          {S.empty}
        </p>
      ) : null}
      <ul className="space-y-3">
        {items.map((p) => (
          <PackRow key={p.name} pack={p} />
        ))}
      </ul>
    </div>
  );
}

export function Packs() {
  return <RequireUser>{() => <PacksPage />}</RequireUser>;
}
