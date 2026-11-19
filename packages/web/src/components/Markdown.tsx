import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripFrontmatter } from "../lib/markdown.ts";
import { remarkCallouts, slugify } from "../help/markdown.ts";
import { Callout, type CalloutKind } from "./Callout.tsx";

/**
 * `help`: GitHub-alert callouts and anchor ids on `##` headings (help topics). `headingOffset`: shifts the levels of
 * the source's headings down (2: `#` renders as h3), so a body nested under page headings does not outrank them; the
 * visual size stays that of the source level. Default 0 — the levels as written.
 */
type Props = { source: string; className?: string; help?: boolean; headingOffset?: number };

type Level = 1 | 2 | 3 | 4 | 5 | 6;
const HEADING_CLASS: Record<Level, string> = {
  1: "text-xl font-semibold text-ink",
  2: "text-lg font-semibold text-ink",
  3: "text-base font-semibold text-ink",
  4: "text-sm font-semibold text-ink",
  5: "text-sm font-semibold text-ink",
  6: "text-sm font-semibold text-ink",
};

/** A source heading of level `level` rendered `offset` levels lower (at most h6), with the source level's look. */
function Shifted({
  level,
  offset,
  children,
}: {
  level: Level;
  offset: number;
  children?: ReactNode;
}) {
  const Tag = `h${Math.min(6, level + offset)}` as "h1";
  return <Tag className={HEADING_CLASS[level]}>{children}</Tag>;
}

function shiftedHeadings(offset: number) {
  const levels: Level[] = [1, 2, 3, 4, 5, 6];
  return Object.fromEntries(
    levels.map((level) => [
      `h${level}`,
      ({ children }: { children?: ReactNode }) => (
        <Shifted level={level} offset={offset}>
          {children}
        </Shifted>
      ),
    ]),
  );
}

type HastNode = {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

export function Markdown({ source, className = "", help = false, headingOffset = 0 }: Props) {
  const body = stripFrontmatter(source);
  return (
    <div className={`prose-sf space-y-3 text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={help ? [remarkGfm, remarkCallouts] : [remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} className="text-accent underline">
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-xl font-semibold text-ink">{children}</h1>,
          h2: ({ children, node }) => (
            <h2
              id={help ? slugify(textOf(node as HastNode)) : undefined}
              className={`text-lg font-semibold text-ink ${help ? "sf-anchor pt-2" : ""}`}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => <h3 className="text-base font-semibold text-ink">{children}</h3>,
          blockquote: ({ children, node }) => {
            const kind = (node as HastNode | undefined)?.properties?.dataCallout;
            if (typeof kind === "string")
              return <Callout kind={kind as CalloutKind}>{children}</Callout>;
            return <blockquote>{children}</blockquote>;
          },
          // One scrolling pre per code block: the outer pre of react-markdown used to wrap a second pre and
          // widen the page on a phone.
          pre: ({ children }) => (
            <pre className="max-w-full overflow-x-auto rounded-sf border border-line bg-surface-2 p-3 font-mono text-[13px]">
              {children}
            </pre>
          ),
          code: ({ className: cn, children }) => {
            if (cn) return <code className={cn}>{children}</code>;
            return (
              <code className="rounded bg-surface-2 px-1 font-mono text-[13px] [overflow-wrap:anywhere]">
                {children}
              </code>
            );
          },
          // A wide table scrolls inside its own box instead of widening the page.
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          p: ({ children }) => <p className="text-ink-2">{children}</p>,
          ...(headingOffset > 0 ? shiftedHeadings(headingOffset) : {}),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
