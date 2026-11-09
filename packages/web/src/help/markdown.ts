import { CALLOUT_KINDS, type CalloutKind } from "../components/Callout.tsx";

/** Minimal mdast shape this module touches (no dependency on @types/mdast). */
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, unknown> };
};

const MARKER = /^\[!([A-Za-z]+)\][ \t]*\r?\n?/;

/** The callout kind named by the `[!KIND]` marker at the start of `text`, with the marker's length. */
function markerOf(text: string): { kind: CalloutKind; length: number } | null {
  const m = MARKER.exec(text);
  const kind = m?.[1]?.toLowerCase() as CalloutKind | undefined;
  return m && kind && CALLOUT_KINDS.includes(kind) ? { kind, length: m[0].length } : null;
}

/** `> [!NOTE]` … (GitHub Alerts) → a blockquote tagged with `data-callout`, marker removed. */
function tagCallout(node: MdNode): void {
  const para = node.children?.[0];
  const inline = para?.type === "paragraph" ? (para.children ?? []) : [];
  const first = inline[0];
  if (first?.type !== "text" || typeof first.value !== "string") return;
  const marker = markerOf(first.value);
  if (!marker) return;
  first.value = first.value.slice(marker.length);
  if (first.value === "") inline.shift();
  if (inline.length === 0) node.children!.shift();
  node.data = {
    ...node.data,
    hProperties: { ...node.data?.hProperties, dataCallout: marker.kind },
  };
}

function walk(node: MdNode): void {
  if (node.type === "blockquote") tagCallout(node);
  for (const child of node.children ?? []) walk(child);
}

export function remarkCallouts() {
  return (tree: MdNode) => walk(tree);
}

/** Heading text → anchor id: lowercase words joined by `-`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Plain text of an inline markdown heading: code ticks, emphasis and link targets dropped. */
function plainHeading(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();
}

export type TocEntry = { id: string; text: string };

/** `## ` headings of a topic body (outside code fences), in order. */
export function tocOf(body: string): TocEntry[] {
  const out: TocEntry[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = plainHeading(m[1]!);
      out.push({ id: slugify(text), text });
    }
  }
  return out;
}
