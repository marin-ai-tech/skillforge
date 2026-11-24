import { SkillforgeClient } from "../client.ts";
import {
  checkProfileUrl,
  defaultConfigPath,
  isExplicitProfileSource,
  loadConfig,
  profileNotFoundError,
  removeRegistry,
  selectProfile,
  type RegistryEntry,
} from "../config.ts";
import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { setExit } from "../context.ts";

function finishLogout(ctx: AppContext): void {
  if (ctx.out.json) {
    ctx.out.printJson({ ok: true });
  } else {
    ctx.out.write("Logged out");
  }
  setExit(EXIT.OK);
}

async function revokeProfileToken(entry: RegistryEntry): Promise<void> {
  if (entry.token_id && entry.url && entry.token) {
    const client = new SkillforgeClient({ url: entry.url, token: entry.token });
    const res = await client.request("DELETE", `/api/v1/me/tokens/${entry.token_id}`);
    // ignore revoke failures (token may already be gone); still remove local entry
    void res;
  }
}

function warnKeptTokens(ctx: AppContext, entry: RegistryEntry): void {
  const keptExternalToken = Boolean(entry.token && !entry.token_id);
  const keptMcpToken = Boolean(entry.mcp_token);
  if (keptExternalToken && !ctx.out.json) {
    ctx.out.write("Token was not created by the CLI and is kept; revoke it on the API tokens page");
  }
  if (keptMcpToken && !ctx.out.json) {
    ctx.out.write("The MCP token is kept; revoke it on the API tokens page");
  }
}

export async function runLogout(ctx: AppContext): Promise<void> {
  const configPath = defaultConfigPath();
  const cfg = loadConfig(configPath);
  const selected = selectProfile({ profile: ctx.globals.profile, url: ctx.globals.url }, cfg);
  const name = selected.name;
  if (!name || !cfg.registries[name]) {
    if (isExplicitProfileSource(selected.source)) {
      throw profileNotFoundError(name ?? "", selected.source, configPath, cfg);
    }
    finishLogout(ctx);
    return;
  }
  const entry = cfg.registries[name];
  if (isExplicitProfileSource(selected.source)) {
    checkProfileUrl(name, selected.source, entry, { url: ctx.globals.url });
  }
  await revokeProfileToken(entry);
  removeRegistry(name);
  warnKeptTokens(ctx, entry);
  finishLogout(ctx);
}
