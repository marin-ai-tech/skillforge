-- workflow gates: where a run continues (gate decision, resume) and the last step it ran; who decided a gate and why.
ALTER TABLE workflow_runs ADD COLUMN resume_from TEXT;
ALTER TABLE workflow_runs ADD COLUMN current_step TEXT;
ALTER TABLE workflow_run_steps ADD COLUMN decided_by TEXT;
ALTER TABLE workflow_run_steps ADD COLUMN reason TEXT;
