export class ConfigError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: { names?: string[] };

  constructor(code: string, text: string, exitCode: number, details?: { names?: string[] }) {
    super(`${code}: ${text}`);
    this.name = "ConfigError";
    this.code = code;
    this.exitCode = exitCode;
    if (details) this.details = details;
  }
}
