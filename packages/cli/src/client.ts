import { EXIT, exitFromHttpStatus, type ExitCode } from "./exit.ts";

export class ApiError extends Error {
  readonly exitCode: ExitCode;
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, exitCode: ExitCode, status?: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.exitCode = exitCode;
    this.status = status;
    this.body = body;
  }
}

export type ClientOptions = {
  url: string;
  token?: string;
  cookie?: string;
};

export type RequestResult = {
  status: number;
  headers: Headers;
  data: unknown;
  text: string;
  ok: boolean;
};

function extractSetCookie(headers: Headers): string | undefined {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    const list = anyHeaders.getSetCookie();
    if (list && list.length > 0) {
      return list.map((c) => c.split(";")[0]!.trim()).join("; ");
    }
  }
  const single = headers.get("set-cookie");
  if (single) {
    return single
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0]!.trim())
      .join("; ");
  }
  return undefined;
}

type RequestOptions = {
  body?: unknown;
  token?: string | null;
  cookie?: string;
  accept?: string;
  raw?: boolean;
};

function buildRequestHeaders(
  options: RequestOptions,
  defaults: { token?: string; cookie?: string },
): { headers: Record<string, string>; body: string | undefined } {
  const headers: Record<string, string> = {};
  if (options.accept) headers.Accept = options.accept;
  else if (!options.raw) headers.Accept = "application/json";

  const token = options.token === null ? undefined : (options.token ?? defaults.token);
  if (token) headers.Authorization = `Bearer ${token}`;

  const cookie = options.cookie ?? defaults.cookie;
  if (cookie) headers.Cookie = cookie;

  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return { headers, body };
}

function parseResponseData(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromResultData(result: RequestResult): string {
  let message = `HTTP ${result.status}`;
  if (result.data && typeof result.data === "object" && result.data !== null) {
    const err = (result.data as { error?: unknown }).error;
    if (typeof err === "string") message = err;
    else if (typeof (result.data as { message?: unknown }).message === "string") {
      message = (result.data as { message: string }).message;
    }
  } else if (typeof result.data === "string" && result.data.length > 0) {
    message = result.data;
  }
  return message;
}

/** English not_owner message shared by early and late 403 handlers. */
function notOwnerMessage(owner: unknown): string {
  const name = typeof owner === "string" ? owner : "another user";
  return `not_owner: the artifact is owned by ${name}; ask the owner to add you as a maintainer`;
}

function early403OwnerError(result: RequestResult): ApiError | null {
  if (
    result.status !== 403 ||
    !result.data ||
    typeof result.data !== "object" ||
    result.data === null
  ) {
    return null;
  }
  const body = result.data as { error?: unknown; owner?: unknown };
  if (body.error !== "not_owner") return null;
  return new ApiError(notOwnerMessage(body.owner), EXIT.VALIDATION, result.status, result.data);
}

function late403Special(
  result: RequestResult,
  body: { error?: unknown; owner?: unknown } | undefined,
): ApiError | null {
  if (result.status !== 403 || !body) return null;
  if (body.error === "not_team_member") {
    return new ApiError(
      "not_team_member: you are not a member of the target team",
      EXIT.VALIDATION,
      result.status,
      result.data,
    );
  }
  if (body.error === "not_owner") {
    return new ApiError(notOwnerMessage(body.owner), EXIT.NOT_OWNER, result.status, result.data);
  }
  return null;
}

function decorateAuthMessage(message: string, code: ExitCode): string {
  if (code === EXIT.UNAUTHORIZED) return `${message}; run skillforge login`;
  if (code === EXIT.NOT_FOUND && !/not found/i.test(message)) return `not found: ${message}`;
  return message;
}

export class SkillforgeClient {
  readonly url: string;
  token: string | undefined;
  cookie: string | undefined;

  constructor(opts: ClientOptions) {
    this.url = opts.url.replace(/\/$/, "");
    this.token = opts.token;
    this.cookie = opts.cookie;
  }

  async request(
    method: string,
    apiPath: string,
    options: RequestOptions = {},
  ): Promise<RequestResult> {
    const { headers, body } = buildRequestHeaders(options, {
      token: this.token,
      cookie: this.cookie,
    });

    const endpoint = `${this.url}${apiPath.startsWith("/") ? apiPath : `/${apiPath}`}`;
    let res: Response;
    try {
      res = await fetch(endpoint, { method, headers, body });
    } catch {
      throw new ApiError(`cannot reach ${this.url}`, EXIT.UNREACHABLE);
    }

    const setCookie = extractSetCookie(res.headers);
    if (setCookie) {
      this.cookie = setCookie;
    }

    if (options.raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        status: res.status,
        headers: res.headers,
        data: buf,
        text: "",
        ok: res.ok,
      };
    }

    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      data: parseResponseData(text),
      text,
      ok: res.ok,
    };
  }

  async requestOk(
    method: string,
    apiPath: string,
    options: RequestOptions = {},
  ): Promise<RequestResult> {
    const result = await this.request(method, apiPath, options);
    if (result.ok) return result;
    throw this.errorFromResult(result);
  }

  errorFromResult(result: RequestResult): ApiError {
    const early = early403OwnerError(result);
    if (early) return early;
    const damaged = blobCorruptError(result);
    if (damaged) return damaged;

    const code = exitFromHttpStatus(result.status);
    let message = messageFromResultData(result);

    const body = result.data as { error?: unknown; owner?: unknown } | undefined;
    const special = late403Special(result, body);
    if (special) return special;

    message = decorateAuthMessage(message, code);
    return new ApiError(message, code, result.status, result.data);
  }
}

/**
 * blob-integrity: the registry refuses a file whose stored copy does not match its hash. Raw downloads come back as a
 * Buffer, so the JSON body is read from it too.
 */
function blobCorruptError(result: RequestResult): ApiError | null {
  let body: unknown = result.data;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString("utf8"));
    } catch {
      return null;
    }
  }
  if ((body as { error?: unknown } | undefined)?.error !== "blob_corrupt") return null;
  return new ApiError(
    "the registry copy of this file is damaged (blob_corrupt), nothing was installed; ask an admin to publish the file again",
    EXIT.VALIDATION,
    result.status,
    result.data,
  );
}

export function noRegistryError(): ApiError {
  return new ApiError(
    "No registry configured. Set SKILLFORGE_URL or run skillforge login --url <base>",
    EXIT.UNREACHABLE,
  );
}
