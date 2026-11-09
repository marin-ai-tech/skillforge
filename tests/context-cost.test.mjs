// A skill costs tokens on every turn (name and description in the skill list), on invocation (body of the main file) and on demand (other
// text files). The estimate is in the quality report (`quality.context`, algorithm 5), the level is in the catalog summary.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api, login, loadDir, toB64, ROOT, ADMIN_PASSWORD } from "./lib/client.mjs";

let srv;
let admin;
const call = (method, path, body) => api(srv.base, method, path, body, { cookie: admin.cookie });

// Latin text: 4 characters per token, rounded up (estimate contract, same as `body_tokens_est`).
const latin = (s) => Math.ceil(s.length / 4);

function skill(name, description, body, extra = []) {
  const md = `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
  return toB64([{ path: `${name}/SKILL.md`, content: md }, ...extra.map((f) => ({ path: `${name}/${f.path}`, content: f.content }))]);
}

async function publish(type, files) {
  const r = await call("POST", "/api/v1/artifacts", { type, files });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

async function quality(type, name) {
  const r = await call("GET", `/api/v1/artifacts/${type}/${name}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.latest.quality;
}

async function summary(name) {
  const r = await call("GET", "/api/v1/artifacts?limit=200");
  return r.data.items.find((i) => i.name === name);
}

const SHORT_DESC = "Formats release notes from merged pull requests. Use when preparing a release.";
const BODY = "\n# notes\n\nCollect merged pull requests, group them by label and write the notes.\n";
const REF = "# Labels\n\n" + "Each label maps to one section of the notes. ".repeat(20);

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-context-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  await publish("skill", skill("cheap-notes", SHORT_DESC, BODY, [{ path: "references/labels.md", content: REF }]));
  await publish("skill", skill("chatty-desc", `${"Handles every kind of document task in the company. ".repeat(17)}Use when needed.`, BODY));
  await publish("skill", skill("huge-body", SHORT_DESC, `\n# huge\n\n${"Step: check the input and write the output. ".repeat(500)}\n`));
});

after(async () => {
  await srv?.stop();
});

test("skill: every turn — name and description, on invocation — body, on demand — other files", async () => {
  const q = await quality("skill", "cheap-notes");
  assert.equal(q.algorithm, 5);
  assert.ok(q.context, "no quality.context");
  assert.equal(q.context.every_turn, latin(`cheap-notes: ${SHORT_DESC}`));
  assert.equal(q.context.on_use, q.metrics.body_tokens_est, "on invocation — body of the main file");
  assert.equal(q.context.on_demand, latin(REF));
  assert.equal(q.context.level, "low");
});

test("expensive description and expensive body — level high; a cheap one is not flagged", async () => {
  const desc = await quality("skill", "chatty-desc");
  assert.ok(desc.context.every_turn > 200, String(desc.context.every_turn));
  assert.equal(desc.context.level, "high");
  const body = await quality("skill", "huge-body");
  assert.ok(body.context.on_use > 5000, String(body.context.on_use));
  assert.equal(body.context.level, "high");
  assert.equal((await summary("chatty-desc")).quality.context, "high");
  assert.equal((await summary("huge-body")).quality.context, "high");
  assert.equal((await summary("cheap-notes")).quality.context, "low");
});

test("a hook costs no context tokens; a plugin sums its components", async () => {
  // A hook needs a common root folder: it names the artifact.
  const guard = loadDir(join(ROOT, "tests", "fixtures", "artifacts", "hook-guard"));
  await publish("hook", toB64(guard.map((f) => ({ path: `destructive-guard/${f.path}`, content: f.content }))));
  const hook = await quality("hook", "destructive-guard");
  assert.deepEqual(
    { every_turn: hook.context.every_turn, on_use: hook.context.on_use },
    { every_turn: 0, on_use: 0 },
  );
  const kit = join(ROOT, "tests", "fixtures", "cc-plugins", "team-kit");
  await publish("plugin", toB64(loadDir(kit).map((f) => ({ path: `team-kit/${f.path}`, content: f.content }))));
  const plugin = await quality("plugin", "team-kit");
  assert.ok(plugin.context.every_turn > 0 && plugin.context.on_use > 0, JSON.stringify(plugin.context));
});
