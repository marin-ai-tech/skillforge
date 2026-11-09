import type { AppContext } from "../context.ts";

function resolveHealthUrl(urlOption: string | undefined): string {
  if (urlOption && urlOption.length > 0) return urlOption.replace(/\/$/, "");
  const fromEnv = process.env.SKILLFORGE_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  return "http://127.0.0.1:8787";
}

export async function runHealth(ctx: AppContext, urlOption: string | undefined): Promise<void> {
  const base = resolveHealthUrl(urlOption ?? ctx.globals.url);
  const endpoint = `${base}/api/v1/health`;
  try {
    const res = await fetch(endpoint);
    if (res.status !== 200) {
      ctx.out.error(`health check failed for ${base}: HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    const body = (await res.json()) as { status?: string };
    if (body.status !== "ok") {
      ctx.out.error(`health check failed for ${base}: status is not ok`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.out.error(`health check failed for ${base}: ${msg}`);
    process.exitCode = 1;
  }
}
