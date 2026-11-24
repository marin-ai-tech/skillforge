import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getPack, getPackVersion } from "../api/client.ts";
import type { PackVersion } from "../api/types.ts";
import { MethodPackForm } from "../components/MethodPackForm.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { RelativeTime } from "../components/RelativeTime.tsx";
import { RequireUser } from "../components/RequireUser.tsx";
import { useMe } from "../lib/auth.tsx";
import { diffMethodPackVersions, type MethodPackChange } from "../lib/method-pack-diff.ts";
import { STR } from "../lib/strings.ts";
import { MethodPackRoles } from "./Packs.tsx";

function useVersion(name: string, version: string | null) {
  return useQuery({
    queryKey: ["pack", name, "version", version],
    queryFn: () => getPackVersion(name, version!),
    enabled: !!version,
    staleTime: 30_000,
  });
}

function changeText(c: MethodPackChange): string {
  const S = STR.ws.packs;
  switch (c.kind) {
    case "role_added":
      return S.roleAdded(c.role);
    case "role_removed":
      return S.roleRemoved(c.role);
    case "item_added":
      return S.itemAdded(c.role, c.item);
    case "item_removed":
      return S.itemRemoved(c.role, c.item);
    default:
      return S.itemChanged(c.role, c.item, c.from, c.to);
  }
}

