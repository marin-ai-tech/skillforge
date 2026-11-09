import { useQuery } from "@tanstack/react-query";
import { getOverlays } from "../api/client.ts";
import { useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";

const LAYERED = new Set(["skill", "command", "agent"]);

/** Layers of edits that apply to the viewer (artifact-overlays): company → teams → own; the CLI applies them. */
export function OverlaysPanel({ type, name }: { type: string; name: string }) {
  const me = useMe();
  const enabled = Boolean(me.data) && LAYERED.has(type);
  const q = useQuery({
    queryKey: ["overlays", type, name],
    queryFn: () => getOverlays(type, name),
    enabled,
  });
  const layers = q.data?.layers ?? [];
  if (!enabled || layers.length === 0) return null;
  const S = STR.art.overview;
  return (
    <section
      data-testid="overlays"
      className="space-y-2 rounded-sf border border-line bg-surface p-4 text-sm"
    >
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted">{S.overlaysTitle}</h3>
      <p className="text-xs text-ink-2">{S.overlaysNote}</p>
      <ul className="space-y-1">
        {layers.map((l) => (
          <li key={l.scope} data-testid="overlay-layer">
            <span translate="no" className="font-mono text-xs">
              {l.scope}
            </span>{" "}
            <span className="text-xs text-muted">
              {l.ops.map((o) => `${o.op} ${o.path}`).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
