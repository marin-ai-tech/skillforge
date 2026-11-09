// Acceptance tests: the test server counts as up only if it answered itself. Otherwise a test
// silently works with a neighbor's server that has different settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { startServer } from "./lib/client.mjs";

test("the port is taken by a foreign server answering /health: startServer gives up: false", async () => {
  const foreign = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
  });
  await new Promise((r) => foreign.listen(0, "127.0.0.1", r));
  const { port } = foreign.address();
  try {
    const srv = await startServer({}, { prefix: "skillforge-identity-", port });
    if (srv.up) await srv.stop();
    assert.equal(srv.up, false, "a foreign server was taken for our own");
  } finally {
    await new Promise((r) => foreign.close(r));
  }
});

test("normal start: the server is up and answers itself", async () => {
  const srv = await startServer({}, { prefix: "skillforge-identity-" });
  try {
    assert.equal(srv.up, true, srv.stderr);
    assert.match(srv.stdout, /SkillForge listening on/);
  } finally {
    await srv.stop();
  }
});