function VersionSelect({
  id,
  label,
  value,
  versions,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  value: string;
  versions: string[];
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-ink-2">
        {label}
      </label>
      <select
        id={id}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sf border border-field-line bg-surface px-2 py-1 font-mono text-xs"
      >
        {versions.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </span>
  );
}

function Compare({ name, versions }: { name: string; versions: string[] }) {
  const S = STR.ws.packs;
  const id = useId();
  const [from, setFrom] = useState(versions[1] ?? "");
  const [to, setTo] = useState(versions[0] ?? "");
  const a = useVersion(name, from);
  const b = useVersion(name, to);
  const changes = a.data && b.data ? diffMethodPackVersions(a.data, b.data) : null;
  return (
    <section data-testid="pack-compare" aria-labelledby={`${id}-h`} className="space-y-2">
      <h2 id={`${id}-h`} className="text-base font-semibold text-ink">
        {S.compareTitle}
      </h2>
      <div className="flex flex-wrap gap-3">
        <VersionSelect
          id={`${id}-from`}
          label={S.compareFrom}
          value={from}
          versions={versions}
          onChange={setFrom}
        />
        <VersionSelect
          id={`${id}-to`}
          label={S.compareTo}
          value={to}
          versions={versions}
          onChange={setTo}
        />
      </div>
      <div aria-live="polite">
        {a.isError || b.isError ? (
          <p role="alert" className="text-sm text-danger">
            {S.versionLoadFailed}
          </p>
        ) : changes === null ? null : changes.length === 0 ? (
          <p className="text-sm text-muted">{S.noChanges(from, to)}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {changes.map((c, i) => (
              <li key={i}>{changeText(c)}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Versions({
  name,
  versions,
  latest,
}: {
  name: string;
  versions: string[];
  latest: PackVersion | null;
}) {
  const S = STR.ws.packs;
  const id = useId();
  return (
    <section data-testid="pack-versions" aria-labelledby={`${id}-h`} className="space-y-2">
      <h2 id={`${id}-h`} className="text-base font-semibold text-ink">
        {S.versionsTitle}
      </h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="py-1 pr-4 font-medium">
              {S.colVersion}
            </th>
            <th scope="col" className="py-1 pr-4 font-medium">
              {S.colBy}
            </th>
            <th scope="col" className="py-1 font-medium">
              {S.colWhen}
            </th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <VersionRow
              key={v}
              name={name}
              version={v}
              known={latest?.version === v ? latest : null}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function VersionRow({
  name,
  version,
  known,
}: {
  name: string;
  version: string;
  known: PackVersion | null;
}) {
  const q = useVersion(name, known ? null : version);
  const v = known ?? q.data;
  return (
    <tr className="border-t border-line">
      <td className="py-1 pr-4 font-mono text-xs" translate="no">
        <Link
          to={`/packs/${encodeURIComponent(name)}?version=${encodeURIComponent(version)}`}
          className="text-accent underline"
        >
          {version}
        </Link>
      </td>
      <td className="py-1 pr-4" translate="no">
        {v?.published_by ?? "…"}
      </td>
      <td className="py-1">{v ? <RelativeTime iso={v.published_at} /> : "…"}</td>
    </tr>
  );
}

function NotFound() {
  const S = STR.ws.packs;
  return (
    <div
      data-testid="pack-not-found"
      className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
    >
      {S.notFound}{" "}
      <Link to="/packs" className="text-accent underline">
        {S.allPacks}
      </Link>
    </div>
  );
}

type PackData = Awaited<ReturnType<typeof getPack>>;

function PackHeader({ pack }: { pack: PackData["pack"] }) {
  const S = STR.ws.packs;
  return (
    <div data-testid="pack-header" className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
      <span translate="no" className="font-mono">
        {pack.name}
      </span>
      <span>
        {S.owner}: <span translate="no">{pack.owner}</span>
      </span>
      <span>
        {S.latest}:{" "}
        <span translate="no" className="font-mono">
          {pack.latest_version}
        </span>
      </span>
      <span>
        {S.updated} <RelativeTime iso={pack.updated_at} />
      </span>
    </div>
  );
}

/** The «published» message: read once from the navigation state, which is then cleared so a reload does not repeat it. */
function PublishedNote() {
  const S = STR.ws.packs;
  const location = useLocation();
  const navigate = useNavigate();
  const fromState = (location.state as { published?: string } | null)?.published ?? null;
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!fromState) return;
    const at = fromState.lastIndexOf("@");
    setText(S.published(fromState.slice(0, at), fromState.slice(at + 1)));
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [fromState, S, navigate, location.pathname, location.search]);
  return (
    <p
      role="status"
      className={
        text ? "rounded-sf border border-line bg-surface-2 px-3 py-2 text-sm text-ink" : "sr-only"
      }
    >
      {text ?? ""}
    </p>
  );
}

function NewVersion({ data }: { data: PackData }) {
  const S = STR.ws.packs;
  const me = useMe();
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) opened.current = true;
    else if (opened.current) btnRef.current?.focus();
  }, [open]);
  const user = me.data;
  if (!user || (user.username !== data.pack.owner && user.role !== "admin")) return null;
  if (open)
    return (
      <MethodPackForm
        packName={data.pack.name}
        latest={data.latest}
        onCancel={() => setOpen(false)}
      />
    );
  return (
    <button
      ref={btnRef}
      type="button"
      data-testid="pack-new-version"
      onClick={() => setOpen(true)}
      className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
    >
      {S.newVersion}
    </button>
  );
}

function Roles({ data }: { data: PackData }) {
  const S = STR.ws.packs;
  const [params, setParams] = useSearchParams();
  const { pack, latest } = data;
  const asked = params.get("version");
  const unknown = asked !== null && !pack.versions.includes(asked);
  const selected = asked && !unknown ? asked : (pack.latest_version ?? "");
  const other = selected && selected !== latest?.version ? selected : null;
  const shown = useVersion(pack.name, other);
  const version = other ? shown.data : latest;
  const choose = (v: string) =>
    setParams((sp) => {
      const next = new URLSearchParams(sp);
      next.set("version", v);
      return next;
    });
  return (
    <section data-testid="pack-roles" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{S.rolesTitle}</h2>
        <VersionSelect
          id="pack-version"
          label={S.versionLabel}
          value={selected}
          versions={pack.versions}
          testId="pack-version-select"
          onChange={choose}
        />
      </div>
      {unknown ? <p className="text-sm text-ink-2">{S.unknownVersion(asked)}</p> : null}
      {shown.isError ? (
        <p role="alert" className="text-sm text-danger">
          {S.versionLoadFailed}
        </p>
      ) : version ? (
        <MethodPackRoles name={pack.name} version={version} />
      ) : (
        <p className="text-sm text-muted">{STR.common.loading}</p>
      )}
    </section>
  );
}

function PackBody({ name }: { name: string }) {
  const S = STR.ws.packs;
  const q = useQuery({ queryKey: ["pack", name], queryFn: () => getPack(name), retry: false });
  const pack = q.data?.pack;
  useEffect(() => {
    if (pack) document.title = `${pack.title} · ${S.docTitle}`;
  }, [pack, S.docTitle]);

  if (q.isLoading) return <p className="text-sm text-muted">{STR.common.loading}</p>;
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />;
  if (q.error || !q.data) {
    return (
      <p role="alert" className="text-sm text-danger">
        {S.loadFailed}
      </p>
    );
  }
  const data = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title={data.pack.title} description={data.pack.description} topic="pages/pack" />
      <PublishedNote />
      <PackHeader pack={data.pack} />
      <NewVersion data={data} />
      <Roles data={data} />
      <Versions name={data.pack.name} versions={data.pack.versions} latest={data.latest} />
      {data.pack.versions.length > 1 ? (
        <Compare name={data.pack.name} versions={data.pack.versions} />
      ) : null}
    </div>
  );
}

/** The page of one method pack (pack-authoring): header, roles of a version, versions, comparison, new version. */
export function MethodPackPage() {
  const { name = "" } = useParams();
  return <RequireUser>{() => <PackBody name={name} />}</RequireUser>;
}
