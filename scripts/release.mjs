#!/usr/bin/env node
// release-dist: builds the SkillForge release into dist/release (or --out):
//   skillforge-<v>.zip / .tar.gz   — server + web + runtime dependencies + start scripts (Windows and Linux)
//   skillforge-cli-<v>.tgz         — the CLI as one file without dependencies (also inside the archive, in downloads/)
//   skillforge-setup-<v>.exe       — Windows installer (NSIS) with the bundled Node.js; needs makensis and a Windows
//                                    node.exe (SKILLFORGE_NODE_WIN_EXE), both are in the sandbox image
//   SHA256SUMS.txt, RELEASE-NOTES.md
// Usage: npm run release [-- --out <dir>] [--skip-build] [--no-installer]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEMPLATES = join(ROOT, "scripts", "release");
const WIN = process.platform === "win32";
const WORKSPACES = ["core", "server", "cli", "web"];

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const OUT = resolve(argValue("--out") ?? join(ROOT, "dist", "release"));
const SKIP_BUILD = process.argv.includes("--skip-build");
const NO_INSTALLER = process.argv.includes("--no-installer");

function step(message) {
  console.log(`release: ${message}`);
}

/** npm on Windows is a .cmd: it needs a shell, so the arguments (all ours, no user input) are quoted into one line. */
function run(cmd, args, cwd = ROOT) {
  const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const r = WIN
    ? spawnSync([cmd, ...args].map(quote).join(" "), { cwd, stdio: "inherit", shell: true })
    : spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** One version for the whole repository (design decision 1). */
function releaseVersion() {
  const version = readJson(join(ROOT, "package.json")).version;
  for (const w of WORKSPACES) {
    const v = readJson(join(ROOT, "packages", w, "package.json")).version;
    if (v !== version) throw new Error(`packages/${w} has version ${v}, the repository ${version}`);
  }
  return version;
}

function requireBuilt() {
  for (const p of [
    "packages/core/dist",
    "packages/server/dist/index.js",
    "packages/cli/dist/index.js",
    "packages/web/dist/index.html",
    "packages/web/dist/help-corpus/en",
  ]) {
    if (!existsSync(join(ROOT, p)))
      throw new Error(`${p} is missing: run npm run build (or drop --skip-build)`);
  }
}

/** Release root: built packages, migrations, starter packs, templates — no sources, tests or dev tools. */
function stageRelease(stage, version) {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const rootPkg = readJson(join(ROOT, "package.json"));
  writeFileSync(
    join(stage, "package.json"),
    `${JSON.stringify({ name: rootPkg.name, version, private: true, type: rootPkg.type, engines: rootPkg.engines, workspaces: rootPkg.workspaces }, null, 2)}\n`,
  );
  cpSync(join(ROOT, "package-lock.json"), join(stage, "package-lock.json"));
  for (const w of WORKSPACES) {
    cpSync(join(ROOT, "packages", w, "package.json"), join(stage, "packages", w, "package.json"));
    cpSync(join(ROOT, "packages", w, "dist"), join(stage, "packages", w, "dist"), {
      recursive: true,
    });
  }
  cpSync(join(ROOT, "packages/server/migrations"), join(stage, "packages/server/migrations"), {
    recursive: true,
  });
  cpSync(
    join(ROOT, "packages/server/starter-packs"),
    join(stage, "packages/server/starter-packs"),
    { recursive: true },
  );
  cpSync(
    join(ROOT, "plugins/review-assistant"),
    join(stage, "packages/server/bundled-plugins/review-assistant"),
    { recursive: true },
  );
  for (const f of ["start.cmd", "start.ps1", "start.sh", "skillforge.env.example", "INSTALL.md"]) {
    cpSync(join(TEMPLATES, f), join(stage, f));
  }
  cpSync(join(TEMPLATES, "docker"), join(stage, "docker"), { recursive: true });
}

/**
 * Runtime dependencies only (`npm ci --omit=dev`), then workspace links become real folders: archives must not depend
 * on symbolic links (zip has none, Windows extraction does not create them).
 */
function installRuntimeDeps(stage) {
  run(
    WIN ? "npm.cmd" : "npm",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      "--workspace=packages/server",
      "--workspace=packages/cli",
    ],
    stage,
  );
  const scope = join(stage, "node_modules", "@skillforge");
  if (!existsSync(scope)) return;
  for (const name of readdirSync(scope)) {
    const link = join(scope, name);
    if (!lstatSync(link).isSymbolicLink()) continue;
    const target = realpathSync(link);
    rmSync(link, { recursive: true, force: true });
    if (name === "web") continue; // the SPA is served from packages/web/dist, nothing imports it
    mkdirSync(link, { recursive: true });
    cpSync(join(target, "package.json"), join(link, "package.json"));
    cpSync(join(target, "dist"), join(link, "dist"), { recursive: true });
  }
}

