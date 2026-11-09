import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { ApiError } from "../client.ts";
import { EXIT, exitFromHttpStatus, type ExitCode } from "../exit.ts";
import {
  defaultConfigPath,
  loadConfig,
  resolveRegistry,
  type ResolvedRegistry,
} from "../config.ts";

export type DoctorOpts = {
  bundle?: boolean;
  output?: string;
};

export type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
  severity?: "error" | "warn" | "info";
};

function defaultBundlePath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(process.cwd(), `skillforge-diagnostics-${stamp}.tar.gz`);
}

function parseEnginesNode(raw: string | undefined): { minMajor: number } | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/>=\s*(\d+)/);
  if (!m) return null;
  const minMajor = Number(m[1]);
  if (!Number.isFinite(minMajor)) return null;
  return { minMajor };
}

function checkCliConfig(resolved: ResolvedRegistry | null): DoctorCheck {
  const configPath = defaultConfigPath();
  const configExists = fs.existsSync(configPath);
  const cfg = loadConfig(configPath);
  const defaultName = cfg.default;
  const defaultEntry = defaultName ? cfg.registries[defaultName] : undefined;
  const hasDefaultEntry = Boolean(defaultEntry?.url);
  if (!configExists) {
    if (resolved?.url) {
      return {
        id: "cli_config",
        ok: true,
        message: `no config file at ${configPath}; registry resolved from flags/environment`,
        severity: "info",
      };
    }
    return {
      id: "cli_config",
      ok: false,
      message: `missing config at ${configPath}`,
      severity: "error",
    };
  }
  if (!hasDefaultEntry) {
    if (resolved?.url) {
      return {
        id: "cli_config",
        ok: true,
        message: `config at ${configPath} has no default entry; registry resolved from flags/environment`,
        severity: "info",
      };
    }
    return {
      id: "cli_config",
      ok: false,
      message: `config found at ${configPath} but no default registry entry`,
      severity: "error",
    };
  }
  return {
    id: "cli_config",
    ok: true,
    message: `config found at ${configPath} (default: ${defaultName})`,
    severity: "error",
  };
}

function checkRegistryUrl(resolved: ResolvedRegistry | null): DoctorCheck {
  if (resolved?.url) {
    return {
      id: "registry_url",
      ok: true,
      message: `registry URL resolved: ${resolved.url}`,
      severity: "error",
    };
  }
  return {
    id: "registry_url",
    ok: false,
    message: "no registry URL (set --url, SKILLFORGE_URL, or run skillforge login)",
    severity: "error",
  };
}

function checkCredentials(resolved: ResolvedRegistry | null): DoctorCheck {
  const hasToken = Boolean(resolved?.token && resolved.token.length > 0);
  return {
    id: "credentials",
    ok: hasToken,
    message: hasToken
      ? "credentials present (token not printed)"
      : "no credentials/token configured (optional for public health; needed for authenticated commands)",
    severity: "warn",
  };
}

function checkNodeRuntime(): DoctorCheck {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0] ?? "0");
  let enginesRaw: string | undefined;
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        engines?: { node?: string };
      };
      enginesRaw = pkg.engines?.node;
    }
  } catch {
    enginesRaw = undefined;
  }
  const parsed = parseEnginesNode(enginesRaw);
  if (!parsed) {
    return {
      id: "node_runtime",
      ok: true,
      message: `Node ${nodeVersion} (no package engines constraint; skipped)`,
      severity: "info",
    };
  }
  const ok = major >= parsed.minMajor;
  return {
    id: "node_runtime",
    ok,
    message: ok
      ? `Node ${nodeVersion} satisfies engines.node ${enginesRaw}`
      : `Node ${nodeVersion} does not satisfy engines.node ${enginesRaw}`,
    severity: ok ? "info" : "warn",
  };
}

