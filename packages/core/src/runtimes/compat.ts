import type { ArtifactType } from "../artifact/types.ts";
import { RUNTIMES, runtimeSupport, type RuntimeId } from "./table.ts";

/**
 * Which agents an artifact is for (artifact-agent-compat): `supported` is computed from the runtime table by type;
 * `declared` is the author's optional list of agents with a minimum version. One parser for the server and the CLI.
 */
export type AgentDeclaration = { runtime: RuntimeId; min_version: string | null };

export type AgentCompat = {
  supported: RuntimeId[];
  /** Agents that do not take the type, with the runtime table's reason. */
  unsupported: Array<{ runtime: RuntimeId; reason: string }>;
  declared: AgentDeclaration[];
};

export class AgentDeclarationError extends Error {}

const VERSION = /^\d{1,6}(\.\d{1,6}){0,2}$/;
const ITEM = /^\s*([a-z][a-z0-9-]*)\s*(?:>=\s*([^\s,]+))?\s*$/;

/** Agents of the runtime table that install `type` (project scope: every runtime has a project directory). */
export function supportedAgents(type: ArtifactType): RuntimeId[] {
  return RUNTIMES.filter((rt) => runtimeSupport(rt, type, "project").supported).map((rt) => rt.id);
}

/** Agents that do not install `type`, with the reason from the runtime table. */
export function unsupportedAgents(
  type: ArtifactType,
): Array<{ runtime: RuntimeId; reason: string }> {
  return RUNTIMES.flatMap((rt) => {
    const s = runtimeSupport(rt, type, "project");
    return s.supported ? [] : [{ runtime: rt.id, reason: s.reason }];
  });
}

function isRuntimeId(value: string): value is RuntimeId {
  return RUNTIMES.some((rt) => rt.id === value);
}

function fromString(item: string): { runtime: string; min_version: string | null } {
  const m = ITEM.exec(item);
  if (!m) throw new AgentDeclarationError(`"${item.trim()}" is not "agent" or "agent>=version"`);
  return { runtime: m[1]!, min_version: m[2] ?? null };
}

function fromObject(item: unknown): { runtime: string; min_version: string | null } {
  if (typeof item === "string") return fromString(item);
  const o = (item ?? {}) as { runtime?: unknown; min_version?: unknown };
  if (typeof o.runtime !== "string") throw new AgentDeclarationError("each entry needs a runtime");
  if (o.min_version !== undefined && o.min_version !== null && typeof o.min_version !== "string") {
    throw new AgentDeclarationError(`min_version of ${o.runtime} must be a string`);
  }
  return { runtime: o.runtime, min_version: (o.min_version as string | null | undefined) ?? null };
}

function checkEntry(
  raw: { runtime: string; min_version: string | null },
  type: ArtifactType,
): AgentDeclaration {
  if (!isRuntimeId(raw.runtime)) {
    throw new AgentDeclarationError(
      `unknown agent "${raw.runtime}"; known: ${RUNTIMES.map((r) => r.id).join(", ")}`,
    );
  }
  const rt = RUNTIMES.find((r) => r.id === raw.runtime)!;
  const support = runtimeSupport(rt, type, "project");
  if (!support.supported) throw new AgentDeclarationError(support.reason);
  if (raw.min_version !== null && !VERSION.test(raw.min_version)) {
    throw new AgentDeclarationError(
      `version "${raw.min_version}" of ${raw.runtime} must look like 2, 2.1 or 2.1.3`,
    );
  }
  return { runtime: raw.runtime, min_version: raw.min_version };
}

/**
 * Untrusted declaration (`[{runtime, min_version?}]`, `["codex>=0.150"]` or `"claude-code>=2.1,codex"`) → typed list,
 * in the given order. Throws AgentDeclarationError with a reader-facing reason.
 */
export function parseAgentDeclarations(input: unknown, type: ArtifactType): AgentDeclaration[] {
  if (input === undefined || input === null) return [];
  const items =
    typeof input === "string"
      ? input.split(",").filter((s) => s.trim() !== "")
      : Array.isArray(input)
        ? input
        : null;
  if (!items) throw new AgentDeclarationError("agents must be a list or a comma-separated string");
  if (items.length > RUNTIMES.length)
    throw new AgentDeclarationError(`at most ${RUNTIMES.length} agents`);
  const out: AgentDeclaration[] = [];
  for (const item of items) {
    const entry = checkEntry(fromObject(item), type);
    if (out.some((d) => d.runtime === entry.runtime)) {
      throw new AgentDeclarationError(`agent "${entry.runtime}" is listed twice`);
    }
    out.push(entry);
  }
  return out;
}

/** `claude-code>=2.1, codex` — the editable text form of a declaration. */
export function formatAgentDeclarations(list: readonly AgentDeclaration[]): string {
  return list.map((d) => (d.min_version ? `${d.runtime}>=${d.min_version}` : d.runtime)).join(", ");
}
