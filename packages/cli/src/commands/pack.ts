import { ApiError } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { installOne, type InstallFlags } from "./install.ts";

/**
 * `skillforge pack install|list` (method-packs): a team method pack — roles with artifacts at exact versions — in one
 * command. Every item goes through the usual install with its version as the pin, so `sync` keeps it there.
 */
type PackItem = { type: string; name: string; version: string };
type PackVersion = {
  version: string;
  title: string;
  roles: Array<{ name: string; items: PackItem[] }>;
};

function splitSpec(spec: string): { name: string; version: string | null } {
  const [name = "", version] = spec.split("@");
  return { name, version: version ?? null };
}

async function fetchVersion(ctx: AppContext, spec: string): Promise<PackVersion> {
  const { client } = requireClient(ctx);
  const { name, version } = splitSpec(spec);
  const path = version
    ? `/api/v1/packs/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`
    : `/api/v1/packs/${encodeURIComponent(name)}`;
  const res = await client.request("GET", path);
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as { version?: PackVersion; latest?: PackVersion | null };
  const v = version ? data.version : data.latest;
  if (!v) throw new ApiError(`pack ${name} has no published version`, EXIT.NOT_FOUND);
  return v;
}

/** Items of the chosen role (or all roles), each artifact once. */
function itemsFor(pack: PackVersion, role: string | undefined): PackItem[] {
  const roles = role ? pack.roles.filter((r) => r.name === role) : pack.roles;
  if (role && roles.length === 0) {
    const names = pack.roles.map((r) => r.name).join(", ");
    throw new ApiError(`role ${role} is not in the pack (roles: ${names})`, EXIT.INVALID_INPUT);
  }
  const seen = new Map<string, PackItem>();
  for (const item of roles.flatMap((r) => r.items)) seen.set(`${item.type}/${item.name}`, item);
  return [...seen.values()];
}

export async function runPackInstall(
  ctx: AppContext,
  spec: string,
  flags: InstallFlags & { role?: string },
): Promise<void> {
  const pack = await fetchVersion(ctx, spec);
  const items = itemsFor(pack, flags.role);
  const { client, url } = requireClient(ctx);
  const installed = [];
  for (const item of items) {
    installed.push(
      await installOne(
        ctx,
        client,
        url,
        `${item.type}/${item.name}@${item.version}`,
        flags,
        ctx.out.json,
      ),
    );
  }
  if (ctx.out.json) {
    ctx.out.printJson({
      pack: splitSpec(spec).name,
      version: pack.version,
      role: flags.role ?? null,
      installed,
    });
  } else {
    ctx.out.write(
      `Pack ${splitSpec(spec).name}@${pack.version}: ${installed.length} artifacts at pinned versions.`,
    );
  }
  setExit(EXIT.OK);
}

export async function runPackList(ctx: AppContext): Promise<void> {
  const { client } = requireClient(ctx);
  const res = await client.request("GET", "/api/v1/packs");
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as {
    items: Array<{ name: string; title: string; latest_version: string | null }>;
  };
  if (ctx.out.json) ctx.out.printJson(data);
  else
    ctx.out.printTable(
      ["name", "version", "title"],
      data.items.map((p) => [p.name, p.latest_version ?? "-", p.title]),
    );
  setExit(EXIT.OK);
}
