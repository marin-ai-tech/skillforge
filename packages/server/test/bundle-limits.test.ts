// bundle-limits: a bundle the size of fpf-problem-solving (1800 files, 40 MiB) is published and validated through
// the HTTP routes — its base64 body (~54 MiB) fits the 96 MiB body limit of these two routes. A body over 96 MiB is
// 413 there, and every other route keeps the 64 MiB limit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withApp, loginCookie } from "./helpers.ts";

const MiB = 1024 * 1024;
const FILES = 1800;
const TOTAL = 40 * MiB;

function bigSkill(): Array<{ path: string; content_base64: string }> {
  const skill =
    "---\nname: big-framework\ndescription: A large reference framework. Use when a problem needs the framework.\n---\n\n# big-framework\n\nRead the sections.\n";
  const per = Math.floor(TOTAL / (FILES - 1));
  const line = "The framework section text, plain prose for a large bundle.\n";
  const body = line.repeat(Math.ceil(per / line.length)).slice(0, per);
  const files = [
    { path: "big-framework/SKILL.md", content_base64: Buffer.from(skill).toString("base64") },
  ];
  for (let i = 1; i < FILES; i++) {
    files.push({
      path: `big-framework/sections/${String(i).padStart(4, "0")}.md`,
      content_base64: Buffer.from(`# Section ${i}\n\n${body}`).toString("base64"),
    });
  }
  return files;
}

test(
  "a 1800-file, 40 MiB skill is validated and published through HTTP",
  { timeout: 300_000 },
  async () => {
    await withApp(async (app) => {
      const cookie = await loginCookie(app);
      const files = bigSkill();
      const validate = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts/validate",
        headers: { cookie },
        payload: { type: "skill", files },
      });
      assert.equal(validate.statusCode, 200, validate.body.slice(0, 500));
      assert.deepEqual((validate.json() as { errors: unknown[] }).errors, []);
      const publish = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: { cookie },
        payload: { type: "skill", files },
      });
      assert.equal(publish.statusCode, 201, publish.body.slice(0, 500));
    });
  },
);

test(
  "negative: over 96 MiB on publish, over 64 MiB elsewhere — 413",
  { timeout: 120_000 },
  async () => {
    await withApp(async (app) => {
      const cookie = await loginCookie(app);
      const json = (bytes: number) => Buffer.from(`{"pad":"${"a".repeat(bytes - 10)}"}`);
      const over96 = await app.inject({
        method: "POST",
        url: "/api/v1/artifacts",
        headers: { cookie, "content-type": "application/json" },
        payload: json(97 * MiB),
      });
      assert.equal(over96.statusCode, 413, "publish: a body over 96 MiB");
      const other = await app.inject({
        method: "POST",
        url: "/api/v1/news/posts",
        headers: { cookie, "content-type": "application/json" },
        payload: json(70 * MiB),
      });
      assert.equal(other.statusCode, 413, "another route keeps 64 MiB");
    });
  },
);