/** The CLI as one ESM file with core and dependencies inside; `npm pack` makes the tgz (design decision 3). */
async function buildCli(work, version) {
  const { build } = await import("esbuild");
  const pkgDir = join(work, "cli-package");
  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  await build({
    entryPoints: [join(ROOT, "packages/cli/dist/index.js")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile: join(pkgDir, "dist", "skillforge.mjs"),
    banner: {
      js: "import { createRequire as __sfRequire } from 'node:module'; const require = __sfRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  // The shebang must be the very first line (esbuild keeps the source one only for the entry file it reads).
  const out = join(pkgDir, "dist", "skillforge.mjs");
  const code = readFileSync(out, "utf8").replace(/^#!.*\n/gm, "");
  writeFileSync(out, `#!/usr/bin/env node\n${code}`);
  writeFileSync(
    join(pkgDir, "package.json"),
    `${JSON.stringify({ name: "skillforge-cli", version, description: "SkillForge CLI: install, sync and publish skills, commands and agents for AI coding agents.", type: "module", bin: { skillforge: "dist/skillforge.mjs" }, engines: { node: ">=24" }, files: ["dist", "README.md"], license: "UNLICENSED" }, null, 2)}\n`,
  );
  writeFileSync(
    join(pkgDir, "README.md"),
    `# skillforge-cli ${version}\n\nThe SkillForge CLI. See the registry help topic "Using the CLI" or docs/en/03-self-hosting.md.\n`,
  );
  mkdirSync(work, { recursive: true });
  run(WIN ? "npm.cmd" : "npm", ["pack", "--pack-destination", work, "--silent"], pkgDir);
  return join(work, `skillforge-cli-${version}.tgz`);
}

function filesOf(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesOf(p, base) : [relative(base, p).replace(/\\/g, "/")];
  });
}

/** zip of `dir` under `prefix/` plus extra files (name → absolute path), deflate level 6. */
function writeZip(dir, prefix, outFile, extra = {}) {
  const entries = {};
  for (const rel of filesOf(dir))
    entries[`${prefix}${rel}`] = [readFileSync(join(dir, rel)), { level: 6 }];
  for (const [name, path] of Object.entries(extra))
    entries[name] = [readFileSync(path), { level: 6 }];
  writeFileSync(outFile, zipSync(entries));
}

/** The commit being released, 12 characters: in the notes and, through build.json, in /api/v1/health. */
function buildCommit() {
  const r = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const commit = (r.stdout ?? "").trim();
  if (r.status !== 0 || !/^[0-9a-f]{12}$/.test(commit)) throw new Error("no git commit to release");
  return commit;
}

/** NSIS installer: payload.zip (release + the official Windows node.exe), version.txt, install/uninstall scripts. */
function buildInstaller(stage, work, version) {
  const nodeExe = process.env.SKILLFORGE_NODE_WIN_EXE;
  if (!nodeExe || !existsSync(nodeExe)) {
    throw new Error(
      "SKILLFORGE_NODE_WIN_EXE must point to a Windows node.exe (or use --no-installer)",
    );
  }
  const dir = join(work, "installer");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeZip(stage, "", join(dir, "payload.zip"), { "node/node.exe": nodeExe });
  writeFileSync(join(dir, "version.txt"), `${version}\n`);
  for (const f of ["install.ps1", "uninstall.ps1"])
    cpSync(join(TEMPLATES, "windows", f), join(dir, f));
  const target = join(OUT, `skillforge-setup-${version}.exe`);
  const r = spawnSync(
    "makensis",
    [
      "-V2",
      `-DVERSION=${version}`,
      `-DSRC=${dir}`,
      `-DOUTFILE=${target}`,
      join(TEMPLATES, "windows", "installer.nsi"),
    ],
    { stdio: "inherit" },
  );
  if (r.error || r.status !== 0 || !existsSync(target)) {
    throw new Error(
      `makensis failed (${r.error?.message ?? r.status}); use --no-installer without it`,
    );
  }
  return target;
}

/** The section `## [<version>] …` of CHANGELOG.md without its heading, or null. */
function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(
    (l) => l.startsWith(`## [${version}]`) || l.startsWith(`## ${version}`),
  );
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** Release notes: the version's section of CHANGELOG.md. */
function writeNotes(version, commit) {
  const changelog = join(ROOT, "CHANGELOG.md");
  const section = existsSync(changelog)
    ? changelogSection(readFileSync(changelog, "utf8"), version)
    : null;
  const lines = [
    `# SkillForge ${version}`,
    "",
    `Commit: ${commit}`,
    "",
    "Requirements: Node.js 24 or newer for the archive; the Windows installer bundles Node.js. See INSTALL.md.",
    "",
    section ?? "See CHANGELOG.md in the repository.",
    "",
  ];
  writeFileSync(join(OUT, "RELEASE-NOTES.md"), lines.join("\n"));
}

function writeSums() {
  const names = readdirSync(OUT)
    .filter((n) => statSync(join(OUT, n)).isFile() && n !== "SHA256SUMS.txt")
    .sort();
  const lines = names.map(
    (n) =>
      `${createHash("sha256")
        .update(readFileSync(join(OUT, n)))
        .digest("hex")}  ${n}`,
  );
  writeFileSync(join(OUT, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

async function main() {
  const version = releaseVersion();
  step(`version ${version} → ${OUT}`);
  if (!SKIP_BUILD) run(WIN ? "npm.cmd" : "npm", ["run", "build"]);
  requireBuilt();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const work = join(OUT, ".work");
  const name = `skillforge-${version}`;
  const stage = join(work, name);

  const commit = buildCommit();
  step("staging the release");
  stageRelease(stage, version);
  writeFileSync(join(stage, "packages", "server", "build.json"), `${JSON.stringify({ commit })}\n`);
  step("installing runtime dependencies");
  installRuntimeDeps(stage);
  step("bundling the CLI");
  const cli = await buildCli(work, version);
  mkdirSync(join(stage, "downloads"), { recursive: true });
  cpSync(cli, join(stage, "downloads", `skillforge-cli-${version}.tgz`));
  cpSync(cli, join(stage, "downloads", "skillforge-cli.tgz"));
  cpSync(cli, join(OUT, `skillforge-cli-${version}.tgz`));

  step("archives");
  // Windows: the system bsdtar; without it, GNU tar from PATH with --force-local (it reads "C:" as a remote host).
  const sysTar = join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");
  const [tarExe, tarArgs] = !WIN
    ? ["tar", []]
    : existsSync(sysTar)
      ? [sysTar, []]
      : ["tar", ["--force-local"]];
  const tar = spawnSync(
    tarExe,
    [...tarArgs, "-czf", join(OUT, `${name}.tar.gz`), "-C", work, name],
    {
      stdio: ["ignore", "inherit", "pipe"],
      encoding: "utf8",
    },
  );
  if (tar.status !== 0) {
    throw new Error(
      `tar failed (${tarExe}: ${tar.error?.message ?? `exit ${tar.status}`}) ${tar.stderr ?? ""}`.trim(),
    );
  }
  writeZip(stage, `${name}/`, join(OUT, `${name}.zip`));

  if (!NO_INSTALLER) {
    step("Windows installer (NSIS)");
    buildInstaller(stage, work, version);
  }
  rmSync(work, { recursive: true, force: true });
  writeNotes(version, commit);
  writeSums();
  step(`done: ${readdirSync(OUT).join(", ")}`);
}

main().catch((e) => {
  console.error(`release: ${e.message}`);
  process.exit(1);
});
