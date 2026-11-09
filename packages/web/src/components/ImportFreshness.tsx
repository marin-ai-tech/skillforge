import type { ImportPreviewResponse } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { formatDateTime } from "../i18n/index.ts";
import { HelpTip } from "./HelpTip.tsx";

/** Quarantine note on the import preview (import-source-policy); admins may give a reason to import now. */
export function ImportFreshness({
  source,
  isAdmin,
  reason,
  onReason,
}: {
  source: ImportPreviewResponse["source"];
  isAdmin: boolean;
  reason: string;
  onReason: (value: string) => void;
}) {
  const f = source.freshness;
  if (!f || f.ready) return null;
  return (
    <div
      data-testid="import-freshness"
      className="space-y-2 rounded-sf border border-line bg-surface-2 px-3 py-2 text-sm text-warning"
    >
      <div className="font-medium">{STR.import.freshTitle}</div>
      <p>
        {STR.import.freshText(
          formatDateTime(f.first_seen_at),
          formatDateTime(f.ready_at),
          f.required_days,
        )}
      </p>
      {isAdmin ? (
        <HelpTip action="import-age-override">
          <label className="block space-y-1 text-ink-2">
            <span>{STR.import.overrideLabel}</span>
            <input
              data-testid="import-age-override"
              className="w-full rounded-sf border border-line bg-bg px-3 py-1.5"
              value={reason}
              onChange={(e) => onReason(e.target.value)}
            />
          </label>
        </HelpTip>
      ) : null}
    </div>
  );
}
