/** What a stdio server runs: the launcher, the package it fetches and whether that package is pinned exactly. */
export type Launch = {
  launcher: string | null;
  package: string | null;
  pinned: boolean;
  version: string | null;
};

const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const EXACT_PY_VERSION_RE = /^\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)*$/i;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
/** docker/podman run flags that take a separate value. */
const DOCKER_VALUE_FLAGS = new Set([
  "-e",
  "--env",
  "--env-file",
  "-v",
  "--volume",
  "--mount",
  "--name",
  "--network",
  "-p",
  "--publish",
  "-w",
  "--workdir",
  "--entrypoint",
  "-u",
  "--user",
  "-l",
  "--label",
  "--platform",
  "--pull",
  "-m",
  "--memory",
]);

/** Program name without directory and extension, lower case: `C:\x\npx.cmd` → `npx`. */
export function launcherName(command: string): string | null {
  const base = command.split(/[\\/]/).pop() ?? "";
  const name = base.replace(/\.(?:exe|cmd|bat|ps1|sh)$/i, "").toLowerCase();
  return name === "" ? null : name;
}

/** First positional argument, honouring `--opt=value` and options that take the next argument. */
function packageArg(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
  specFlags: ReadonlySet<string>,
): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0 && specFlags.has(a.slice(0, eq))) return a.slice(eq + 1);
    if (specFlags.has(a)) return args[i + 1] ?? null;
    if (valueFlags.has(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("-")) return a;
  }
  return null;
}

function npmSpec(spec: string | null): Omit<Launch, "launcher"> {
  if (!spec) return { package: null, pinned: false, version: null };
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { package: spec, pinned: false, version: null };
  const version = spec.slice(at + 1);
  const pinned = EXACT_SEMVER_RE.test(version);
  return { package: spec.slice(0, at), pinned, version: pinned ? version : null };
}

function pySpec(spec: string | null): Omit<Launch, "launcher"> {
  if (!spec) return { package: null, pinned: false, version: null };
  const m = /^([^=@<>!~\s]+?)(?:==|@)(.+)$/.exec(spec);
  const name = (m ? m[1]! : spec.split(/[<>=!~]/)[0]!).replace(/\[.*\]$/, "");
  const pinned = !!m && EXACT_PY_VERSION_RE.test(m[2]!);
  return { package: name, pinned, version: pinned ? m![2]! : null };
}

function imageSpec(image: string | null): Omit<Launch, "launcher"> {
  if (!image) return { package: null, pinned: false, version: null };
  const at = image.indexOf("@");
  if (at > 0) {
    const digest = image.slice(at + 1);
    const pinned = DIGEST_RE.test(digest);
    return { package: image.slice(0, at), pinned, version: pinned ? digest : null };
  }
  const colon = image.lastIndexOf(":");
  const slash = image.lastIndexOf("/");
  return { package: colon > slash ? image.slice(0, colon) : image, pinned: false, version: null };
}

const NONE = new Set<string>();
const NPX_SPEC_FLAGS = new Set(["-p", "--package"]);
const UVX_SPEC_FLAGS = new Set(["--from"]);
const UVX_VALUE_FLAGS = new Set(["--with", "--python", "-p", "--index", "--index-url"]);

function npxLike(args: readonly string[]): Omit<Launch, "launcher"> {
  return npmSpec(packageArg(args, NONE, NPX_SPEC_FLAGS));
}

function uvxLike(args: readonly string[]): Omit<Launch, "launcher"> {
  return pySpec(packageArg(args, UVX_VALUE_FLAGS, UVX_SPEC_FLAGS));
}

function dockerRun(args: readonly string[]): Omit<Launch, "launcher"> {
  if (args[0] !== "run") return { package: null, pinned: false, version: null };
  return imageSpec(packageArg(args.slice(1), DOCKER_VALUE_FLAGS, NONE));
}

function bySubcommand(launcher: string, args: readonly string[]): Omit<Launch, "launcher"> | null {
  if ((launcher === "pnpm" || launcher === "yarn") && args[0] === "dlx")
    return npxLike(args.slice(1));
  if (launcher === "uv" && args[0] === "tool" && args[1] === "run") return uvxLike(args.slice(2));
  return null;
}

export function analyzeLaunch(command: string, args: readonly string[]): Launch {
  const launcher = launcherName(command);
  if (!launcher) return { launcher, package: null, pinned: false, version: null };
  if (launcher === "npx" || launcher === "bunx") return { launcher, ...npxLike(args) };
  if (launcher === "uvx") return { launcher, ...uvxLike(args) };
  if (launcher === "docker" || launcher === "podman") return { launcher, ...dockerRun(args) };
  const sub = bySubcommand(launcher, args);
  return { launcher, ...(sub ?? { package: null, pinned: false, version: null }) };
}
