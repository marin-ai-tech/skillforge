import { currentSigningKeyId } from "../verify.ts";
import os from "node:os";
import readline from "node:readline";
import { ApiError, SkillforgeClient } from "../client.ts";
import { entryNameFromUrl, saveMcpToken, upsertRegistry, type RegistryEntry } from "../config.ts";
import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { setExit } from "../context.ts";

async function readPasswordStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  return firstLine.replace(/\r$/, "");
}

export type LoginOpts = {
  url: string;
  token?: string;
  username?: string;
  passwordStdin?: boolean;
  mcpTokenStdin?: boolean;
  name?: string;
};

/** First line of stdin; on a terminal prompts on stderr and returns after one line (no EOF wait). */
async function readFirstLineStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write("Paste the MCP token and press Enter: ");
  }
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });
  try {
    for await (const line of rl) {
      return line.replace(/\r$/, "").trim();
    }
    return "";
  } finally {
    rl.close();
    process.stdin.pause();
  }
}

function errorCodeOf(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { error?: unknown; code?: unknown };
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error === "object") {
      const err = body.error as { code?: unknown; message?: unknown };
      if (typeof err.code === "string") return err.code;
      if (typeof err.message === "string") return err.message;
    }
    if (typeof body.code === "string") return body.code;
  } catch {
    /* not JSON */
  }
  return undefined;
}

const MCP_PROBE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "skillforge-cli", version: "1" },
  },
});

/** Saves a token with MCP consent for the stdio bridge after checking it against <base>/mcp. */
async function runSaveMcpToken(ctx: AppContext, base: string, opts: LoginOpts): Promise<void> {
  if ((opts.token && opts.token.length > 0) || opts.passwordStdin) {
    ctx.out.error("--mcp-token-stdin cannot be combined with --token or --password-stdin");
    setExit(EXIT.VALIDATION);
    return;
  }
  const token = await readFirstLineStdin();
  if (!token) {
    ctx.out.error("No MCP token on stdin");
    setExit(EXIT.VALIDATION);
    return;
  }

  let res: Response;
  try {
    res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: MCP_PROBE,
    });
  } catch (e) {
    ctx.out.error(`Cannot reach ${base}/mcp: ${e instanceof Error ? e.message : String(e)}`);
    setExit(EXIT.UNREACHABLE);
    return;
  }
  const text = await res.text().catch(() => "");

  if (res.status === 403) {
    const code = errorCodeOf(text) ?? "forbidden";
    const reason = text.includes("mcp_not_allowed") ? "mcp_not_allowed" : code;
    ctx.out.error(
      `This token is not allowed for MCP (${reason}): create a token with "Allow agents to load active skills via MCP" on the API tokens page`,
    );
    setExit(EXIT.UNAUTHORIZED);
    return;
  }
  if (res.status === 401) {
    ctx.out.error("The MCP token was refused (401): it is invalid, expired or revoked");
    setExit(EXIT.UNAUTHORIZED);
    return;
  }
  if (res.status !== 200) {
    ctx.out.error(`Checking the MCP token failed: HTTP ${res.status}`);
    setExit(res.status >= 500 ? EXIT.UNREACHABLE : EXIT.VALIDATION);
    return;
  }

  const name = saveMcpToken(base, token, opts.name);

  if (process.platform === "win32") {
    ctx.out.error(
      "Warning: on Windows, config file permissions (mode 0600) may not restrict access; protect your SkillForge config.",
    );
  }
  if (ctx.out.json) {
    ctx.out.printJson({ ok: true, name, url: base, mcp_token: "saved" });
  } else {
    ctx.out.write(`Saved the MCP token for ${base}`);
  }
  setExit(EXIT.OK);
}

async function loginWithToken(
  client: SkillforgeClient,
  base: string,
  token: string,
  entryName: string,
): Promise<{ entry: RegistryEntry; username: string }> {
  const me = await client.request("GET", "/api/v1/me", { token });
  if (!me.ok) throw client.errorFromResult(me);
  const meUser = (me.data as { user?: { username?: string } })?.user;
  return {
    username: meUser?.username ?? entryName,
    entry: { url: base, token },
  };
}

async function loginWithPassword(
  client: SkillforgeClient,
  base: string,
  username: string,
): Promise<{ entry: RegistryEntry; username: string }> {
  const password = await readPasswordStdin();
  const login = await client.request("POST", "/api/v1/auth/login", {
    body: { username, password },
    token: null,
  });
  if (!login.ok) throw client.errorFromResult(login);
  if (!client.cookie) {
    throw new ApiError("login did not return session cookie", EXIT.UNAUTHORIZED);
  }
  const tok = await client.request("POST", "/api/v1/me/tokens", {
    body: { name: `cli ${os.hostname()}` },
    token: null,
    cookie: client.cookie,
  });
  if (!tok.ok) throw client.errorFromResult(tok);
  const data = tok.data as { id?: string; token?: string };
  if (!data.token) {
    throw new ApiError("token create failed", EXIT.VALIDATION, tok.status, tok.data);
  }
  return {
    username,
    entry: {
      url: base,
      token: data.token,
      ...(data.id ? { token_id: data.id } : {}),
    },
  };
}

export async function runLogin(ctx: AppContext, opts: LoginOpts): Promise<void> {
  const base = opts.url.replace(/\/$/, "");
  if (!base) {
    ctx.out.error("Missing --url");
    setExit(EXIT.VALIDATION);
    return;
  }

  if (opts.mcpTokenStdin) {
    await runSaveMcpToken(ctx, base, opts);
    return;
  }

  const entryName = opts.name && opts.name.length > 0 ? opts.name : entryNameFromUrl(base);
  const client = new SkillforgeClient({ url: base });

  let authenticated: { entry: RegistryEntry; username: string } | null = null;
  if (opts.token && opts.token.length > 0) {
    authenticated = await loginWithToken(client, base, opts.token, entryName);
  } else if (opts.username && opts.passwordStdin) {
    authenticated = await loginWithPassword(client, base, opts.username);
  }

  if (!authenticated) {
    ctx.out.error("Provide --token or --username with --password-stdin");
    setExit(EXIT.VALIDATION);
    return;
  }

  const { entry, username } = authenticated;
  const keyId = await currentSigningKeyId(client);
  upsertRegistry(entryName, keyId ? { ...entry, signing_key_id: keyId } : entry);

  if (process.platform === "win32") {
    ctx.out.error(
      "Warning: on Windows, config file permissions (mode 0600) may not restrict access; protect your SkillForge config.",
    );
  }

  if (ctx.out.json) {
    ctx.out.printJson({ ok: true, name: entryName, url: base, username });
  } else {
    ctx.out.write(`Logged in to ${base} as ${username}`);
  }
  setExit(EXIT.OK);
}
