import os from "node:os";
import path from "node:path";
import {
  RUNTIME_IDS,
  isRuntimeId,
  runtimeDef,
  runtimeDir,
  type RuntimeDef,
  type RuntimeScope,
} from "@skillforge/core";
import { ApiError } from "./client.ts";
import { EXIT } from "./exit.ts";

export const RUNTIME_OPTION = `Target agent runtime: ${RUNTIME_IDS.join(", ")} (default: claude-code)`;
export const SCOPE_OPTION = "Runtime scope: project (default) or user";

export type TargetFlags = {
  into?: string;
  runtime?: string;
  scope?: string;
};

/**
 * Where an install/sync/uninstall operates. `runtime` is null for the legacy `--into` root
 * (Claude Code layout, no `runtime` field in the lock).
 */
export type InstallTarget = {
  base: string;
  runtime: RuntimeDef | null;
  scope: RuntimeScope;
};

function parseScope(raw: string | undefined): RuntimeScope {
  if (raw === undefined || raw === "project") return "project";
  if (raw === "user") return "user";
  throw new ApiError(`unknown scope "${raw}"; expected project or user`, EXIT.VALIDATION);
}

export function resolveTarget(flags: TargetFlags): InstallTarget {
  if (flags.into !== undefined) {
    if (flags.runtime !== undefined || flags.scope !== undefined) {
      throw new ApiError("--into cannot be combined with --runtime or --scope", EXIT.VALIDATION);
    }
    return { base: path.resolve(flags.into), runtime: null, scope: "project" };
  }
  const id = flags.runtime ?? "claude-code";
  if (!isRuntimeId(id)) {
    throw new ApiError(
      `unknown runtime "${id}"; known runtimes: ${RUNTIME_IDS.join(", ")}`,
      EXIT.VALIDATION,
    );
  }
  const runtime = runtimeDef(id);
  const scope = parseScope(flags.scope);
  const dir = runtimeDir(runtime, scope);
  if (dir === null) {
    throw new ApiError(
      `the ${scope} scope is not supported by ${runtime.id} (no ${scope}-level directory); use --scope project`,
      EXIT.VALIDATION,
    );
  }
  const root = scope === "user" ? os.homedir() : process.cwd();
  return { base: path.resolve(root, ...dir.split("/")), runtime, scope };
}
