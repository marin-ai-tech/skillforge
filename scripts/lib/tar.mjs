// tar for the release script and its tests. On Linux and macOS: `tar` from PATH. On Windows: the system bsdtar
// (System32\tar.exe) first; if it fails (it crashes on some hosted runners), Git's GNU tar with --force-local, its
// own usr/bin on PATH for gzip, and forward-slash paths (it reads "C:" as a remote host and backslashes as escapes).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const WIN = process.platform === "win32";
const SYS_TAR = join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");

/** The outcome of one tar run: exit status, a readable error text, and which tar ran. */
function outcome(r, tool) {
  const reason = r.status === 0 ? "" : (r.error?.message ?? `exit ${r.status}`);
  return { status: r.status, stderr: `${reason} ${r.stderr ?? ""}`.trim(), tool };
}

function gitUsrBin() {
  const r = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const dir = join(r.stdout.trim(), "..", "..", "..", "usr", "bin");
  return existsSync(join(dir, "tar.exe")) ? dir : null;
}

function gnuTar(args, paths, base) {
  const bin = gitUsrBin();
  if (!bin) return { status: 1, stderr: "no Git GNU tar", tool: "git tar" };
  const slashed = args.map((a, i) => (paths.includes(i) ? a.replace(/\\/g, "/") : a));
  const env = { ...process.env, PATH: `${bin};${process.env.PATH ?? ""}` };
  const tool = join(bin, "tar.exe");
  return outcome(spawnSync(tool, ["--force-local", ...slashed], { ...base, env }), tool);
}

/**
 * Runs tar with `args`; `paths` are the indexes of the arguments that are file system paths.
 * Returns { status, stderr, tool } of the run that counted.
 */
export function runTar(args, paths = [], opts = {}) {
  const base = { encoding: "utf8", maxBuffer: 1 << 26, ...opts };
  if (!WIN) return outcome(spawnSync("tar", args, base), "tar");
  const sys = existsSync(SYS_TAR) ? outcome(spawnSync(SYS_TAR, args, base), SYS_TAR) : null;
  if (sys?.status === 0) return sys;
  const gnu = gnuTar(args, paths, base);
  if (gnu.status === 0 || !sys) return gnu;
  return { ...gnu, stderr: `${SYS_TAR}: ${sys.stderr}; then ${gnu.tool}: ${gnu.stderr}` };
}
