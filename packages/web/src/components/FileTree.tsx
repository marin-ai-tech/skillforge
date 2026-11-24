import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatBytes } from "../lib/format.ts";
import { STR } from "../lib/strings.ts";
import { HelpTip } from "./HelpTip.tsx";

export type FileTreeEntry = {
  path: string;
  size: number;
};

type DirNode = {
  name: string;
  path: string;
  /** Index of the folder in this tree: a safe part of an element id (paths may hold spaces). */
  idx: number;
  dirs: DirNode[];
  files: FileTreeEntry[];
};

/** Up to this many files the tree opens fully, as it always did (file-tree-large). */
export const SMALL_TREE = 100;
/** At most this many file rows while filtering. */
export const MAX_MATCHES = 500;
const FILTER_DELAY_MS = 200;

/** Nested folders from canonical paths, children sorted once, folders numbered. */
function buildTree(entries: FileTreeEntry[]): DirNode {
  type Mut = { name: string; path: string; dirs: Map<string, Mut>; files: FileTreeEntry[] };
  const root: Mut = { name: "", path: "", dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!;
      let child = node.dirs.get(name);
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join("/"), dirs: new Map(), files: [] };
        node.dirs.set(name, child);
      }
      node = child;
    }
    node.files.push(entry);
  }
  let next = 0;
  const freeze = (n: Mut): DirNode => ({
    name: n.name,
    path: n.path,
    idx: next++,
    dirs: [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(freeze),
    files: [...n.files].sort((a, b) => a.path.localeCompare(b.path)),
  });
  return freeze(root);
}

function allDirs(node: DirNode, out: Set<string> = new Set()): Set<string> {
  for (const d of node.dirs) {
    out.add(d.path);
    allDirs(d, out);
  }
  return out;
}

/** Folders from the root down while a folder holds a single folder and no files, plus that last folder. */
function rootChain(root: DirNode): string[] {
  const chain: string[] = [];
  let node = root;
  while (node.dirs.length === 1 && node.files.length === 0) {
    node = node.dirs[0]!;
    chain.push(node.path);
  }
  return chain;
}

