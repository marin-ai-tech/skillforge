import { readFileSync } from "node:fs";
import { Client, InvalidCredentialsError } from "ldapts";
import type { LdapProviderConfig } from "./types.ts";
import { buildUserFilter } from "./escape.ts";

export type LdapAuthSuccess = {
  ok: true;
  dn: string;
  username: string;
  displayName: string | null;
  email: string | null;
  groups: string[];
};

export type LdapAuthFailure = {
  ok: false;
  error: "invalid_credentials" | "ldap_unavailable";
};

export type LdapAuthResult = LdapAuthSuccess | LdapAuthFailure;

function attrValues(entry: Record<string, unknown>, name: string): string[] {
  const raw = entry[name] ?? entry[name.toLowerCase()];
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") return [raw];
  if (Buffer.isBuffer(raw)) return [raw.toString("utf8")];
  if (Array.isArray(raw)) {
    return raw.map((v) => (Buffer.isBuffer(v) ? v.toString("utf8") : String(v)));
  }
  return [String(raw)];
}

function firstAttr(entry: Record<string, unknown>, name: string): string | null {
  const vals = attrValues(entry, name);
  return vals[0] ?? null;
}

function searchAttributes(provider: LdapProviderConfig): string[] {
  return [
    provider.username_attribute,
    ...(provider.display_name_attribute ? [provider.display_name_attribute] : []),
    ...(provider.email_attribute ? [provider.email_attribute] : []),
    provider.group_attribute,
  ];
}

type TlsOptionsResult =
  { ok: true; tlsOptions: import("node:tls").ConnectionOptions | undefined } | { ok: false };

function loadTlsOptions(provider: LdapProviderConfig): TlsOptionsResult {
  if (!provider.tls_ca_file) return { ok: true, tlsOptions: undefined };
  try {
    return { ok: true, tlsOptions: { ca: readFileSync(provider.tls_ca_file) } };
  } catch {
    return { ok: false };
  }
}

function userBindFailure(err: unknown): LdapAuthFailure {
  if (err instanceof InvalidCredentialsError) {
    return { ok: false, error: "invalid_credentials" };
  }
  // Some servers return generic errors for bad password; treat as invalid_credentials
  // when we already found the user. Connection drops after search still map carefully.
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("invalid credentials") || msg.includes("49")) {
    return { ok: false, error: "invalid_credentials" };
  }
  return { ok: false, error: "invalid_credentials" };
}

function successFromEntry(
  provider: LdapProviderConfig,
  entry: Record<string, unknown>,
  dn: string,
  username: string,
): LdapAuthSuccess {
  const uname = firstAttr(entry, provider.username_attribute) ?? username;
  const displayName = provider.display_name_attribute
    ? firstAttr(entry, provider.display_name_attribute)
    : null;
  const email = provider.email_attribute ? firstAttr(entry, provider.email_attribute) : null;
  const groups = attrValues(entry, provider.group_attribute);

  return {
    ok: true,
    dn,
    username: uname,
    displayName,
    email,
    groups,
  };
}

export async function authenticateLdapUser(
  provider: LdapProviderConfig,
  username: string,
  password: string,
): Promise<LdapAuthResult> {
  const filter = buildUserFilter(provider.user_filter, username);
  const attrs = searchAttributes(provider);

  const tls = loadTlsOptions(provider);
  if (!tls.ok) return { ok: false, error: "ldap_unavailable" };
  const tlsOptions = tls.tlsOptions;

  const client = new Client({
    url: provider.url,
    timeout: provider.timeout_ms,
    connectTimeout: provider.timeout_ms,
    tlsOptions,
  });

  try {
    try {
      await client.bind(provider.bind_dn, provider.bind_password);
    } catch {
      return { ok: false, error: "ldap_unavailable" };
    }

    let searchEntries;
    try {
      const result = await client.search(provider.user_base, {
        scope: "sub",
        filter,
        attributes: attrs,
        sizeLimit: 2,
      });
      searchEntries = result.searchEntries;
    } catch {
      return { ok: false, error: "ldap_unavailable" };
    }

    if (!searchEntries || searchEntries.length !== 1) {
      return { ok: false, error: "invalid_credentials" };
    }

    const entry = searchEntries[0] as Record<string, unknown> & { dn: string };
    const dn = typeof entry.dn === "string" ? entry.dn : String(entry.dn);

    try {
      await client.bind(dn, password);
    } catch (err) {
      return userBindFailure(err);
    }

    return successFromEntry(provider, entry, dn, username);
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}
