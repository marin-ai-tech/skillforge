import { SkillforgeClient } from "../client.ts";
import { loadConfig, removeRegistry } from "../config.ts";
import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { setExit } from "../context.ts";

export async function runLogout(ctx: AppContext): Promise<void> {
  const cfg = loadConfig();
  const name = cfg.default;
  const entry = name ? cfg.registries[name] : undefined;

  const keptExternalToken = Boolean(entry && !entry.token_id);

  if (entry?.token_id && entry.url && entry.token) {
    const client = new SkillforgeClient({ url: entry.url, token: entry.token });
    const res = await client.request("DELETE", `/api/v1/me/tokens/${entry.token_id}`);
    // ignore revoke failures (token may already be gone); still remove local entry
    void res;
  }

  removeRegistry(name);

  if (keptExternalToken && !ctx.out.json) {
    ctx.out.write("Token was not created by the CLI and is kept; revoke it on the API tokens page");
  }

  if (ctx.out.json) {
    ctx.out.printJson({ ok: true });
  } else {
    ctx.out.write("Logged out");
  }
  setExit(EXIT.OK);
}
