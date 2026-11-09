import { useEffect } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getPluginPage } from "../api/client.ts";
import { ApiError } from "../api/client.ts";
import { STR } from "../lib/strings.ts";

export function ExtPage() {
  const { plugin = "", page = "" } = useParams<{ plugin: string; page: string }>();
  const q = useQuery({
    queryKey: ["plugin-page", plugin, page],
    queryFn: () => getPluginPage(plugin, page),
    retry: false,
  });

  useEffect(() => {
    if (q.data?.title) {
      document.title = q.data.title + STR.ui.titleSuffix;
    } else {
      document.title = STR.ui.ext.pageTitle + STR.ui.titleSuffix;
    }
  }, [q.data?.title]);

  if (q.isError) {
    const err = q.error;
    const missing = err instanceof ApiError && (err.status === 404 || err.error === "not_found");
    if (missing) {
      return (
        <div
          data-testid="ext-page-missing"
          className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
        >
          {STR.ui.ext.missing}
        </div>
      );
    }
    return (
      <div className="rounded-sf bg-danger-bg px-2 py-1.5 text-sm text-danger">
        {STR.ui.ext.failed}
      </div>
    );
  }

  if (q.isLoading || !q.data) {
    return <p className="text-sm text-muted">{STR.common.loading}</p>;
  }

  return (
    <article data-testid="ext-page" className="space-y-3">
      <h1 data-testid="ext-page-title" translate="no" className="text-xl font-semibold text-ink">
        {q.data.title}
      </h1>
      <div translate="no" className="prose-sf space-y-3 text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {q.data.markdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}
