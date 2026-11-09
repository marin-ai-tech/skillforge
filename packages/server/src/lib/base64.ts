/**
 * Strict base64 decoder for untrusted `content_base64` inputs.
 *
 * Accepts: standard alphabet (A–Z a–z 0–9 + /), whitespace anywhere (MIME line
 * wrapping), optional `=` padding (at most two, only at the end), unpadded input
 * whose length % 4 is 0, 2 or 3, and the empty string (empty file).
 *
 * Rejects everything that cannot be decoded losslessly: characters outside the
 * alphabet, padding in the middle, length % 4 == 1 (a dangling symbol that
 * `Buffer.from` silently drops), and non-zero trailing bits in the last symbol
 * (`QR==`), i.e. the decoded bytes must re-encode to the (padded) input.
 */
export function decodeBase64Strict(raw: string): Uint8Array | null {
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.length === 0) return new Uint8Array(0);
  const m = /^([A-Za-z0-9+/]*)(={0,2})$/.exec(cleaned);
  if (m === null) return null;
  const body = m[1]!;
  const padding = m[2]!;
  const rem = body.length % 4;
  if (rem === 1) return null;
  const expectedPadding = rem === 0 ? 0 : 4 - rem;
  if (padding.length !== 0 && padding.length !== expectedPadding) return null;
  const padded = body + "=".repeat(expectedPadding);
  const buf = Buffer.from(padded, "base64");
  if (buf.toString("base64") !== padded) return null;
  return new Uint8Array(buf);
}
