import { useMemo, useState, type ReactNode } from "react";
import { formatBytes } from "../lib/format.ts";
import { HelpTip } from "./HelpTip.tsx";

export type FileTreeEntry = {
  path: string;
  size: number;
};

type DirNode = {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: FileTreeEntry[];
};

function buildTree(entries: FileTreeEntry[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      const dirPath = parts.slice(0, i + 1).join("/");
      let child = node.dirs.get(name);
      if (!child) {
        child = { name, path: dirPath, dirs: new Map(), files: [] };
        node.dirs.set(name, child);
      }
      node = child;
    }
    node.files.push(entry);
  }
  return root;
}

type Props = {
  entries: FileTreeEntry[];
  selected?: string;
  onSelect?: (path: string) => void;
  testIdPrefix?: { dir: string; file: string };
  treeTestId?: string;
  renderEntry?: (entry: FileTreeEntry, selected: boolean) => ReactNode;
};

function DirView({
  node,
  selected,
  onSelect,
  testIdPrefix,
  renderEntry,
  depth,
}: {
  node: DirNode;
  selected?: string;
  onSelect?: (path: string) => void;
  testIdPrefix: { dir: string; file: string };
  renderEntry?: Props["renderEntry"];
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <li>
      {node.path ? (
        <HelpTip family="file-dir">
          <button
            type="button"
            data-testid={testIdPrefix.dir}
            data-path={node.path}
            className="flex w-full items-center gap-1 rounded-sf px-2 py-1 text-left text-sm text-ink-2 hover:bg-surface-2"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="text-muted" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
            <span translate="no" className="font-medium">
              {node.name}
            </span>
          </button>
        </HelpTip>
      ) : null}
      {open ? (
        <ul className="list-none p-0 m-0">
          {dirs.map((d) => (
            <DirView
              key={d.path}
              node={d}
              selected={selected}
              onSelect={onSelect}
              testIdPrefix={testIdPrefix}
              renderEntry={renderEntry}
              depth={node.path ? depth + 1 : depth}
            />
          ))}
          {files.map((f) => {
            const base = f.path.split("/").pop() || f.path;
            const isSel = selected === f.path;
            if (renderEntry) {
              return <li key={f.path}>{renderEntry(f, isSel)}</li>;
            }
            return (
              <li key={f.path}>
                <HelpTip family="file-entry">
                  <button
                    type="button"
                    data-testid={testIdPrefix.file}
                    data-path={f.path}
                    className={`flex w-full items-center justify-between gap-2 rounded-sf px-2 py-1.5 text-left hover:bg-surface-2 ${isSel ? "bg-accent-soft text-ink" : "text-ink-2"}`}
                    style={{ paddingLeft: `${8 + (node.path ? depth + 1 : depth) * 12}px` }}
                    onClick={() => onSelect?.(f.path)}
                  >
                    <span translate="no" className="truncate font-mono text-[12px]">
                      {base}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{formatBytes(f.size)}</span>
                  </button>
                </HelpTip>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function FileTree({
  entries,
  selected,
  onSelect,
  testIdPrefix = { dir: "file-dir", file: "file-entry" },
  treeTestId = "files-tree",
  renderEntry,
}: Props) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  return (
    <ul
      data-testid={treeTestId}
      className="rounded-sf border border-line bg-surface p-2 text-sm list-none m-0"
    >
      <DirView
        node={tree}
        selected={selected}
        onSelect={onSelect}
        testIdPrefix={testIdPrefix}
        renderEntry={renderEntry}
        depth={0}
      />
    </ul>
  );
}
