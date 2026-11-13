// Stub of the GitHub REST API for tracked-sources: `GET /repos/{o}/{r}/commits/{ref}` answers the head commit of a
// branch, tag or sha, `GET /repos/{o}/{r}/tarball/{sha}` the gzipped tar of that commit with GitHub's top folder
// `{o}-{r}-{sha7}/`. Commits are set with `commit(files)`; every request is recorded with its headers.
import http from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

function header(name, size, type = "0") {
  const h = Buffer.alloc(512, 0);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

/** A gzipped tar of { path: text } (text or Buffer); `raw` entries go in as given (for path attacks). */
export function tarGz(files, top = "") {
  const parts = [];
  for (const [p, content] of Object.entries(files)) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    parts.push(header(`${top}${p}`, body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}

export async function startFakeGithub({ owner = "acme", repo = "skills" } = {}) {
  const requests = [];
  const commits = new Map(); // sha -> files
  const refs = new Map(); // ref -> sha
  let head = null;
  let n = 0;
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, headers: { ...req.headers } });
    const url = new URL(req.url, "http://x");
    const m = new RegExp(`^/repos/${owner}/${repo}/(commits|tarball)/([^/]+)$`).exec(url.pathname);
    if (!m) {
      res.writeHead(404, { "content-type": "application/json" }).end('{"message":"Not Found"}');
      return;
    }
    const ref = decodeURIComponent(m[2]);
    const sha = refs.get(ref) ?? (commits.has(ref) ? ref : null);
    if (!sha) {
      res.writeHead(404, { "content-type": "application/json" }).end('{"message":"No commit found"}');
      return;
    }
    if (m[1] === "commits") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sha }));
      return;
    }
    res.writeHead(200, { "content-type": "application/x-gzip" }).end(tarGz(commits.get(sha), `${owner}-${repo}-${sha.slice(0, 7)}/`));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${server.address().port}`;
  return {
    api,
    url: `https://github.com/${owner}/${repo}`,
    requests,
    /** A new commit with these files; it becomes the head of `main` (and of `branch` when given). */
    commit(files, branch) {
      const sha = createHash("sha1").update(`${++n}:${JSON.stringify(Object.keys(files))}`).digest("hex");
      commits.set(sha, files);
      refs.set("HEAD", sha);
      refs.set(branch ?? "main", sha);
      head = sha;
      return sha;
    },
    get head() {
      return head;
    },
    async stop() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r()));
    },
  };
}