async function probeServerHealth(baseUrl: string): Promise<DoctorCheck> {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/v1/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (res.status !== 200) {
      return {
        id: "server_health",
        ok: false,
        message: `health check failed for ${baseUrl}: HTTP ${res.status}`,
        severity: "error",
      };
    }
    const body = (await res.json()) as { status?: string };
    if (body.status !== "ok") {
      return {
        id: "server_health",
        ok: false,
        message: `health check failed for ${baseUrl}: status is not ok`,
        severity: "error",
      };
    }
    return {
      id: "server_health",
      ok: true,
      message: `server healthy at ${baseUrl}`,
      severity: "info",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: "server_health",
      ok: false,
      message: `server unreachable at ${baseUrl}: ${msg}`,
      severity: "error",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkServerHealth(resolved: ResolvedRegistry | null): Promise<DoctorCheck> {
  if (!resolved?.url) {
    return {
      id: "server_health",
      ok: false,
      message: "skipped server_health: no registry URL",
      severity: "error",
    };
  }
  return probeServerHealth(resolved.url);
}

function errorFails(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((c) => (c.severity ?? "error") === "error" && !c.ok);
}

function warnFails(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((c) => c.severity === "warn" && !c.ok);
}

function aggregateStatus(
  resolved: ResolvedRegistry | null,
  fails: DoctorCheck[],
  aggregateOk: boolean,
): string {
  if (!resolved?.url) return "missing_config";
  if (fails.some((c) => c.id === "server_health")) return "unreachable";
  if (aggregateOk) return "ok";
  return "degraded";
}

function aggregateSummary(
  fails: DoctorCheck[],
  warns: DoctorCheck[],
  aggregateOk: boolean,
): string {
  if (!aggregateOk) return `Failed checks: ${fails.map((c) => c.id).join(", ")}`;
  if (warns.length > 0) return `All error checks passed (${warns.length} warning(s))`;
  return "All checks passed";
}

function exitForDoctor(
  resolved: ResolvedRegistry | null,
  fails: DoctorCheck[],
  aggregateOk: boolean,
): ExitCode {
  if (aggregateOk) return EXIT.OK;
  if (!resolved?.url) return EXIT.UNREACHABLE;
  if (fails.some((c) => c.id === "server_health")) return EXIT.UNREACHABLE;
  return EXIT.VALIDATION;
}

function printDoctorResult(
  ctx: AppContext,
  payload: { ok: boolean; checks: DoctorCheck[]; status: string; summary: string },
): void {
  if (ctx.out.json) {
    ctx.out.printJson(payload);
    return;
  }
  ctx.out.write(ctx.out.bold("skillforge doctor - health checklist"));
  for (const c of payload.checks) {
    const mark = c.ok ? "ok" : (c.severity ?? "error") === "warn" ? "warn" : "FAIL";
    ctx.out.write(`  [${mark}] ${c.id}: ${c.message}`);
  }
  ctx.out.write(`status: ${payload.status}`);
  ctx.out.write(`summary: ${payload.summary}`);
}

/** Non-bundle health/status checklist for skillforge doctor. */
async function runDoctorChecks(ctx: AppContext): Promise<void> {
  const resolved = resolveRegistry({
    url: ctx.globals.url,
    token: ctx.globals.token,
  });
  const checks: DoctorCheck[] = [
    checkCliConfig(resolved),
    checkRegistryUrl(resolved),
    checkCredentials(resolved),
    await checkServerHealth(resolved),
    checkNodeRuntime(),
  ];
  const fails = errorFails(checks);
  const warns = warnFails(checks);
  const aggregateOk = fails.length === 0;
  const payload = {
    ok: aggregateOk,
    checks,
    status: aggregateStatus(resolved, fails, aggregateOk),
    summary: aggregateSummary(fails, warns, aggregateOk),
  };
  printDoctorResult(ctx, payload);
  setExit(exitForDoctor(resolved, fails, aggregateOk));
}

/** Download admin diagnostics bundle from the server and write it to disk. */
async function runDoctorBundle(ctx: AppContext, opts: DoctorOpts): Promise<void> {
  let client: ReturnType<typeof requireClient>["client"];
  let url: string;
  try {
    ({ client, url } = requireClient(ctx));
  } catch (e) {
    if (e instanceof ApiError) {
      ctx.out.error(e.message);
      setExit(e.exitCode);
      return;
    }
    throw e;
  }

  const outPath =
    opts.output && opts.output.length > 0 ? path.resolve(opts.output) : defaultBundlePath();
  const endpoint = "/api/v1/admin/diagnostics/bundle";

  try {
    const result = await client.request("GET", endpoint, {
      accept: "application/gzip",
      raw: true,
    });
    if (!result.ok) {
      ctx.out.error(`doctor --bundle failed for ${url}: HTTP ${result.status}`);
      setExit(exitFromHttpStatus(result.status));
      return;
    }
    const bytes = Buffer.isBuffer(result.data)
      ? result.data
      : Buffer.from(result.data as Uint8Array);
    fs.writeFileSync(outPath, bytes);
    if (ctx.out.json) {
      ctx.out.printJson({ ok: true, path: outPath, bytes: bytes.length });
    } else {
      ctx.out.write(`Wrote diagnostics bundle to ${outPath} (${bytes.length} bytes)`);
    }
    setExit(EXIT.OK);
  } catch (e) {
    if (e instanceof ApiError) {
      ctx.out.error(e.message);
      setExit(e.exitCode);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    ctx.out.error(`doctor --bundle failed: ${msg}`);
    setExit(EXIT.UNREACHABLE);
  }
}

/**
 * skillforge doctor: non-bundle health/status checklist by default;
 * with --bundle, download the admin diagnostics archive (existing path).
 */
export async function runDoctor(ctx: AppContext, opts: DoctorOpts): Promise<void> {
  if (opts.bundle) {
    await runDoctorBundle(ctx, opts);
    return;
  }
  // Non-bundle checklist - never throw on missing config / unreachable.
  try {
    await runDoctorChecks(ctx);
  } catch (e) {
    if (e instanceof ApiError) {
      ctx.out.error(e.message);
      setExit(e.exitCode);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    ctx.out.error(`doctor checklist failed: ${msg}`);
    setExit(EXIT.VALIDATION);
  }
}
