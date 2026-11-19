// fix-tracked-source-archive: the GitHub archive transport names every failure it can foresee — an archive over the
// in-memory limit, a broken archive, a download that stalls — instead of leaving it to an unnamed `check_failed`; an
// unsafe path is refused in any entry, inside the folder or not.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { githubFolder, untarFiles, SourceFetchError } from "../src/tracked/github.ts";

function entry(name: string, body: string): Buffer[] {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, "utf8");
  h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  h.write("0", 156);
  h.write("ustar\0", 257);
  const data = Buffer.from(body, "utf8");
  return [h, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0)];
}
const tar = (files: Record<string, string>) =>
  gzipSync(
    Buffer.concat([
      ...Object.entries(files).flatMap(([p, b]) => entry(`top/${p}`, b)),
      Buffer.alloc(1024, 0),
    ]),
  );

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof SourceFetchError ? e.code : `not a SourceFetchError: ${String(e)}`;
  }
  return "no error";
}

test("an archive over the in-memory limit once unpacked is archive_too_large", () => {
  const zeros = gzipSync(Buffer.alloc(70 * 1024 * 1024, 0));
  assert.equal(
    code(() => untarFiles(zeros, "skills/pdf")),
    "archive_too_large",
  );
});

test("an archive that is not gzip is archive_broken", () => {
  assert.equal(
    code(() => untarFiles(Buffer.from("<html>not an archive</html>"), "skills/pdf")),
    "archive_broken",
  );
});

test("an unsafe path outside the folder still refuses the archive", () => {
  const gz = tar({ "skills/pdf/SKILL.md": "# pdf\n", "other/../../escape.txt": "x" });
  assert.equal(
    code(() => untarFiles(gz, "skills/pdf")),
    "archive_unsafe_path",
  );
});

test(
  "a download that stalls after the headers is github_unreachable",
  { timeout: 15_000 },
  async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/x-gzip", "content-length": "1000000" });
      res.write(Buffer.alloc(16, 1)); // and never more
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const api = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const err = await githubFolder(
        api,
        null,
        { owner: "acme", repo: "skills" },
        "a".repeat(40),
        "skills/pdf",
        {
          timeoutMs: 300,
        },
      ).then(
        () => null,
        (e: unknown) => e,
      );
      assert.ok(err instanceof SourceFetchError, `not a SourceFetchError: ${String(err)}`);
      assert.equal(err.code, "github_unreachable");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
