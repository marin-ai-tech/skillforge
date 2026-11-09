import { currentSigningKeyId } from "../verify.ts";
import os from "node:os";
import { ApiError, SkillforgeClient } from "../client.ts";
import { entryNameFromUrl, upsertRegistry, type RegistryEntry } from "../config.ts";
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
  name?: string;
};

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
