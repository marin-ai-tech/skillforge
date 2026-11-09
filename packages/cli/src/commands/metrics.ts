import { ApiError } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";

export type MetricsFlags = {
  type?: string;
  status?: string;
  team?: string;
  q?: string;
  sort?: string;
  order?: string;
  limit?: string;
  offset?: string;
  csv?: boolean;
};

type MetricsRow = {
  type: string;
  name: string;
  display_name: string | null;
  status: string;
  transfer_rate: number | null;
  ablation_score: number | null;
  token_efficiency: number | null;
  sessions_count: number;
  skill_age_days: number;
  verification_pass_rate: number | null;
  uses: number;
};

type MetricsOverview = {
  totals: {
    artifacts: number;
    transfer_rate: number | null;
    sessions: number;
    with_ablation: number;
    ablation_mean: number | null;
    uses: number;
    helped: number;
    median_token_cost: number | null;
    by_status: Record<string, number>;
  };
  items: MetricsRow[];
  next_offset: number | null;
};

function qs(flags: MetricsFlags, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (flags.type) p.set("type", flags.type);
  if (flags.status) p.set("status", flags.status);
  if (flags.team) p.set("team", flags.team);
  if (flags.q) p.set("q", flags.q);
  if (flags.sort) p.set("sort", flags.sort);
  if (flags.order) p.set("order", flags.order);
  if (flags.limit) p.set("limit", flags.limit);
  if (flags.offset) p.set("offset", flags.offset);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function fmtNum(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined) return "-";
  if (!Number.isFinite(v)) return "-";
  return String(Number(v.toFixed(digits)));
}

function requireMetricsClient(
  ctx: AppContext,
): { client: ReturnType<typeof requireClient>["client"]; token: string | undefined } | null {
  try {
    const r = requireClient(ctx);
    return { client: r.client, token: r.token };
  } catch (e) {
    if (e instanceof ApiError) {
      ctx.out.error(e.message);
      setExit(e.exitCode);
      return null;
    }
    throw e;
  }
}

async function exportMetricsCsv(
  ctx: AppContext,
  client: ReturnType<typeof requireClient>["client"],
  token: string | undefined,
  flags: MetricsFlags,
): Promise<boolean> {
  if (!token && !client.cookie) {
    ctx.out.error("authentication required for CSV export");
    setExit(EXIT.UNAUTHORIZED);
    return false;
  }
  const res = await client.request("GET", `/api/v1/metrics/export${qs(flags, { format: "csv" })}`, {
    accept: "text/csv",
  });
  if (!res.ok) throw client.errorFromResult(res);
  const body =
    typeof res.text === "string" && res.text.length > 0 ? res.text : String(res.data ?? "");
  ctx.out.writeRaw(body.endsWith("\n") ? body : `${body}\n`);
  setExit(EXIT.OK);
  return true;
}

function printMetricsOverview(ctx: AppContext, data: MetricsOverview): void {
  const t = data.totals;
  ctx.out.write(
    `Totals: artifacts=${t.artifacts} transfer_rate=${fmtNum(t.transfer_rate)} sessions=${t.sessions} ablation_mean=${fmtNum(t.ablation_mean)} uses=${t.uses} helped=${t.helped}`,
  );
  const rows = data.items.map((i) => [
    i.type,
    i.name,
    i.status,
    fmtNum(i.transfer_rate),
    fmtNum(i.ablation_score),
    fmtNum(i.token_efficiency),
    String(i.sessions_count),
    String(i.uses),
  ]);
  ctx.out.printTable(
    ["type", "name", "status", "transfer_rate", "ablation", "token_eff", "sessions", "uses"],
    rows,
  );
  if (data.next_offset != null) {
    ctx.out.write(`next_offset=${data.next_offset}`);
  }
}

export async function runMetrics(ctx: AppContext, flags: MetricsFlags): Promise<void> {
  if (flags.csv && ctx.out.json) {
    ctx.out.error("--csv and --json are mutually exclusive");
    setExit(EXIT.INVALID_INPUT);
    return;
  }

  const resolved = requireMetricsClient(ctx);
  if (!resolved) return;
  const { client, token } = resolved;

  if (flags.csv) {
    await exportMetricsCsv(ctx, client, token, flags);
    return;
  }

  const res = await client.request("GET", `/api/v1/metrics/overview${qs(flags)}`);
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as MetricsOverview;

  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    printMetricsOverview(ctx, data);
  }
  setExit(EXIT.OK);
}
