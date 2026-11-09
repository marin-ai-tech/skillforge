import { EXPORT_COLUMNS, type MetricsRow } from "./overview.ts";

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escape one CSV cell: numbers as-is, null empty, strings quoted with formula guard. */
export function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  let s = value;
  if (FORMULA_PREFIX.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function rowToCsvValues(row: MetricsRow): Array<string | number | null> {
  return EXPORT_COLUMNS.map((col) => row[col]);
}

/** UTF-8 CSV body with CRLF, header = columns, no BOM. */
export function metricsToCsv(items: MetricsRow[]): string {
  const lines: string[] = [];
  lines.push(EXPORT_COLUMNS.map((c) => csvCell(c)).join(","));
  for (const item of items) {
    lines.push(
      rowToCsvValues(item)
        .map((v) => csvCell(v))
        .join(","),
    );
  }
  return lines.join("\r\n") + (items.length >= 0 ? "\r\n" : "");
}

export function exportFilename(format: "csv" | "json", at = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  return `skillforge-metrics-${y}-${m}-${d}.${format}`;
}

export type JsonExport = {
  generated_at: string;
  truncated: boolean;
  columns: readonly string[];
  items: MetricsRow[];
};

export function metricsToJsonExport(
  items: MetricsRow[],
  truncated: boolean,
  at = new Date(),
): JsonExport {
  return {
    generated_at: at.toISOString(),
    truncated,
    columns: EXPORT_COLUMNS,
    items,
  };
}
