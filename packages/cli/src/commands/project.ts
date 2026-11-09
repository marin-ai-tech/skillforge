import fs from "node:fs";
import { semverGreater } from "@skillforge/core";
import { ApiError, SkillforgeClient } from "../client.ts";
import type { AppContext } from "../context.ts";
import { setExit } from "../context.ts";
import { resolveRegistry } from "../config.ts";
import { EXIT, type ExitCode } from "../exit.ts";
import { invalidPinWarning, lockPathFor, readLock, type LockArtifact } from "../lock.ts";
import { resolveTarget, type TargetFlags } from "../runtime.ts";
import { resolveSpecVersion, isSpecInvalidError } from "./install.ts";

export type ProjectStatusOpts = TargetFlags;

export type ProjectCheck = {
  id: string;
  ok: boolean;
  message: string;
  severity?: "error" | "warn" | "info";
};

export type ProjectStatusValue =
  "ok" | "missing_config" | "missing_lock" | "no_local_install" | "out_of_sync" | "unreachable";

type ProjectPayload = {
  ok: boolean;
  checks: ProjectCheck[];
  status: ProjectStatusValue;
  summary: string;
  into?: string;
  lockPath?: string;
  registry_url?: string;
  outdated?: string[];
  artifacts?: string[];
};

function emitProjectStatus(ctx: AppContext, payload: ProjectPayload): void {
  if (ctx.out.json) {
    ctx.out.printJson(payload);
    return;
  }
  ctx.out.write(ctx.out.bold("skillforge project status"));
  for (const c of payload.checks) {
    const mark = c.ok ? "ok" : (c.severity ?? "error") === "warn" ? "warn" : "FAIL";
    ctx.out.write(`  [${mark}] ${c.id}: ${c.message}`);
  }
  ctx.out.write(`status: ${payload.status}`);
  ctx.out.write(`summary: ${payload.summary}`);
  if (payload.into) ctx.out.write(`into: ${payload.into}`);
  if (payload.lockPath) ctx.out.write(`lock: ${payload.lockPath}`);
  if (payload.registry_url) ctx.out.write(`registry: ${payload.registry_url}`);
}

function finish(ctx: AppContext, payload: ProjectPayload, code: ExitCode): void {
  emitProjectStatus(ctx, payload);
  setExit(code);
}

