import type { NewsItem } from "../api/types.ts";

/**
 * Where «Earlier — already seen» stands: the index of the last item newer than the reader's previous seen mark, or
 * null. `items` come newest first, as the server sends them, without the pinned posts. Times are compared as
 * instants (`Date.parse`), so marks and items written in different forms still compare right. No boundary without a
 * previous mark, when nothing older than the mark is loaded, or when the newer items are only the reader's own actions.
 */
export function seenBoundaryIndex(
  items: ReadonlyArray<Pick<NewsItem, "at" | "actor">>,
  previous: string | null,
  me: string,
): number | null {
  if (previous === null) return null;
  const mark = Date.parse(previous);
  if (!Number.isFinite(mark)) return null;
  let last = -1;
  items.forEach((item, i) => {
    if (Date.parse(item.at) > mark) last = i;
  });
  if (last < 0 || last === items.length - 1) return null;
  const othersNewer = items.slice(0, last + 1).some((item) => item.actor !== me);
  return othersNewer ? last : null;
}
