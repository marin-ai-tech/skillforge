/**
 * Files of an internal publication. The publish body that comes over HTTP is
 * `unknown` and parsed at the boundary, so the compiler cannot check what internal callers send; they build the files
 * here instead, and a wrong field name cannot reach the publish pipeline again.
 */
export type PublishFile = { path: string; content_base64: string };

export function toPublishFiles(
  files: ReadonlyArray<{ path: string; content: string | Uint8Array }>,
): PublishFile[] {
  return files.map((f) => ({
    path: f.path,
    content_base64: Buffer.from(
      typeof f.content === "string" ? Buffer.from(f.content) : f.content,
    ).toString("base64"),
  }));
}
