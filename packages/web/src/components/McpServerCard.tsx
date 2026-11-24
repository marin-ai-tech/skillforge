import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getMcpCard, postMcpReleaseCheck } from "../api/client.ts";
import type { McpCard, McpCardInput, McpRelease } from "../api/types.ts";
import { Button } from "./Button.tsx";
import { STR } from "../lib/strings.ts";
import { errorText, formatDateTime } from "../i18n/index.ts";
import { useHelp } from "../help/HelpProvider.tsx";

function Inputs({ items }: { items: McpCardInput[] }) {
  const S = STR.art.mcp;
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li
          key={i.name}
          data-testid="mcp-card-env"
          data-name={i.name}
          data-secret={i.isSecret ? "1" : "0"}
          className="flex flex-wrap items-baseline gap-2"
        >
          <code translate="no" className="text-xs">
            {i.name}
          </code>
          {i.isSecret ? (
            <span className="rounded-sf bg-danger-bg px-1.5 text-xs text-danger">{S.secret}</span>
          ) : null}
          {i.isRequired ? (
            <span className="rounded-sf bg-surface-2 px-1.5 text-xs text-muted">{S.required}</span>
          ) : null}
          {i.description ? <span className="text-xs text-ink-2">{i.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Packages({ card }: { card: McpCard }) {
  return (
    <>
      {card.packages.map((p, i) => (
        <div key={`p${i}`} className="space-y-1">
          <div data-testid="mcp-card-package" className="font-mono text-xs" translate="no">
            {p.version ? `${p.identifier}@${p.version}` : p.identifier}
            <span className="text-muted">
              {" "}
              · {p.registryType} · {p.runtimeHint ?? "—"} · {p.transport}
            </span>
          </div>
          <Inputs items={p.env} />
        </div>
      ))}
      {card.remotes.map((r, i) => (
        <div key={`r${i}`} className="space-y-1">
          <div data-testid="mcp-card-remote" className="font-mono text-xs" translate="no">
            {r.url} <span className="text-muted">· {r.type}</span>
          </div>
          <Inputs items={r.headers} />
        </div>
      ))}
    </>
  );
}

function Policy({ card }: { card: McpCard }) {
  const S = STR.art.mcp;
  return (
    <div
      data-testid="mcp-card-policy"
      data-allowed={card.policy.allowed ? "1" : "0"}
      className={card.policy.allowed ? "text-ink-2" : "text-danger"}
    >
      {card.policy.allowed ? S.policyOk : S.policyViolated}
      {card.policy.reasons.length > 0 ? (
        <ul className="list-disc pl-5 text-xs">
          {card.policy.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type PackageKind = "checkable" | "oci_only" | "remote_only";

function packageKind(card: McpCard): PackageKind {
  const types = new Set(card.packages.map((p) => p.registryType.toLowerCase()));
  if (types.has("npm") || types.has("pypi")) return "checkable";
  if (types.has("oci")) return "oci_only";
  return "remote_only";
}

function releaseState(kind: PackageKind, release: McpRelease | null | undefined): string {
  if (kind === "remote_only") return "remote_only";
  if (kind === "oci_only" && !release) return "unsupported";
  return release?.state ?? "never";
}

function Code({ children }: { children: string }) {
  return (
    <code translate="no" className="text-xs">
      {children}
    </code>
  );
}

function formatRelease(template: string, values: Record<string, string>): ReactNode {
  return template.split(/(\{(?:identifier|upstream|registry)\})/g).map((part, i) => {
    const m = /^\{(identifier|upstream|registry)\}$/.exec(part);
    if (!m) return part;
    return <Code key={i}>{values[m[1]!] ?? ""}</Code>;
  });
}

function checkedSuffix(time: string): string {
  return ` ${STR.art.mcp.release.checked(time)}`;
}

function releaseStatus(
  kind: PackageKind,
  release: McpRelease | null | undefined,
  pending: boolean,
): ReactNode {
  const S = STR.art.mcp.release;
  if (pending) return S.checking;
  if (kind === "remote_only") return S.remoteOnly;
  if (kind === "oci_only" && !release) return S.unsupported;
  if (!release) return S.never;
  const checked = checkedSuffix(formatDateTime(release.checked_at));
  switch (release.state) {
    case "up_to_date":
      return (
        <>
          {formatRelease(S.upToDate, {
            identifier: release.identifier,
            upstream: release.upstream_version ?? "",
          })}
          {checked}
        </>
      );
    case "update_available":
      return (
        <>
          {formatRelease(S.updateAvailable, {
            upstream: release.upstream_version ?? "",
            registry: release.registry_version ?? "",
          })}
          {checked}
        </>
      );
    case "not_found":
      return (
        <>
          {S.notFound}
          {checked}
        </>
      );
    case "failed":
      return (
        <>
          {S.failed(release.state_detail ?? "")}
          {checked}
        </>
      );
    case "unsupported":
      return (
        <>
          {S.unsupported}
          {checked}
        </>
      );
    default:
      return S.never;
  }
}

function releaseCheckErrorText(err: unknown): string {
  if (err instanceof ApiError && err.error === "release_check_disabled") {
    return STR.art.mcp.releaseCheckDisabled;
  }
  return errorText(err);
}

function HowToUpdateLink() {
  const { openTopic } = useHelp();
  return (
    <button
      type="button"
      data-testid="mcp-release-update-help"
      className="text-accent underline"
      onClick={() => openTopic("getting-started/mcp")}
    >
      {STR.art.mcp.release.howToUpdate}
    </button>
  );
}

function ReleaseBlock({
  name,
  card,
  canManage,
}: {
  name: string;
  card: McpCard;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const S = STR.art.mcp;
  const kind = packageKind(card);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(card.release);
  useEffect(() => {
    setCurrent(card.release);
  }, [card.release]);

  const check = useMutation({
    mutationFn: () => postMcpReleaseCheck(name),
    onMutate: () => setError(null),
    onSuccess: async (data) => {
      setCurrent(data.release);
      await qc.invalidateQueries({ queryKey: ["mcp-card", name] });
    },
    onError: (err: unknown) => setError(releaseCheckErrorText(err)),
  });

  const showCheck = canManage && kind === "checkable";
  const showUpdateHelp =
    !check.isPending && kind !== "remote_only" && current?.state === "update_available";

  return (
    <div data-testid="mcp-release" data-state={releaseState(kind, current)} className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-muted">{S.releaseTitle}</h3>
      <p data-testid="mcp-release-status" role="status" className="text-xs text-ink-2">
        {releaseStatus(kind, current, check.isPending)}
      </p>
      {showUpdateHelp ? <HowToUpdateLink /> : null}
      {showCheck ? (
        <Button
          type="button"
          data-testid="mcp-release-check"
          pending={check.isPending}
          onClick={() => check.mutate()}
          className="rounded-sf bg-accent px-3 py-1.5 text-sm font-medium text-on-accent"
        >
          {S.checkNow}
        </Button>
      ) : null}
      {error ? (
        <p data-testid="mcp-release-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CardFrame({ busy, children }: { busy?: boolean; children: ReactNode }) {
  const S = STR.art.mcp;
  return (
    <section
      data-testid="mcp-card"
      aria-busy={busy || undefined}
      className="space-y-3 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{S.title}</h2>
      {children}
    </section>
  );
}

/** The MCP part of an mcp-server Overview (mcp-server-card): what it runs, its secrets, policy and usage. */
export function McpServerCard({
  type,
  name,
  version,
  canManage,
}: {
  type: string;
  name: string;
  version: string;
  canManage: boolean;
}) {
  const q = useQuery({
    queryKey: ["mcp-card", name, version],
    queryFn: () => getMcpCard(name, version),
    enabled: type === "mcp-server",
    staleTime: 30_000,
    retry: false,
  });
  if (type !== "mcp-server") return null;
  if (q.isLoading) {
    return (
      <CardFrame busy>
        <p className="text-xs text-muted">{STR.common.loading}</p>
      </CardFrame>
    );
  }
  if (q.isError || !q.data) {
    return (
      <CardFrame>
        <p data-testid="mcp-card-error" role="alert" className="text-xs text-danger">
          {STR.apiErrors.request_failed}
        </p>
        <button
          type="button"
          data-testid="mcp-card-retry"
          className="min-h-8 rounded-sf border border-line px-3 py-1 text-xs"
          onClick={() => void q.refetch()}
        >
          {STR.common.retry}
        </button>
      </CardFrame>
    );
  }
  const S = STR.art.mcp;
  const card = q.data;
  const others = card.usage.other_versions ?? [];
  return (
    <CardFrame>
      <Packages card={card} />
      {card.tools.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-xs uppercase tracking-wide text-muted">{S.tools}</h3>
          <ul className="space-y-0.5">
            {card.tools.map((t) => (
              <li key={t.name} data-testid="mcp-card-tool" className="text-xs">
                <code translate="no">{t.name}</code>
                {t.description ? <span className="text-ink-2"> — {t.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Policy card={card} />
      <p data-testid="mcp-card-usage" className="text-xs text-muted">
        {S.usage(card.usage.installs, card.usage.people, card.usage.same_version)}
      </p>
      {others.length > 0 ? (
        <p data-testid="mcp-other-versions" className="text-xs text-muted">
          {S.otherVersions(others.map((i) => `${i.version} (${i.installs})`).join(", "))}
        </p>
      ) : null}
      <ReleaseBlock name={name} card={card} canManage={canManage} />
      <p className="text-xs text-muted">{S.installHint}</p>
    </CardFrame>
  );
}
