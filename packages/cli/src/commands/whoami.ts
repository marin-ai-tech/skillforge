import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";

export async function runWhoami(ctx: AppContext): Promise<void> {
  const { client } = requireClient(ctx);
  // Always call the API: missing token means no Authorization header (server 401 → exit 4).
  // Do not short-circuit before the request so mismatched --url cannot silently reuse another token.
  const res = await client.request("GET", "/api/v1/me");
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) {
    ctx.out.printJson(res.data);
  } else {
    const user = (res.data as { user?: { username?: string } })?.user;
    const username = user?.username ?? JSON.stringify(res.data);
    ctx.out.write(username);
  }
  setExit(EXIT.OK);
}
