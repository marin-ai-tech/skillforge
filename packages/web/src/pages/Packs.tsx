import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { getPack, listPacks } from "../api/client.ts";
import type { PackSummary, PackVersion } from "../api/types.ts";
import { RequireUser } from "../components/RequireUser.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import { MethodPackForm } from "../components/MethodPackForm.tsx";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";

/** Roles of one method pack version with their pinned artifacts and an install command per role. */
export function MethodPackRoles({ name, version }: { name: string; version: PackVersion }) {
  const S = STR.ws.packs;
  return (
    <div data-testid="pack-detail" className="space-y-3">
      {version.roles.map((role) => {
        const command = `skillforge pack install ${name}@${version.version} --role ${role.name}`;
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

function PackDetail({ name, id }: { name: string; id: string }) {
  const q = useQuery({ queryKey: ["pack", name], queryFn: () => getPack(name) });
  const latest = q.data?.latest;
  return <div id={id}>{latest ? <MethodPackRoles name={name} version={latest} /> : null}</div>;
}

function PackRow({ pack }: { pack: PackSummary }) {
  const S = STR.ws.packs;
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li data-testid="pack" className="space-y-2 rounded-sf border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to={`/packs/${encodeURIComponent(pack.name)}`}
          className="no-underline hover:underline"
        >
          <span className="font-semibold text-ink">{pack.title}</span>{" "}
          <span translate="no" className="font-mono text-xs text-muted">
            {pack.name}@{pack.latest_version}
          </span>
        </Link>
        <button
          type="button"
          data-testid="pack-open"
          aria-expanded={open}
          aria-controls={id}
          className="min-h-6 rounded-sf px-2 text-sm text-ink-2 hover:bg-surface-2"
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden className="text-muted">
            {open ? "▾ " : "▸ "}
          </span>
          {S.rolesToggle}
        </button>
      </div>
      {pack.description ? <p className="text-sm text-ink-2">{pack.description}</p> : null}
      {open ? <PackDetail name={pack.name} id={id} /> : null}
    </li>
  );
}

function PacksPage() {
  const S = STR.ws.packs;
  const me = useMe();
  const [formOpen, setFormOpen] = useState(false);
  const opened = useRef(false);
  const newRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (formOpen) opened.current = true;
    else if (opened.current) newRef.current?.focus();
  }, [formOpen]);
  useEffect(() => {
    document.title = S.docTitle;
  }, [S.docTitle]);
  const q = useQuery({ queryKey: ["packs"], queryFn: listPacks });
  const items = q.data?.items ?? [];
  const canCreate = roleAtLeast(me.data?.role, "contributor");
  return (
    <div className="space-y-4">
      <PageHeader title={S.title} topic="pages/packs" />
      <p className="text-sm text-ink-2">{S.description}</p>
      {canCreate && !formOpen ? (
        <button
          ref={newRef}
          type="button"
          data-testid="pack-new"
          onClick={() => setFormOpen(true)}
          className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
        >
          {S.newPack}
        </button>
      ) : null}
      {formOpen ? <MethodPackForm onCancel={() => setFormOpen(false)} /> : null}
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
