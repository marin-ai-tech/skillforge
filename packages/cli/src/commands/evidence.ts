import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { isArtifactType } from "@skillforge/core";
import { ApiError, type RequestResult } from "../client.ts";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { EXIT } from "../exit.ts";
import { parseTypeName } from "./info.ts";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const KINDS = ["gate", "run", "diff", "review", "eval", "ablation"] as const;
const MAX_USES = 100000;

function invalid(message: string): ApiError {
  return new ApiError(message, EXIT.INVALID_INPUT);
}

function artifactRef(
  spec: string,
  needVersion: boolean,
): {
  type: string;
  name: string;
  version?: string;
} {
  let ref: { type: string; name: string; version?: string };
  try {
    ref = parseTypeName(spec);
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : String(e));
  }
  if (!isArtifactType(ref.type)) throw invalid(`unknown artifact type: ${ref.type}`);
  if (!NAME_RE.test(ref.name) || ref.name.length > 64) {
    throw invalid(`artifact name must be kebab-case: ${ref.name}`);
  }
  if (needVersion && !ref.version) throw invalid(`expected <type>/<name>@<version>, got: ${spec}`);
  if (ref.version !== undefined) checkVersion(ref.version);
  return ref;
}

function checkVersion(v: string): void {
  if (v !== "latest" && !SEMVER_RE.test(v)) throw invalid(`version must be semver or latest: ${v}`);
}

function count(flag: string, raw: string | undefined): number {
  if (raw === undefined) throw invalid(`${flag} is required`);
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_USES) {
    throw invalid(`${flag} must be an integer from 0 to ${MAX_USES}`);
  }
  return Number(raw);
}

function optionalText(flag: string, raw: string | undefined, max: number): string | undefined {
  if (raw === undefined) return undefined;
  if (raw.length === 0 || raw.length > max) {
    throw invalid(`${flag} must be 1 to ${max} characters`);
  }
  return raw;
}

