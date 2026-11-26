const BOM = String.fromCharCode(0xfeff);

/**
 * fix-stdin-bom: removes every BOM (U+FEFF) at the start of text a person pipes in, and nothing else. Windows PowerShell
 * 5.1 puts one, or two with `$OutputEncoding = UTF8`, before the text. Every stdin reader of the CLI goes through this,
 * so a password or a token never carries it.
 */
export function stripBom(text: string): string {
  let start = 0;
  while (text.startsWith(BOM, start)) start += BOM.length;
  return start === 0 ? text : text.slice(start);
}
