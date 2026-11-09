import { readBlob } from "../blobs.ts";
import type { Database } from "../repo.ts";
import { getVersion } from "../repo.ts";

/** One input slot of the card: names and flags only, never `value` or `default`. */
export type CardInput = {
  name: string;
  description: string | null;
  isRequired: boolean;
  isSecret: boolean;
};

export type McpCardDescriptor = {
  packages: Array<{
    registryType: string;
    identifier: string;
    version: string | null;
    runtimeHint: string | null;
    transport: string;
    env: CardInput[];
  }>;
  remotes: Array<{ type: string; url: string; origin: string | null; headers: CardInput[] }>;
  tools: Array<{ name: string; description: string | null }>;
};

type Obj = Record<string, unknown>;
const TEMPLATE_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

function inputs(list: unknown): CardInput[] {
  return objects(list)
    .filter((i) => typeof i.name === "string")
    .map((i) => ({
      name: i.name as string,
      description: str(i.description),
      isRequired: i.isRequired === true,
      isSecret: i.isSecret === true,
    }));
}

/** `scheme://host[:port]` of a remote URL, `{templates}` read as their names. */
export function remoteOrigin(url: string): string | null {
  try {
    const u = new URL(url.replace(TEMPLATE_RE, "$1"));
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** The whitelist of the card: what a reviewer needs, nothing that could carry a value. */
export function cardOf(obj: Obj): McpCardDescriptor {
  return {
    packages: objects(obj.packages).map((p) => ({
      registryType: str(p.registryType) ?? "",
      identifier: str(p.identifier) ?? "",
      version: str(p.version),
      runtimeHint: str(p.runtimeHint),
      transport: isObj(p.transport) ? (str(p.transport.type) ?? "") : "",
      env: inputs(p.environmentVariables),
    })),
    remotes: objects(obj.remotes).map((r) => {
      const url = str(r.url) ?? "";
      return {
        type: str(r.type) ?? "",
        url,
        origin: remoteOrigin(url),
        headers: inputs(r.headers),
      };
    }),
    tools: objects(obj.tools)
      .filter((t) => typeof t.name === "string")
      .map((t) => ({ name: t.name as string, description: str(t.description) })),
  };
}

/** `server.json` of one version: its bytes and parsed object, or null. */
export function versionDescriptor(
  db: Database,
  dataDir: string,
  artifactId: string,
  version: string,
): { raw: Uint8Array; obj: Obj } | null {
  const detail = getVersion(db, artifactId, version);
  const file = detail?.files.find((f) => /(^|\/)server\.json$/.test(f.path));
  if (!file) return null;
  try {
    const raw = readBlob(dataDir, file.sha256);
    const obj = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
    return isObj(obj) ? { raw, obj } : null;
  } catch {
    return null;
  }
}

/** Package identifiers and remote origins that identify this server in the inventory. */
export function identitiesOf(card: McpCardDescriptor): {
  packages: Set<string>;
  origins: Set<string>;
} {
  return {
    packages: new Set(card.packages.map((p) => p.identifier).filter(Boolean)),
    origins: new Set(card.remotes.map((r) => r.origin).filter((o): o is string => o !== null)),
  };
}
