import { EXIT } from "../exit.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";

export function parseTypeName(spec: string): { type: string; name: string; version?: string } {
  const at = spec.indexOf("@");
  const main = at >= 0 ? spec.slice(0, at) : spec;
  const version = at >= 0 ? spec.slice(at + 1) : undefined;
  const slash = main.indexOf("/");
  if (slash < 0) {
    throw new Error(`expected <type>/<name>, got: ${spec}`);
  }
  return {
    type: main.slice(0, slash),
    name: main.slice(slash + 1),
    ...(version ? { version } : {}),
  };
}

export async function runInfo(ctx: AppContext, spec: string): Promise<void> {
  const { client } = requireClient(ctx);
  const { type, name } = parseTypeName(spec);
  const res = await client.request("GET", `/api/v1/artifacts/${type}/${name}`);
  if (!res.ok) throw client.errorFromResult(res);

  if (ctx.out.json) {
    ctx.out.printJson(res.data);
    setExit(EXIT.OK);
    return;
  }

  const data = res.data as {
    artifact: {
      type: string;
      name: string;
      description: string;
      status: string;
      tags: string[];
      download_count: number;
      latest_version: string | null;
    };
    latest: {
      version: string;
      provenance?: { source?: string; ref?: string | null };
      changelog?: string | null;
    } | null;
    versions: Array<{ version: string }>;
    install: {
      marketplace_name: string;
      marketplace_url: string;
      plugin_name: string;
    };
  };

  const a = data.artifact;
  ctx.out.write(`${a.type}/${a.name}`);
  ctx.out.write(`description: ${a.description}`);
  ctx.out.write(`status: ${a.status}`);
  const versions = data.versions.map((v) => v.version).join(", ");
  ctx.out.write(`versions: ${versions}`);
  if (data.latest?.provenance) {
    const p = data.latest.provenance;
    ctx.out.write(`provenance: ${p.source}${p.ref ? `:${p.ref}` : ""}`);
  }
  if (a.tags?.length) ctx.out.write(`tags: ${a.tags.join(", ")}`);
  ctx.out.write(`downloads: ${a.download_count}`);
  ctx.out.write(`/plugin marketplace add ${data.install.marketplace_url}`);
  ctx.out.write(`/plugin install ${data.install.plugin_name}@${data.install.marketplace_name}`);
  setExit(EXIT.OK);
}
