import fs from "node:fs";
import path from "node:path";

/**
 * Project signals for context hints: dependency names, technologies by file extension and
 * well-known configuration files, gathered on this machine. Only names are read: never the code itself.
 */
const MAX_DEPTH = 4;
const MAX_ENTRIES = 5000;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  ".venv",
  "venv",
  "target",
  "__pycache__",
]);

const EXTENSIONS: Record<string, string> = {
  ".tf": "terraform",
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".sql": "sql",
  ".sh": "shell",
  ".ps1": "powershell",
  ".proto": "protobuf",
  ".vue": "vue",
  ".svelte": "svelte",
  ".scala": "scala",
};

const FILES: Record<string, string> = {
  dockerfile: "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  "chart.yaml": "helm",
  "kustomization.yaml": "kubernetes",
  makefile: "make",
  ".gitlab-ci.yml": "gitlab-ci",
  "serverless.yml": "serverless",
  "package.json": "nodejs",
};

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** `@scope/name` gives both `name` and `@scope/name`, so a tag can name either. */
function packageNames(name: string): string[] {
  const n = name.toLowerCase();
  return n.startsWith("@") && n.includes("/") ? [n, n.split("/")[1]!] : [n];
}

function npmDeps(text: string): string[] {
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    const names = ["dependencies", "devDependencies", "peerDependencies"].flatMap((k) =>
      pkg[k] && typeof pkg[k] === "object" ? Object.keys(pkg[k] as object) : [],
    );
    return ["javascript", ...names.flatMap(packageNames)];
  } catch {
    return ["javascript"];
  }
}

const PY_REQ = /^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)/;
const PY_QUOTED = /"([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:[<>=~!;[\s]|")/g;

function pythonRequirements(text: string): string[] {
  const names = text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#") && !l.trim().startsWith("-"))
    .map((l) => PY_REQ.exec(l)?.[1]?.toLowerCase())
    .filter((n): n is string => Boolean(n));
  return ["python", ...names];
}

function pyproject(text: string): string[] {
  return ["python", ...[...text.matchAll(PY_QUOTED)].map((m) => m[1]!.toLowerCase())];
}

function goMod(text: string): string[] {
  const names = [...text.matchAll(/^\s*(?:require\s+)?([\w.-]+\/[\w./-]+)\s+v\d/gm)].map((m) =>
    m[1]!.split("/").pop()!.toLowerCase(),
  );
  return ["go", ...names];
}

function cargo(text: string): string[] {
  const deps = text.split(/^\[dependencies\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  const names = [...deps.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]!.toLowerCase());
  return ["rust", ...names];
}

const MANIFESTS: Array<[(file: string) => boolean, (text: string) => string[]]> = [
  [(f) => f === "package.json", npmDeps],
  [(f) => /^requirements.*\.txt$/.test(f), pythonRequirements],
  [(f) => f === "pyproject.toml", pyproject],
  [(f) => f === "go.mod", goMod],
  [(f) => f === "cargo.toml", cargo],
];

function signalsOfFile(full: string, name: string): string[] {
  const lower = name.toLowerCase();
  const out: string[] = [];
  const ext = EXTENSIONS[path.extname(lower)];
  if (ext) out.push(ext);
  if (FILES[lower]) out.push(FILES[lower]!);
  const manifest = MANIFESTS.find(([is]) => is(lower));
  if (manifest) {
    const text = readText(full);
    if (text !== null) out.push(...manifest[1](text));
  }
  return out;
}

/** Sorted, unique signals of the project at `root`. */
export function collectSignals(root: string): string[] {
  const found = new Set<string>();
  let seen = 0;
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "workflows" && path.basename(dir) === ".github") found.add("github-actions");
        if (!SKIP_DIRS.has(e.name) && depth < MAX_DEPTH) walk(full, depth + 1);
      } else if (e.isFile()) {
        for (const s of signalsOfFile(full, e.name)) found.add(s);
      }
    }
  };
  walk(root, 0);
  return [...found].sort();
}
