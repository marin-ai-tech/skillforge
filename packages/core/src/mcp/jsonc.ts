/**
 * JSON with comments (`//`, `/* *\/`) and trailing commas, as OpenCode allows. Comments and trailing commas outside
 * strings are removed, then the text goes to JSON.parse. Throws like JSON.parse on anything else.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(dropTrailingCommas(dropComments(text)));
}

/** Index just past the string literal that starts at `start` (a `"`), or text.length if it never closes. */
function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === '"') return i + 1;
    else i++;
  }
  return text.length;
}

function dropComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl;
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function dropTrailingCommas(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (c === "," && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) {
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
