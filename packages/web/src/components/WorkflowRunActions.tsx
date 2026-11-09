import { useState } from "react";
import type { WorkflowRun } from "../api/client.ts";
import { STR } from "../lib/strings.ts";
import { HelpTip } from "./HelpTip.tsx";

type Props = {
  run: WorkflowRun;
  onCancel: () => void;
  onReplay: () => void;
  onDecide: (decision: "approve" | "reject", reason: string) => void;
  onResume: () => void;
};

/** Actions on a run row (workflow gates): decide at a gate, resume a stopped run, cancel or replay. */
export function WorkflowRunActions({ run, onCancel, onReplay, onDecide, onResume }: Props) {
  const S = STR.flow.workflows;
  const [reason, setReason] = useState("");
  if (run.status === "waiting") {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <span translate="no" className="font-mono text-xs">
          {run.current_step}
        </span>
        <input
          data-testid={`wf-gate-reason-${run.id}`}
          className="rounded-sf border border-line bg-bg px-1 py-0.5 text-xs"
          placeholder={S.gateReason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <HelpTip action="workflow-gate">
          <button
            className="btn btn-xs"
            data-testid={`wf-approve-${run.id}`}
            onClick={() => onDecide("approve", reason)}
          >
            {S.approve}
          </button>
        </HelpTip>
        <button
          className="btn btn-xs"
          data-testid={`wf-reject-${run.id}`}
          onClick={() => onDecide("reject", reason)}
        >
          {S.reject}
        </button>
        <button className="btn btn-xs" onClick={onCancel}>
          {S.cancelRun}
        </button>
      </div>
    );
  }
  if (run.status === "queued" || run.status === "running") {
    return (
      <button className="btn btn-xs" onClick={onCancel}>
        {S.cancelRun}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {run.status === "failed" || run.status === "cancelled" ? (
        <HelpTip action="workflow-resume">
          <button className="btn btn-xs" data-testid={`wf-resume-${run.id}`} onClick={onResume}>
            {S.resume}
          </button>
        </HelpTip>
      ) : null}
      <HelpTip action="workflow-replay">
        <button className="btn btn-xs" data-testid={`wf-replay-${run.id}`} onClick={onReplay}>
          {S.replay}
        </button>
      </HelpTip>
    </div>
  );
}