function isSafeUrl(v: string): boolean {
  if (v.length > 2048 || /[\s\\]/.test(v)) return false;
  if (v.startsWith("/")) return !v.startsWith("//");
  if (!/^https?:\/\/[^/]/i.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

function fail(res: RequestResult, errorFromResult: (r: RequestResult) => ApiError): ApiError {
  if (res.status === 400 || res.status === 422) {
    const err = (res.data as { error?: unknown } | undefined)?.error;
    return new ApiError(
      typeof err === "string" ? err : `HTTP ${res.status}`,
      EXIT.INVALID_INPUT,
      res.status,
      res.data,
    );
  }
  return errorFromResult(res);
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`;
}

export type ReportUsageFlags = {
  uses?: string;
  helped?: string;
  version?: string;
  source?: string;
  reportId?: string;
  basis?: string;
};

function checkBasis(basis: string | undefined): void {
  if (basis !== undefined && basis !== "loaded" && basis !== "assigned") {
    throw invalid("--basis must be loaded or assigned");
  }
}

function definedOnly(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

export async function runReportUsage(
  ctx: AppContext,
  spec: string,
  flags: ReportUsageFlags,
): Promise<void> {
  const ref = artifactRef(spec, false);
  if (ref.version !== undefined && flags.version !== undefined) {
    throw invalid("give the version either as @version or --version, not both");
  }
  const version = flags.version ?? ref.version;
  if (version !== undefined) checkVersion(version);
  const uses = count("--uses", flags.uses);
  const helped = count("--helped", flags.helped);
  if (helped > uses) throw invalid("--helped must not exceed --uses");
  const source = optionalText("--source", flags.source, 64);
  const reportId = optionalText("--report-id", flags.reportId, 128);
  checkBasis(flags.basis);

  const { client } = requireClient(ctx);
  const res = await client.request("POST", `/api/v1/artifacts/${ref.type}/${ref.name}/usage`, {
    body: definedOnly({
      uses,
      helped,
      version,
      source,
      report_id: reportId,
      basis: flags.basis,
    }),
  });
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  const data = res.data as {
    version: string;
    use_count: number;
    help_count: number;
    transfer_rate: number | null;
  };
  if (ctx.out.json) {
    ctx.out.printJson(data);
  } else {
    const note = res.status === 200 ? " (already recorded)" : "";
    ctx.out.write(
      `${ref.type}/${ref.name}@${data.version}: uses ${data.use_count}, helped ${data.help_count}, transfer rate ${formatRate(data.transfer_rate)}${note}`,
    );
  }
  setExit(EXIT.OK);
}

export type EvidenceAddFlags = {
  kind?: string;
  url?: string;
  file?: string;
  summary?: string;
  tasks?: string;
  passedWith?: string;
  passedWithout?: string;
  runner?: string;
};

function ablationInt(flag: string, raw: string | undefined): number {
  if (raw === undefined) throw invalid(`${flag} is required for --kind ablation`);
  if (!/^\d+$/.test(raw)) throw invalid(`${flag} must be an integer`);
  return Number(raw);
}

function buildAblationBody(flags: EvidenceAddFlags): {
  tasks: number;
  passed_with: number;
  passed_without: number;
  runner?: string;
} {
  const tasks = ablationInt("--tasks", flags.tasks);
  const passed_with = ablationInt("--passed-with", flags.passedWith);
  const passed_without = ablationInt("--passed-without", flags.passedWithout);
  if (tasks < 1 || tasks > 1000) throw invalid("--tasks must be from 1 to 1000");
  if (passed_with < 0 || passed_with > tasks) {
    throw invalid("--passed-with must be between 0 and --tasks");
  }
  if (passed_without < 0 || passed_without > tasks) {
    throw invalid("--passed-without must be between 0 and --tasks");
  }
  const runner = optionalText("--runner", flags.runner, 64);
  return {
    tasks,
    passed_with,
    passed_without,
    ...(runner !== undefined ? { runner } : {}),
  };
}

const MAX_DOCUMENT_BYTES = 65536;
const DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `--file`: a UTF-8 text file without NUL, up to 64 KiB, with a plain name (evidence-documents). */
function readDocument(file: string): { name: string; text: string } {
  const name = basename(file);
  if (!DOCUMENT_NAME.test(name)) throw invalid(`--file name must match ${DOCUMENT_NAME.source}`);
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    throw invalid(`--file cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw invalid("--file must be at most 65536 bytes");
  if (bytes.includes(0)) throw invalid("--file must be text without NUL bytes");
  try {
    return { name, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    throw invalid("--file must be UTF-8 text");
  }
}

/** Exactly one of --url and --file. */
function validateSource(flags: EvidenceAddFlags): void {
  if (flags.url !== undefined && flags.file !== undefined) {
    throw invalid("give either --url or --file, not both");
  }
  if (flags.file !== undefined) return;
  if (!flags.url || !isSafeUrl(flags.url)) {
    throw invalid("--url must be an http(s) URL or a registry path starting with / (max 2048)");
  }
}

function validateEvidenceAddFlags(flags: EvidenceAddFlags): void {
  if (!flags.kind || !(KINDS as readonly string[]).includes(flags.kind)) {
    throw invalid(`--kind must be one of ${KINDS.join(", ")}`);
  }
  validateSource(flags);
  const hasAblationFlags =
    flags.tasks !== undefined ||
    flags.passedWith !== undefined ||
    flags.passedWithout !== undefined ||
    flags.runner !== undefined;
  if (flags.kind !== "ablation" && hasAblationFlags) {
    throw invalid(
      "--tasks/--passed-with/--passed-without/--runner are only valid for --kind ablation",
    );
  }
}

function printEvidenceAddResult(
  ctx: AppContext,
  ref: { type: string; name: string; version?: string },
  flags: EvidenceAddFlags,
  res: { status: number; data: unknown },
): void {
  const data = res.data as {
    evidence: Array<{
      kind: string;
      url: string;
      at: string | null;
      by: string | null;
      uplift?: number;
      data?: { tasks: number; passed_with: number; passed_without: number; uplift: number };
    }>;
    validated_at: string | null;
  };
  if (ctx.out.json) {
    ctx.out.printJson({
      ...data,
      evidence: data.evidence.map((e) => {
        if (e.kind !== "ablation") return e;
        const uplift = e.uplift ?? e.data?.uplift;
        return uplift === undefined ? e : { ...e, uplift };
      }),
    });
    return;
  }
  const note = res.status === 200 ? "already recorded" : "added";
  ctx.out.write(
    `${ref.type}/${ref.name}@${ref.version}: ${flags.kind} ${flags.url ?? flags.file} ${note}`,
  );
  const last = [...data.evidence].reverse().find((e) => e.kind === flags.kind);
  if (flags.kind === "ablation" && last) {
    const uplift = last.uplift ?? last.data?.uplift;
    ctx.out.write(`ablation uplift=${uplift ?? "?"} tasks=${last.data?.tasks ?? "?"}`);
  }
  ctx.out.write(`evidence records: ${data.evidence.length}`);
  if (data.validated_at) ctx.out.write(`validated_at: ${data.validated_at}`);
}

export async function runEvidenceAdd(
  ctx: AppContext,
  spec: string,
  flags: EvidenceAddFlags,
): Promise<void> {
  const ref = artifactRef(spec, true);
  validateEvidenceAddFlags(flags);
  const summary = optionalText("--summary", flags.summary, 500);
  const document = flags.file !== undefined ? readDocument(flags.file) : undefined;

  let dataBody:
    { tasks: number; passed_with: number; passed_without: number; runner?: string } | undefined;
  if (flags.kind === "ablation") {
    dataBody = buildAblationBody(flags);
  }

  const { client } = requireClient(ctx);
  const res = await client.request(
    "POST",
    `/api/v1/artifacts/${ref.type}/${ref.name}/versions/${encodeURIComponent(ref.version!)}/evidence`,
    {
      body: {
        kind: flags.kind,
        ...(document ? { document } : { url: flags.url }),
        ...(summary !== undefined ? { summary } : {}),
        ...(dataBody !== undefined ? { data: dataBody } : {}),
      },
    },
  );
  if (!res.ok) throw fail(res, (r) => client.errorFromResult(r));
  printEvidenceAddResult(ctx, ref, flags, res);
  setExit(EXIT.OK);
}
