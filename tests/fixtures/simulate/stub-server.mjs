// Fixture: a "lying" server for simulate-mvp.
// /api/v1/health responds 200, everything else responds with STUB_STATUS (200 by default) and an empty JSON.
// An honest simulation against such a server must finish with a non-zero exit code.
import { createServer } from "node:http";

const port = Number(process.env.SKILLFORGE_PORT);
const host = process.env.SKILLFORGE_HOST || "127.0.0.1";
const status = Number(process.env.STUB_STATUS || 200);

const server = createServer((req, res) => {
  const ok = req.url && req.url.startsWith("/api/v1/health");
  res.writeHead(ok ? 200 : status, { "content-type": "application/json", "set-cookie": "sf_session=stub; Path=/" });
  res.end(ok ? JSON.stringify({ status: "ok", version: "stub", data_dir: process.env.SKILLFORGE_DATA_DIR ?? "" }) : "{}");
});
server.listen(port, host);
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
