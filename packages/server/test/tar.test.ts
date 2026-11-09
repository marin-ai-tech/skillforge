import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTarGz } from "../src/distribution/tar.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

test("buildTarGz: deterministic, extracts, scripts mode 0755", () => {
  const entries = [
    { path: "hooks/hooks.json", content: new TextEncoder().encode('{"hooks":[]}\n') },
    { path: "scripts/guard.sh", content: new TextEncoder().encode("#!/bin/sh\necho ok\n") },
  ];
  const a = buildTarGz(entries);
  const b = buildTarGz(entries);
  assert.equal(sha(a), sha(b));

  const dir = mkdtempSync(join(tmpdir(), "sf-tar-"));
  try {
    mkdirSync(join(dir, "out"));
    writeFileSync(join(dir, "a.tar.gz"), a);
    execFileSync("tar", ["-xzf", "a.tar.gz", "-C", "out"], { cwd: dir, stdio: "pipe" });
    assert.equal(readFileSync(join(dir, "out", "hooks", "hooks.json"), "utf8"), '{"hooks":[]}\n');
    assert.equal(
      readFileSync(join(dir, "out", "scripts", "guard.sh"), "utf8"),
      "#!/bin/sh\necho ok\n",
    );
    const listing = execFileSync("tar", ["-tvzf", "a.tar.gz"], {
      cwd: dir,
      stdio: "pipe",
    }).toString();
    const guard = listing.split(/\r?\n/).find((l) => l.endsWith("scripts/guard.sh"));
    assert.ok(guard, listing);
    assert.match(guard!, /^-rwxr-xr-x/);
    const hooks = listing.split(/\r?\n/).find((l) => l.endsWith("hooks/hooks.json"));
    assert.match(hooks!, /^-rw-r--r--/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  void chmodSync;
});
