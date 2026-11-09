import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCompanyRubric, getTeamRubric, putCompanyRubric, putTeamRubric } from "../api/client.ts";
import type { QualityRubric } from "../api/types.ts";
import { STR } from "../lib/strings.ts";
import { errorText } from "../i18n/index.ts";
import { RubricEditor } from "./RubricEditor.tsx";

/** Company quality rules (quality-rubric), on the admin lifecycle page. */
export function CompanyRubricPanel() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["quality-rubric", "company"], queryFn: getCompanyRubric });
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: QualityRubric) => putCompanyRubric(next),
    onSuccess: (data) => {
      setMessage(STR.art.rubric.saved);
      queryClient.setQueryData(["quality-rubric", "company"], data);
    },
    onError: (e) => setMessage(errorText(e)),
  });
  if (!q.data) return null;
  return (
    <RubricEditor
      testId="company-rubric"
      title={STR.art.rubric.companyTitle}
      value={q.data.rubric}
      onSave={(next) => save.mutate(next)}
      saving={save.isPending}
      message={message}
    />
  );
}

/** Team quality rules: stricter than the company's only; for the team lead and admins. */
export function TeamRubricPanel({ team }: { team: string }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["quality-rubric", team], queryFn: () => getTeamRubric(team) });
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: QualityRubric) => putTeamRubric(team, next),
    onSuccess: async () => {
      setMessage(STR.art.rubric.saved);
      await queryClient.invalidateQueries({ queryKey: ["quality-rubric", team] });
    },
    onError: (e) => setMessage(errorText(e)),
  });
  if (!q.data) return null;
  return (
    <RubricEditor
      testId="team-rubric"
      title={STR.art.rubric.teamTitle}
      value={q.data.rubric}
      onSave={(next) => save.mutate(next)}
      saving={save.isPending}
      message={message}
    />
  );
}
