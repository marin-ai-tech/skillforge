// A stored file is checked against its own hash on read: a corrupted one is not served (500 `blob_corrupt`, no content),
// and publishing the same file in a new version restores it instead of silently reusing the corrupted one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, api, login, toB64, ADMIN_PASSWORD } from "./lib/client.mjs";

const A = "/api/v1/artifacts/skill/intact-skill";
const REF = "# Reference\n\nThe original reference text.\n";
const md = (rev) => `---\nname: intact-skill\ndescription: Integrity probe. Use when testing storage.\n---\n\n# intact-skill\n\nSteps ${rev}.\n`;
const files = (rev) => toB64([{ path: "intact-skill/SKILL.md", content: md(rev) }, { path: "intact-skill/references/ref.md", content: REF }]);
let srv;
let admin;
let refPath;
let refSha;
const call = (method, path, body) => api(srv.base, method, path, body, { cookie: admin.cookie });
const raw = (path) => fetch(`${srv.base}${path}`, { headers: { cookie: admin.cookie } });

before(async () => {
  srv = await startServer({}, { prefix: "skillforge-blobs-" });
  assert.ok(srv.up, srv.stderr);
  admin = await login(srv.base, "admin", ADMIN_PASSWORD);
  assert.equal((await call("POST", "/api/v1/artifacts", { type: "skill", version: "0.1.0", files: files("one") })).status, 201);
  const card = (await call("GET", A)).data;
  const ref = card.latest.files.find((f) => f.path.endsWith("references/ref.md"));
  refPath = ref.path;
  refSha = ref.sha256;
  // Damage the stored file behind the server's back: same length class, different bytes.
  writeFileSync(join(srv.dataDir, "blobs", refSha.slice(0, 2), refSha), "# Reference\n\nTAMPERED reference text!\n");
});

after(async () => {
  await srv?.stop();
});

test("a corrupted file is not served: file, bundle — 500 blob_corrupt without content", async () => {
  const file = await raw(`${A}/versions/0.1.0/files/${refPath}`);
  assert.equal(file.status, 500);
  const body = await file.text();
  assert.match(body, /blob_corrupt/);
  assert.doesNotMatch(body, /TAMPERED/);
  const bundle = await raw(`${A}/versions/0.1.0/bundle.zip`);
  assert.equal(bundle.status, 500);
  assert.match(await bundle.text(), /blob_corrupt/);
});

test("an intact file of the same version is still readable", async () => {
  const main = await raw(`${A}/versions/0.1.0/files/skills/intact-skill/SKILL.md`);
  assert.equal(main.status, 200);
  assert.match(await main.text(), /Steps one/);
});

test("a new version with the same file restores it, and the old version is readable again", async () => {
  const pub = await call("POST", "/api/v1/artifacts", { type: "skill", version: "0.2.0", files: files("two") });
  assert.equal(pub.status, 201, JSON.stringify(pub.data));
  for (const v of ["0.1.0", "0.2.0"]) {
    const r = await raw(`${A}/versions/${v}/files/${refPath}`);
    assert.equal(r.status, 200, v);
    assert.equal(await r.text(), REF, `${v}: original text`);
  }
  assert.equal((await raw(`${A}/versions/0.1.0/bundle.zip`)).status, 200);
});
