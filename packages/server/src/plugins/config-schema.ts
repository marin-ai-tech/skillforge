import type { ConfigSchema } from "./manifest.ts";

export type ConfigIssue = { path: string; message: string };

export type ValidateConfigResult =
  { ok: true; value: Record<string, unknown> } | { ok: false; issues: ConfigIssue[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeOk(expected: string, value: unknown): boolean {
  if (expected === "string") return typeof value === "string";
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "boolean") return typeof value === "boolean";
  if (expected === "array") {
    return Array.isArray(value) && value.every((x) => typeof x === "string");
  }
  return false;
}

type SchemaProperties = NonNullable<ConfigSchema["properties"]>;

/** Unknown keys and type mismatches, in key order. */
function propertyIssues(
  properties: SchemaProperties,
  value: Record<string, unknown>,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const key of Object.keys(value)) {
    const prop = properties[key];
    if (!prop) {
      issues.push({ path: key, message: `unknown property "${key}"` });
      continue;
    }
    if (!typeOk(prop.type, value[key])) {
      issues.push({
        path: key,
        message:
          prop.type === "array"
            ? `"${key}" must be an array of strings`
            : `"${key}" must be a ${prop.type}`,
      });
    }
  }
  return issues;
}

/** Required keys that are absent and have no schema default. */
function missingRequiredIssues(
  properties: SchemaProperties,
  required: string[],
  value: Record<string, unknown>,
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const key of required) {
    if (!(key in value)) {
      const prop = properties[key];
      if (prop && "default" in prop && prop.default !== undefined) continue;
      issues.push({ path: key, message: `"${key}" is required` });
    }
  }
  return issues;
}

/** Validate config against schema without ajv. Does not apply defaults. */
export function validateConfig(
  schema: ConfigSchema | undefined | null,
  value: unknown,
): ValidateConfigResult {
  if (!isPlainObject(value)) {
    return { ok: false, issues: [{ path: "", message: "config must be an object" }] };
  }
  const properties = schema?.properties ?? {};
  const required = schema?.required ?? [];
  const issues: ConfigIssue[] = [
    ...propertyIssues(properties, value),
    ...missingRequiredIssues(properties, required, value),
  ];

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { ...value } };
}

/** Merge defaults from schema over a validated (or empty) object. */
export function applyDefaults(
  schema: ConfigSchema | undefined | null,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  const out: Record<string, unknown> = { ...value };
  for (const [key, prop] of Object.entries(properties)) {
    if (!(key in out) && prop && "default" in prop && prop.default !== undefined) {
      out[key] = prop.default;
    }
  }
  return out;
}
