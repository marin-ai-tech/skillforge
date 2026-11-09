import { useEffect } from "react";
import { useParams } from "react-router";
import { PageHeader } from "../components/PageHeader.tsx";
import { STR } from "../lib/strings.ts";

type Props = { name?: string };

export function NotFound({ name }: Props) {
  const params = useParams();
  const missing = name ?? params.name ?? "";

  useEffect(() => {
    document.title = STR.notFound.title + STR.ui.titleSuffix;
  }, []);

  return (
    <div
      data-testid="not-found"
      className="rounded-sf border border-line bg-surface p-8 text-center"
    >
      <PageHeader title={STR.notFound.title} topic="pages/not-found" />
      <p className="mt-2 text-sm text-muted">
        {missing ? (
          <>
            {STR.ui.notFound.artifactBefore}
            <span translate="no">{missing}</span>
            {STR.ui.notFound.artifactAfter}
          </>
        ) : (
          STR.notFound.body
        )}
      </p>
    </div>
  );
}
