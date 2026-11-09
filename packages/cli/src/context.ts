import { ApiError, SkillforgeClient, noRegistryError } from "./client.ts";
import { resolveRegistry } from "./config.ts";
import { EXIT, type ExitCode } from "./exit.ts";
import { Output } from "./output.ts";

export type GlobalOpts = {
  url?: string;
  token?: string;
  json?: boolean;
  noColor?: boolean;
};

export type AppContext = {
  out: Output;
  globals: GlobalOpts;
};

export function createContext(globals: GlobalOpts): AppContext {
  return {
    out: new Output({ json: globals.json, noColor: globals.noColor }),
    globals,
  };
}

export function requireClient(ctx: AppContext): {
  client: SkillforgeClient;
  url: string;
  token: string | undefined;
} {
  const resolved = resolveRegistry({
    url: ctx.globals.url,
    token: ctx.globals.token,
  });
  if (!resolved) throw noRegistryError();
  return {
    client: new SkillforgeClient({ url: resolved.url, token: resolved.token }),
    url: resolved.url,
    token: resolved.token,
  };
}

export function setExit(code: ExitCode): void {
  process.exitCode = code;
}

export function handleError(ctx: AppContext, err: unknown): void {
  if (err instanceof ApiError) {
    if (ctx.out.json && err.body !== undefined && typeof err.body === "object") {
      ctx.out.printJson(err.body);
    } else {
      ctx.out.error(err.message);
      if (
        err.body &&
        typeof err.body === "object" &&
        err.body !== null &&
        "error" in err.body &&
        typeof (err.body as { error: unknown }).error === "string"
      ) {
        // ensure digest_exists etc. appear in combined streams for tests that check stdout+stderr
        if (!err.message.includes((err.body as { error: string }).error)) {
          ctx.out.error((err.body as { error: string }).error);
        }
      }
    }
    setExit(err.exitCode);
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  ctx.out.error(msg);
  setExit(EXIT.VALIDATION);
}
