import path from "node:path";
import { z } from "zod";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const propSchema = z.object({
  type: z.enum(["string", "number", "boolean", "array"]),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

export const configSchemaZod = z
  .object({
    type: z.literal("object").optional(),
    properties: z.record(z.string(), propSchema).optional(),
    required: z.array(z.string()).optional(),
  })
  .optional();

export const pluginManifestSchema = z.object({
  name: z.string().min(1).max(64).regex(NAME_RE, "name must be kebab-case"),
  version: z.string().min(1),
  api: z.literal(1),
  description: z.string().max(200).optional().default(""),
  main: z.string().optional().default("index.js"),
  capabilities: z.array(z.string()).optional().default([]),
  config_schema: configSchemaZod,
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type ConfigSchema = NonNullable<PluginManifest["config_schema"]>;

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/** Resolve and validate main stays inside pluginDir. */
export function resolveMainPath(pluginDir: string, main: string): string {
  if (path.isAbsolute(main)) {
    throw new ManifestError("main must be a relative path inside the plugin directory");
  }
  const normalized = path.normalize(main);
  if (normalized.split(path.sep).includes("..") || main.includes("..")) {
    throw new ManifestError("main must not contain '..'");
  }
  const resolved = path.resolve(pluginDir, normalized);
  const root = path.resolve(pluginDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ManifestError("main must stay inside the plugin directory");
  }
  return resolved;
}

export function parseManifest(raw: unknown, dirName: string): PluginManifest {
  if (raw && typeof raw === "object" && "api" in raw && (raw as { api: unknown }).api !== 1) {
    throw new ManifestError(
      `unsupported api version: ${String((raw as { api: unknown }).api)} (expected 1)`,
    );
  }
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ManifestError(`invalid manifest: ${msg}`);
  }
  if (parsed.data.name !== dirName) {
    throw new ManifestError(
      `manifest name "${parsed.data.name}" does not match directory name "${dirName}"`,
    );
  }
  return parsed.data;
}
