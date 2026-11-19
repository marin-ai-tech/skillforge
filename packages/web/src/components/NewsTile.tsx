import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { listNews } from "../api/client.ts";
import { NewsEntry, NewsError } from "./NewsEntry.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { HelpTip } from "./HelpTip.tsx";
import { STR } from "../lib/strings.ts";

/** What's new on Home: pinned posts and up to 5 latest items; its error stays inside the tile. */
export function NewsTile() {
  const q = useQuery({
    queryKey: ["news", "tile"],
    queryFn: () => listNews({ limit: 5 }),
    staleTime: 30_000,
    retry: false,
  });
  const pinned = q.data?.pinned ?? [];
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const latest = (q.data?.items ?? []).filter((i) => !pinnedIds.has(i.id)).slice(0, 5);
  const empty = pinned.length === 0 && latest.length === 0;
  let body;
  if (q.isError)
    body = <NewsError message={STR.news.loadFailed} onRetry={() => void q.refetch()} />;
  else if (q.isPending) body = <Skeleton className="h-24" />;
  else if (empty) body = <p className="text-sm text-muted">{STR.news.empty}</p>;
  else
    body = (
      <ul className="space-y-2">
        {[...pinned, ...latest].map((item) => (
          <NewsEntry key={item.id} item={item} compact testId="home-news-item" />
        ))}
      </ul>
    );
  return (
    <section data-testid="home-news" aria-labelledby="home-news-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="home-news-h" className="text-sm font-medium uppercase tracking-wide text-muted">
          {STR.news.tile.title}
        </h2>
        <HelpTip action="home-news">
          <Link
            to="/news"
            className="inline-flex min-h-6 items-center text-sm text-accent underline"
          >
            {STR.news.tile.all}
          </Link>
        </HelpTip>
      </div>
      {body}
    </section>
  );
}
