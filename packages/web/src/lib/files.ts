/** Client-side file collection and base64 encoding. Limits mirror core LIMITS. */
export const CLIENT_LIMITS = {
  maxFileBytes: 16 * 1024 * 1024,
  maxBundleBytes: 32 * 1024 * 1024,
  chunkBytes: 32 * 1024,
} as const;

export type LocalFile = {
  path: string;
  file: File;
  size: number;
};

export type EncodeIssue = {
  code: "E_FILE_TOO_LARGE" | "E_BUNDLE_TOO_LARGE";
  message: string;
  path?: string;
};

export type EncodedFile = { path: string; content_base64: string };

function shouldSkipPath(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.some((p) => p === "node_modules" || p === ".git");
}

function stripLeadingSlash(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file: (ok: (f: File) => void, err?: (e: Error) => void) => void;
  createReader: () => {
    readEntries: (ok: (entries: FileSystemEntryLike[]) => void, err?: (e: Error) => void) => void;
  };
};

async function readAllEntries(
  reader: ReturnType<FileSystemEntryLike["createReader"]>,
): Promise<FileSystemEntryLike[]> {
  const out: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    out.push(...batch);
  }
  return out;
}

async function walkEntry(
  entry: FileSystemEntryLike,
  rootFullPath: string,
  out: LocalFile[],
): Promise<void> {
  const rel = stripLeadingSlash(entry.fullPath.slice(rootFullPath.length));
  const path = rel || entry.name;
  if (shouldSkipPath(path)) return;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    out.push({ path, file, size: file.size });
    return;
  }
  if (entry.isDirectory) {
    const children = await readAllEntries(entry.createReader());
    for (const child of children) {
      await walkEntry(child, rootFullPath, out);
    }
  }
}

export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<LocalFile[]> {
  const items = dataTransfer.items;
  const out: LocalFile[] = [];
  if (items && items.length > 0) {
    const entries: FileSystemEntryLike[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const getAsEntry = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntryLike | null;
        }
      ).webkitGetAsEntry;
      const entry = getAsEntry?.call(item) ?? null;
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      for (const entry of entries) {
        // Root = parent of dropped folder so the folder name stays in paths.
        const root = entry.isDirectory
          ? entry.fullPath.replace(/\/[^/]+\/?$/, "") || ""
          : entry.fullPath.replace(/\/[^/]+$/, "") || "";
        await walkEntry(entry, root, out);
      }
      return out;
    }
  }
  // Fallback: flat file list
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i]!;
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (shouldSkipPath(path)) continue;
    out.push({ path: stripLeadingSlash(path), file, size: file.size });
  }
  return out;
}

export function filesFromInput(fileList: FileList | null): LocalFile[] {
  if (!fileList) return [];
  const out: LocalFile[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]!;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = stripLeadingSlash(rel && rel.length > 0 ? rel : file.name);
    if (shouldSkipPath(path)) continue;
    out.push({ path, file, size: file.size });
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = CLIENT_LIMITS.chunkBytes;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function encodeFiles(
  files: LocalFile[],
): Promise<{ ok: true; files: EncodedFile[] } | { ok: false; issues: EncodeIssue[] }> {
  const issues: EncodeIssue[] = [];
  let total = 0;
  for (const f of files) {
    if (f.size > CLIENT_LIMITS.maxFileBytes) {
      issues.push({
        code: "E_FILE_TOO_LARGE",
        message: `File exceeds 16 MiB: ${f.path}`,
        path: f.path,
      });
    }
    total += f.size;
  }
  if (total > CLIENT_LIMITS.maxBundleBytes) {
    issues.push({
      code: "E_BUNDLE_TOO_LARGE",
      message: "Bundle exceeds 32 MiB",
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const encoded: EncodedFile[] = [];
  for (const f of files) {
    const buf = new Uint8Array(await f.file.arrayBuffer());
    encoded.push({ path: f.path, content_base64: bytesToBase64(buf) });
  }
  return { ok: true, files: encoded };
}

export function localFileFromText(path: string, text: string): LocalFile {
  const file = new File([text], path.split("/").pop() || path, { type: "text/markdown" });
  return { path, file, size: file.size };
}
