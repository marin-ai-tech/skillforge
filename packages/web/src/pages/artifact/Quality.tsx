import { RubricResultView } from "../../components/RubricEditor.tsx";
import { useQuery } from "@tanstack/react-query";
import { getArtifactDuplicates } from "../../api/client.ts";
import type { ArtifactSummary, VersionDetail } from "../../api/types.ts";
import { QualityReportView } from "../../components/QualityReportView.tsx";
import { DuplicatesList } from "../../components/DuplicatesList.tsx";
import { SecurityScan } from "../../components/SecurityScan.tsx";
import { ContextCost } from "../../components/ContextCost.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { ErrorState } from "../../components/ErrorState.tsx";
import { STR } from "../../lib/strings.ts";

type Props = {
  artifact: ArtifactSummary;
  version: VersionDetail;
};

export function Quality({ artifact, version }: Props) {
  const dupsQ = useQuery({
    queryKey: ["artifact-duplicates", artifact.type, artifact.name],
    queryFn: () => getArtifactDuplicates(artifact.type, artifact.name),
    staleTime: 30_000,
  });

  if (!version.quality) {
    return (
      <div
        data-testid="quality-missing"
        className="rounded-sf border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted"
      >
        {STR.art.quality.missing}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SecurityScan report={version.quality.security} />
      <RubricResultView result={version.rubric} />
      <ContextCost cost={version.quality.context} />
      <QualityReportView quality={version.quality} />
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">{STR.art.quality.duplicates}</h2>
        {dupsQ.isError ? (
          <ErrorState onRetry={() => void dupsQ.refetch()} />
        ) : dupsQ.isLoading || !dupsQ.data ? (
          <Skeleton className="h-16" />
        ) : (
          <DuplicatesList items={dupsQ.data.items} testId="quality-duplicates" />
        )}
      </section>
    </div>
  );
}
