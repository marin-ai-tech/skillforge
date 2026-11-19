// fix-tracked-source-archive: an unexpected error of a source check stays `check_failed`, but is no longer silent —
// it goes to the server log with the artifact, the source address and the error. Expected failures carry their own
// code and are not logged as unexpected. The unexpected error is forced by a config whose GitHub address cannot be read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.ts";
import { checkSource } from "../src/tracked/check.ts";
import { withApp, loginCookie } from "./helpers.ts";

const SHA = "a".repeat(40);
const SKILL =
  "---\nname: pdf\ndescription: Works with PDF files. Use when a PDF must be read.\n---\n\n# pdf\n\nRead first.\n";

test("an unexpected error is check_failed and is logged with the artifact, the address and the error", async () => {
  await withApp(
    async (app, dataDir, config) => {
      const cookie = await loginCookie(app);
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: { cookie },
        payload: {
          type: "skill",
          files: [{ path: "pdf/SKILL.md", content_base64: Buffer.from(SKILL).toString("base64") }],
          provenance: { source: "import", ref: `https://github.com/acme/skills@${SHA}:skills/pdf` },
        },
      });
      assert.equal(r.statusCode, 201, r.body);
      const db = openDatabase(dataDir);
      try {
        const row = db.prepare("SELECT id FROM artifacts WHERE name = 'pdf'").get() as {
          id: string;
        };
        const broken = new Proxy(config, {
          get(target, key, receiver) {
            if (key === "githubApiUrl") throw new Error("boom: address unreadable");
            return Reflect.get(target, key, receiver);
          },
        });
        const lines: Array<Record<string, unknown>> = [];
        const result = await checkSource(db, broken, row.id, (msg, fields) =>
          lines.push({ msg, ...fields }),
        );
        assert.deepEqual([result.state, result.detail], ["failed", "check_failed"]);
        assert.equal(lines.length, 1, JSON.stringify(lines));
        assert.equal(lines[0]!.msg, "source_check_failed");
        assert.equal(lines[0]!.artifact, "skill/pdf");
        assert.equal(lines[0]!.url, "https://github.com/acme/skills");
        assert.match(String(lines[0]!.error), /boom: address unreadable/);
      } finally {
        db.close();
      }
    },
    { importGit: false },
  );
});