function ancestors(path: string | undefined): string[] {
  if (!path) return [];
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

function initialOpen(root: DirNode, count: number, selected: string | undefined): Set<string> {
  if (count <= SMALL_TREE) return allDirs(root);
  return new Set([...rootChain(root), ...ancestors(selected)]);
}

/** The nearest ancestor that scrolls by itself (the tree column), never the page. */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function revealInBox(row: HTMLElement): void {
  const box = scrollBox(row);
  if (!box) return;
  const r = row.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}

type ViewCtx = {
  selected?: string;
  onSelect?: (path: string) => void;
  /** While filtering, folders are labels: all open, nothing to toggle. */
  filtering: boolean;
  open: Set<string>;
  toggle: (path: string) => void;
  idBase: string;
};

const FileRow = memo(function FileRow({
  f,
  depth,
  ctx,
}: {
  f: FileTreeEntry;
  depth: number;
  ctx: ViewCtx;
}) {
  const base = f.path.split("/").pop() || f.path;
  const isSel = ctx.selected === f.path;
  return (
    <li>
      <HelpTip family="file-entry">
        <button
          type="button"
          data-testid="file-entry"
          data-path={f.path}
          aria-current={isSel ? "true" : undefined}
          className={`flex w-full items-center justify-between gap-2 rounded-sf border-l-2 px-2 py-1.5 text-left hover:bg-surface-2 ${isSel ? "border-accent bg-accent-soft text-ink" : "border-transparent text-ink-2"}`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => ctx.onSelect?.(f.path)}
        >
          <span translate="no" className="truncate font-mono text-[12px]">
            {base}
          </span>
          <span className="shrink-0 text-xs text-muted">{formatBytes(f.size)}</span>
        </button>
      </HelpTip>
    </li>
  );
});

function DirLabel({
  node,
  depth,
  ctx,
  open,
  listId,
}: {
  node: DirNode;
  depth: number;
  ctx: ViewCtx;
  open: boolean;
  listId: string;
}) {
  const name = (
    <span translate="no" className="font-medium">
      {node.name}
    </span>
  );
  const style = { paddingLeft: `${8 + depth * 12}px` };
  if (ctx.filtering) {
    return (
      <div
        data-testid="file-dir"
        data-path={node.path}
        className="flex items-center gap-1 px-2 py-1 text-sm text-ink-2"
        style={style}
      >
        {name}
      </div>
    );
  }
  return (
    <HelpTip family="file-dir">
      <button
        type="button"
        data-testid="file-dir"
        data-path={node.path}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center gap-1 rounded-sf px-2 py-1 text-left text-sm text-ink-2 hover:bg-surface-2"
        style={style}
        onClick={() => ctx.toggle(node.path)}
      >
        <span className="text-muted" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        {name}
      </button>
    </HelpTip>
  );
}

const DirView = memo(function DirView({
  node,
  depth,
  ctx,
}: {
  node: DirNode;
  depth: number;
  ctx: ViewCtx;
}) {
  const open = !node.path || ctx.filtering || ctx.open.has(node.path);
  const listId = `${ctx.idBase}-d${node.idx}`;
  const childDepth = node.path ? depth + 1 : depth;
  return (
    <li>
      {node.path ? (
        <DirLabel node={node} depth={depth} ctx={ctx} open={open} listId={listId} />
      ) : null}
      {open ? (
        <ul id={listId} className="m-0 list-none p-0">
          {node.dirs.map((d) => (
            <DirView key={d.path} node={d} depth={childDepth} ctx={ctx} />
          ))}
          {node.files.map((f) => (
            <FileRow key={f.path} f={f} depth={childDepth} ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

/** The filter field keeps its own state, so typing does not redraw the tree before the delay. */
function FilterField({ id, onChange }: { id: string; onChange: (q: string) => void }) {
  const S = STR.art.files;
  const [value, setValue] = useState("");
  useEffect(() => {
    if (value.trim() === "") {
      onChange("");
      return;
    }
    const t = setTimeout(() => onChange(value.trim()), FILTER_DELAY_MS);
    return () => clearTimeout(t);
  }, [value, onChange]);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block px-1 text-xs font-medium text-ink-2">
        {S.filterLabel}
      </label>
      <input
        id={id}
        type="search"
        data-testid="files-filter"
        value={value}
        placeholder={S.filterPlaceholder}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-sf border border-field-line bg-surface px-2 py-1 text-sm"
      />
    </div>
  );
}

function TreeTools({
  count,
  dirs,
  onExpand,
  onCollapse,
}: {
  count: number;
  dirs: number;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const S = STR.art.files;
  const btn = "min-h-6 rounded-sf px-2 text-xs text-ink-2 underline-offset-2 hover:underline";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <span className="text-xs text-muted">{S.summary(count, dirs)}</span>
      <span className="flex gap-2">
        <button type="button" data-testid="files-expand-all" className={btn} onClick={onExpand}>
          {S.expandAll}
        </button>
        <button type="button" data-testid="files-collapse-all" className={btn} onClick={onCollapse}>
          {S.collapseAll}
        </button>
      </span>
    </div>
  );
}

function useOpenDirs(tree: DirNode, count: number, selected: string | undefined) {
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(tree, count, selected));
  useEffect(() => {
    const need = ancestors(selected);
    setOpen((cur) => (need.every((p) => cur.has(p)) ? cur : new Set([...cur, ...need])));
  }, [selected]);
  const toggle = useCallback(
    (p: string) =>
      setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(p)) next.delete(p);
        else next.add(p);
        return next;
      }),
    [],
  );
  const expandAll = () => setOpen(allDirs(tree));
  const collapseAll = () => setOpen(new Set([...rootChain(tree), ...ancestors(selected)]));
  return { open, toggle, expandAll, collapseAll };
}

type Props = {
  entries: FileTreeEntry[];
  selected?: string;
  onSelect?: (path: string) => void;
  treeTestId?: string;
};

/**
 * The file tree of a version (file-tree-large). Up to SMALL_TREE files it opens fully; a larger tree opens the root
 * chain and the path to the selected file. A filter shows matching files (at most MAX_MATCHES rows) with their folders
 * open, without touching what the person opened.
 */
export function FileTree({ entries, selected, onSelect, treeTestId = "files-tree" }: Props) {
  const S = STR.art.files;
  const tree = useMemo(() => buildTree(entries), [entries]);
  const dirCount = useMemo(() => allDirs(tree).size, [tree]);
  const { open, toggle, expandAll, collapseAll } = useOpenDirs(tree, entries.length, selected);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return q ? entries.filter((e) => e.path.toLowerCase().includes(q)) : null;
  }, [entries, query]);
  const shownTree = useMemo(
    () => (matches ? buildTree(matches.slice(0, MAX_MATCHES)) : tree),
    [matches, tree],
  );
  const idBase = useId();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row) revealInBox(row);
  }, [selected, open]);

  const ctx = useMemo<ViewCtx>(
    () => ({ selected, onSelect, filtering: matches !== null, open, toggle, idBase }),
    [selected, onSelect, matches, open, toggle, idBase],
  );
  const countText = matches
    ? matches.length > MAX_MATCHES
      ? S.matchesCapped(matches.length, MAX_MATCHES)
      : S.matches(matches.length)
    : "";
  return (
    <div className="space-y-2">
      <FilterField id={`${idBase}-filter`} onChange={setQuery} />
      <p
        data-testid="files-filter-count"
        role="status"
        aria-live="polite"
        className="px-1 text-xs text-muted empty:hidden"
      >
        {countText}
      </p>
      {!matches && entries.length > SMALL_TREE ? (
        <TreeTools
          count={entries.length}
          dirs={dirCount}
          onExpand={expandAll}
          onCollapse={collapseAll}
        />
      ) : null}
      {matches && matches.length === 0 ? (
        <p data-testid="files-filter-empty" className="px-1 text-sm text-ink-2">
          {S.noMatches(query)}
        </p>
      ) : (
        <ul
          ref={listRef}
          data-testid={treeTestId}
          className="m-0 list-none rounded-sf border border-line bg-surface p-2 text-sm"
        >
          <DirView node={shownTree} depth={0} ctx={ctx} />
        </ul>
      )}
    </div>
  );
}
