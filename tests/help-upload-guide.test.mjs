// The help has one topic about uploading artifacts, the publishing
// section starts with it, neighbouring topics link to it, and it promises nothing extra. The
// CLI commands in the topic are checked by `tests/cli-doc-flags.test.mjs` against the real `--help`, and
// the error codes below are matched against the server code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ID = "getting-started/upload-artifacts";
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const topic = (dir) => `packages/web/src/help/${dir}/${ID}.md`;

test("the topic exists and comes first in the publishing section", () => {
  assert.ok(existsSync(join(ROOT, ...topic("topics").split("/"))), `missing ${topic("topics")}`);
  assert.match(read(topic("topics")), /^section: publishing$/m);
  const sections = read("packages/web/src/help/sections.ts");
  const at = sections.indexOf(`"${ID}"`);
  assert.ok(at !== -1, "the topic is not in the section order");
  assert.ok(at < sections.indexOf(`"getting-started/versions-and-digests"`), "the topic is not before the first topic of the section");
});

test("the topic names every upload path", () => {
  const body = read(topic("topics"));
  for (const route of ["`git`", "`zip`", "`folder`", "skillforge agent scan", "skillforge agent publish", "skillforge publish", "/publish", "/import"]) {
    assert.ok(body.includes(route), `upload path not named: ${route}`);
  }
  for (const url of ["`https://`", "`ssh://`", "`git@host:path`"]) assert.ok(body.includes(url), `address form not named: ${url}`);
});

test("the topic says what cannot be done: no import via CLI, no upload via MCP, an MCP token does not publish", () => {
  const body = read(topic("topics"));
  assert.match(body, /no CLI command for Import/);
  assert.match(body, /MCP cannot upload/);
  assert.match(body, /`mcp_token_forbidden`/);
  assert.doesNotMatch(body, /skillforge import\b/, "there is no skillforge import command");
  const mcp = read("packages/web/src/help/topics/getting-started/mcp.md");
  assert.doesNotMatch(mcp, /publish_artifact/, "if MCP gained publishing, the topic must be rewritten");
});

test("after upload: candidate, and the author cannot promote the version to active", () => {
  const body = read(topic("topics"));
  assert.match(body, /\*\*candidate\*\*/);
  assert.match(body, /author of the latest version cannot promote/);
  assert.match(body, /`publish_blocked`/);
});

test("the topic's error codes exist in the server code", () => {
  const src = join(ROOT, "packages", "server", "src");
  const server = readdirSync(src, { recursive: true })
    .filter((f) => String(f).endsWith(".ts"))
    .map((f) => readFileSync(join(src, String(f)), "utf8"))
    .join("\n");
  const codes = ["not_owner", "digest_exists", "version_exists", "publish_blocked", "mcp_token_forbidden", "import_url_not_allowed", "import_git_disabled", "import_too_large"];
  const missing = codes.filter((c) => !server.includes(c));
  assert.deepEqual(missing, []);
  const body = read(topic("topics"));
  assert.deepEqual(codes.filter((c) => !body.includes(`\`${c}\``)), [], "the topic does not name a code");
});

test("neighbouring topics and the user guide link to the topic", () => {
  for (const from of ["getting-started/overview", "getting-started/cli", "getting-started/agents", "pages/publish", "pages/import"]) {
    assert.match(read(`packages/web/src/help/topics/${from}.md`), new RegExp(`^related:.*${ID}`, "m"), from);
  }
  assert.ok(read("docs/en/02-user-guide.md").includes(ID), "docs/en/02-user-guide.md");
});
