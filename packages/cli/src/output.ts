export type OutputOptions = {
  json?: boolean;
  noColor?: boolean;
};

function envNoColor(): boolean {
  return process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
}

export class Output {
  readonly json: boolean;
  readonly color: boolean;

  constructor(opts: OutputOptions = {}) {
    this.json = Boolean(opts.json);
    const noColor = Boolean(opts.noColor) || envNoColor() || !process.stdout.isTTY;
    this.color = !noColor && !this.json;
  }

  write(text: string): void {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  writeRaw(text: string): void {
    process.stdout.write(text);
  }

  error(text: string): void {
    process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  printJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  dim(text: string): string {
    if (!this.color) return text;
    return `\u001b[2m${text}\u001b[0m`;
  }

  bold(text: string): string {
    if (!this.color) return text;
    return `\u001b[1m${text}\u001b[0m`;
  }

  red(text: string): string {
    if (!this.color) return text;
    return `\u001b[31m${text}\u001b[0m`;
  }

  green(text: string): string {
    if (!this.color) return text;
    return `\u001b[32m${text}\u001b[0m`;
  }

  printTable(headers: string[], rows: string[][]): void {
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
    );
    const line = (cols: string[]) =>
      cols.map((c, i) => (c ?? "").padEnd(widths[i] ?? 0)).join("  ");
    this.write(this.bold(line(headers)));
    for (const row of rows) this.write(line(row));
  }
}
