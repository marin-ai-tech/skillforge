import { ApiError } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

function invalid(message: string): never {
  throw new ApiError(message, EXIT.VALIDATION);
}

function hasControl(value: string, allowNewline = false): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return (code < 32 && !(allowNewline && code === 10)) || code === 127;
  });
}

function ref(spec: string, versionAllowed: boolean) {
  const parsed = parseTypeName(spec);
  if (
    !/^[a-z][a-z0-9-]*$/.test(parsed.type) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.name) ||
    (parsed.version !== undefined &&
      (!versionAllowed || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?$/.test(parsed.version)))
  ) {
    invalid(`invalid artifact reference: ${spec}`);
  }
  return parsed;
}

export type MetadataFlags = {
  displayName?: string;
  description?: string;
  tags?: string;
  reset?: string[];
};

function buildMetadataBody(flags: MetadataFlags): Record<string, string | string[] | null> {
  const body: Record<string, string | string[] | null> = {};
  if (flags.displayName !== undefined) body.display_name = flags.displayName;
  if (flags.description !== undefined) body.description = flags.description;
  if (flags.tags !== undefined) body.tags = flags.tags.split(",").map((tag) => tag.trim());
  for (const field of flags.reset ?? []) {
    if (!["display_name", "description", "tags"].includes(field))
      invalid(`invalid --reset field: ${field}`);
    if (body[field] !== undefined) invalid(`cannot set and reset ${field} together`);
    body[field] = null;
  }
  return body;
}

function validateMetadataBody(body: Record<string, string | string[] | null>): void {
  if (Object.keys(body).length === 0) invalid("provide a metadata field or --reset");
  if (
    typeof body.display_name === "string" &&
    (body.display_name.length > 100 || hasControl(body.display_name))
  )
    invalid("invalid display name");
  if (
    typeof body.description === "string" &&
    (body.description.length > 1024 || hasControl(body.description, true))
  )
    invalid("invalid description");
  if (
    Array.isArray(body.tags) &&
    (body.tags.length > 20 ||
      new Set(body.tags).size !== body.tags.length ||
      body.tags.some((tag) => !/^[a-z0-9][a-z0-9._-]{0,39}$/.test(tag)))
  )
    invalid("invalid tags");
}

function printPurgeResult(
  ctx: AppContext,
  spec: string,
  data: {
    purged: string;
    blobs_deleted: number;
    blobs_failed: string[];
    blobs_shared: Array<{ sha256: string; versions: string[] }>;
    backups_predating: string[];
    backups_deleted: string[];
  },
): void {
  ctx.out.write(`Purged ${spec}; blobs deleted: ${data.blobs_deleted}`);
  for (const blob of data.blobs_shared ?? [])
    ctx.out.write(`Shared blob ${blob.sha256}: ${blob.versions.join(", ")}`);
  for (const backup of data.backups_predating ?? [])
    ctx.out.write(`Backup predating purge may contain data: ${backup}`);
  for (const backup of data.backups_deleted ?? []) ctx.out.write(`Backup deleted: ${backup}`);
  for (const blob of data.blobs_failed ?? []) ctx.out.write(`Blob deletion failed: ${blob}`);
}

export async function runMetadataSet(
  ctx: AppContext,
  spec: string,
  flags: MetadataFlags,
): Promise<void> {
  const { type, name } = ref(spec, false);
  const body = buildMetadataBody(flags);
  validateMetadataBody(body);
  const { client } = requireClient(ctx);
  const res = await client.request("PATCH", `/api/v1/artifacts/${type}/${name}/metadata`, { body });
  if (!res.ok) throw client.errorFromResult(res);
  if (ctx.out.json) ctx.out.printJson(res.data);
  else ctx.out.write(`Updated metadata for ${type}/${name}`);
  setExit(EXIT.OK);
}

export type PurgeFlags = { reason?: string; confirm?: string; deleteBackups?: boolean };

export async function runPurge(ctx: AppContext, spec: string, flags: PurgeFlags): Promise<void> {
  const { type, name, version } = ref(spec, true);
  if (!flags.reason || flags.reason.length < 10 || flags.reason.length > 500)
    invalid("--reason must be 10 to 500 characters");
  if (!flags.confirm || flags.confirm !== spec) invalid(`--confirm must exactly equal ${spec}`);
  const { client } = requireClient(ctx);
  const path = `/api/v1/artifacts/${type}/${name}${version ? `/versions/${encodeURIComponent(version)}` : ""}/purge`;
  const res = await client.request("POST", path, {
    body: {
      reason: flags.reason,
      confirm: flags.confirm,
      delete_backups: Boolean(flags.deleteBackups),
    },
  });
  if (!res.ok) throw client.errorFromResult(res);
  const data = res.data as {
    purged: string;
    blobs_deleted: number;
    blobs_failed: string[];
    blobs_shared: Array<{ sha256: string; versions: string[] }>;
    backups_predating: string[];
    backups_deleted: string[];
  };
  if (ctx.out.json) ctx.out.printJson(data);
  else printPurgeResult(ctx, spec, data);
  setExit(EXIT.OK);
}
