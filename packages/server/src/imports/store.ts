import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MaterializedFile } from "./sources.ts";

export type ImportMeta = {
  user_id: string;
  kind: "files" | "zip" | "git";
  ref: string;
  /** Git only: re-checked by the run, because the policy can change after the preview. */
  git?: { url: string; location_key: string; commit: string };
  expires_at: string;
  created_at: string;
};

export type StoredTree = {
  files: Array<{ path: string; content_base64: string }>;
};

export type ImportStoreLoad =
  | { ok: true; meta: ImportMeta; files: MaterializedFile[] }
  | { ok: false; error: "not_found" | "expired" | "forbidden" };

function importsRoot(dataDir: string): string {
  return path.join(dataDir, "tmp", "imports");
}

function importDir(dataDir: string, id: string): string {
  return path.join(importsRoot(dataDir), id);
}

export function newImportId(): string {
  return randomBytes(16).toString("hex");
}

export function saveImport(
  dataDir: string,
  id: string,
  meta: ImportMeta,
  files: MaterializedFile[],
): void {
  const dir = importDir(dataDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const tree: StoredTree = {
    files: files.map((f) => ({
      path: f.path,
      content_base64: Buffer.from(f.content).toString("base64"),
    })),
  };
  fs.writeFileSync(path.join(dir, "tree.json"), JSON.stringify(tree), "utf8");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
}

export function loadImport(
  dataDir: string,
  id: string,
  userId: string,
  now: Date = new Date(),
): ImportStoreLoad {
  const dir = importDir(dataDir, id);
  const metaPath = path.join(dir, "meta.json");
  const treePath = path.join(dir, "tree.json");
  if (!fs.existsSync(metaPath) || !fs.existsSync(treePath)) {
    return { ok: false, error: "not_found" };
  }
  let meta: ImportMeta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as ImportMeta;
  } catch {
    return { ok: false, error: "not_found" };
  }
  if (meta.user_id !== userId) {
    return { ok: false, error: "forbidden" };
  }
  if (Date.parse(meta.expires_at) <= now.getTime()) {
    return { ok: false, error: "expired" };
  }
  let tree: StoredTree;
  try {
    tree = JSON.parse(fs.readFileSync(treePath, "utf8")) as StoredTree;
  } catch {
    return { ok: false, error: "not_found" };
  }
  const files: MaterializedFile[] = tree.files.map((f) => ({
    path: f.path,
    content: new Uint8Array(Buffer.from(f.content_base64, "base64")),
  }));
  return { ok: true, meta, files };
}

export function deleteImport(dataDir: string, id: string): void {
  const dir = importDir(dataDir, id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function cleanupExpiredImports(dataDir: string, now: Date = new Date()): number {
  const root = importsRoot(dataDir);
  if (!fs.existsSync(root)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(root)) {
    const metaPath = path.join(root, name, "meta.json");
    let expired = false;
    if (!fs.existsSync(metaPath)) {
      expired = true;
    } else {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as ImportMeta;
        if (Date.parse(meta.expires_at) <= now.getTime()) expired = true;
      } catch {
        expired = true;
      }
    }
    if (expired) {
      try {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
        removed++;
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

export function ensureImportsRoot(dataDir: string): void {
  fs.mkdirSync(importsRoot(dataDir), { recursive: true });
}

export function startImportCleanupTimer(dataDir: string): NodeJS.Timeout {
  const timer = setInterval(
    () => {
      try {
        cleanupExpiredImports(dataDir);
      } catch {
        /* ignore */
      }
    },
    5 * 60 * 1000,
  );
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