async function compareArtifact(
  client: SkillforgeClient,
  key: string,
  entry: LockArtifact,
): Promise<{ update_available: boolean; error?: string }> {
  const parts = key.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { update_available: false, error: "invalid lock key" };
  }
  const type = encodeURIComponent(parts[0]);
  const name = encodeURIComponent(parts[1]);
  try {
    const latest = await resolveSpecVersion(client, type, name, "latest");
    let wanted = latest;
    if (entry.pin) {
      try {
        wanted = await resolveSpecVersion(client, type, name, entry.pin);
      } catch (err) {
        if (!isSpecInvalidError(err)) throw err;
      }
    }
    return { update_available: semverGreater(wanted.version, entry.version) };
  } catch (err) {
    return {
      update_available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isNetworkError(msg: string): boolean {
  return /cannot reach|ECONNREFUSED|fetch failed|aborted|ENOTFOUND/i.test(msg);
}

async function registryReachable(client: SkillforgeClient): Promise<boolean> {
  try {
    const health = await client.request("GET", "/api/v1/health");
    return health.ok;
  } catch {
    return false;
  }
}

async function collectSyncState(
  client: SkillforgeClient,
  artifactKeys: string[],
  artifacts: Record<string, LockArtifact>,
): Promise<{ outdated: string[]; errors: string[]; unreachable: boolean }> {
  const outdated: string[] = [];
  const errors: string[] = [];
  for (const key of artifactKeys.sort()) {
    const entry = artifacts[key]!;
    const cmp = await compareArtifact(client, key, entry);
    if (cmp.error) {
      if (isNetworkError(cmp.error)) {
        return { outdated, errors: [...errors, `${key}: ${cmp.error}`], unreachable: true };
      }
      errors.push(`${key}: ${cmp.error}`);
      continue;
    }
    if (cmp.update_available) outdated.push(key);
  }
  return { outdated, errors, unreachable: false };
}

function missingConfigPayload(message: string): ProjectPayload {
  return {
    ok: false,
    checks: [
      { id: "cli_config", ok: false, message, severity: "error" },
      {
        id: "local_install",
        ok: false,
        message: "skipped: no registry configured",
        severity: "error",
      },
    ],
    status: "missing_config",
    summary: message,
  };
}

/**
 * skillforge project status — compare local install lock to the registry.
 * Missing config / unreachable MUST setExit and MUST NOT throw unhandled.
 */
export async function runProjectStatus(
  ctx: AppContext,
  opts: ProjectStatusOpts = {},
): Promise<void> {
  try {
    await runProjectStatusInner(ctx, opts);
  } catch (e) {
    if (e instanceof ApiError) {
      finish(ctx, missingConfigPayload(e.message), e.exitCode);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    finish(
      ctx,
      {
        ok: false,
        checks: [{ id: "project_status", ok: false, message: msg, severity: "error" }],
        status: "unreachable",
        summary: msg,
      },
      EXIT.VALIDATION,
    );
  }
}

async function runProjectStatusInner(ctx: AppContext, opts: ProjectStatusOpts): Promise<void> {
  const resolved = resolveRegistry({
    url: ctx.globals.url,
    token: ctx.globals.token,
  });

  if (!resolved?.url) {
    finish(
      ctx,
      missingConfigPayload(
        "missing_config: no registry URL (set --url, SKILLFORGE_URL, or run skillforge login)",
      ),
      EXIT.INVALID_INPUT,
    );
    return;
  }

  const registryUrl = resolved.url;
  const baseChecks: ProjectCheck[] = [
    {
      id: "cli_config",
      ok: true,
      message: `registry URL resolved: ${resolved.url}`,
      severity: "info",
    },
  ];

  let into: string;
  try {
    into = resolveTarget(opts).base;
  } catch (e) {
    if (e instanceof ApiError) {
      finish(
        ctx,
        {
          ok: false,
          checks: [
            ...baseChecks,
            { id: "local_install", ok: false, message: e.message, severity: "error" },
          ],
          status: "missing_config",
          summary: e.message,
          registry_url: registryUrl,
        },
        e.exitCode,
      );
      return;
    }
    throw e;
  }

  const lockPath = lockPathFor(into);
  const lockExists = fs.existsSync(lockPath);
  const lock = readLock(into, (k) => ctx.out.error(invalidPinWarning(k)));
  const artifactKeys = Object.keys(lock.artifacts);

  if (!lockExists) {
    finish(
      ctx,
      {
        ok: false,
        checks: [
          ...baseChecks,
          {
            id: "local_install",
            ok: false,
            message: `missing lock file at ${lockPath}`,
            severity: "error",
          },
        ],
        status: "missing_lock",
        summary: `missing_lock: no .skillforge-lock.json under ${into}`,
        into,
        lockPath,
        registry_url: registryUrl,
      },
      EXIT.NOT_FOUND,
    );
    return;
  }

  if (artifactKeys.length === 0) {
    finish(
      ctx,
      {
        ok: false,
        checks: [
          ...baseChecks,
          {
            id: "local_install",
            ok: false,
            message: `lock exists at ${lockPath} but no installed artifacts`,
            severity: "warn",
          },
        ],
        status: "no_local_install",
        summary: "no_local_install: lock is empty",
        into,
        lockPath,
        registry_url: registryUrl,
        artifacts: [],
      },
      EXIT.VALIDATION,
    );
    return;
  }

  const installOk: ProjectCheck = {
    id: "local_install",
    ok: true,
    message: `${artifactKeys.length} artifact(s) in ${lockPath}`,
    severity: "info",
  };

  const client = new SkillforgeClient({ url: resolved.url, token: resolved.token });
  if (!(await registryReachable(client))) {
    finish(
      ctx,
      {
        ok: false,
        checks: [
          ...baseChecks,
          installOk,
          {
            id: "registry_sync",
            ok: false,
            message: `registry unreachable at ${resolved.url}`,
            severity: "error",
          },
        ],
        status: "unreachable",
        summary: `unreachable: cannot reach ${resolved.url}`,
        into,
        lockPath,
        registry_url: registryUrl,
      },
      EXIT.UNREACHABLE,
    );
    return;
  }

  const sync = await collectSyncState(client, artifactKeys, lock.artifacts);
  if (sync.unreachable) {
    finish(
      ctx,
      {
        ok: false,
        checks: [
          ...baseChecks,
          installOk,
          {
            id: "registry_sync",
            ok: false,
            message: `registry unreachable while comparing: ${sync.errors.join("; ")}`,
            severity: "error",
          },
        ],
        status: "unreachable",
        summary: `unreachable: cannot reach ${resolved.url}`,
        into,
        lockPath,
        registry_url: registryUrl,
      },
      EXIT.UNREACHABLE,
    );
    return;
  }

  if (sync.outdated.length > 0) {
    finish(
      ctx,
      {
        ok: false,
        checks: [
          ...baseChecks,
          installOk,
          {
            id: "registry_sync",
            ok: false,
            message: `out of sync: ${sync.outdated.join(", ")}`,
            severity: "error",
          },
        ],
        status: "out_of_sync",
        summary: `out_of_sync: ${sync.outdated.length} artifact(s) behind registry`,
        into,
        lockPath,
        registry_url: registryUrl,
        outdated: sync.outdated,
        artifacts: artifactKeys,
      },
      EXIT.VALIDATION,
    );
    return;
  }

  if (sync.errors.length > 0) {
    finish(
      ctx,
      {
        ok: false,
        checks: [
          ...baseChecks,
          installOk,
          {
            id: "registry_sync",
            ok: false,
            message: `compare errors: ${sync.errors.join("; ")}`,
            severity: "error",
          },
        ],
        status: "out_of_sync",
        summary: `out_of_sync: compare errors for ${sync.errors.length} artifact(s)`,
        into,
        lockPath,
        registry_url: registryUrl,
        artifacts: artifactKeys,
      },
      EXIT.VALIDATION,
    );
    return;
  }

  finish(
    ctx,
    {
      ok: true,
      checks: [
        ...baseChecks,
        installOk,
        {
          id: "registry_sync",
          ok: true,
          message: "local install matches registry wanted versions",
          severity: "info",
        },
      ],
      status: "ok",
      summary: `ok: ${artifactKeys.length} artifact(s) in sync`,
      into,
      lockPath,
      registry_url: registryUrl,
      artifacts: artifactKeys,
    },
    EXIT.OK,
  );
}
