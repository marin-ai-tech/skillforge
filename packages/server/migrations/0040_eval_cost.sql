-- cost-per-solve: tokens, cost and model of each eval task; case_kind tells task results from trigger results.
ALTER TABLE eval_results ADD COLUMN case_kind TEXT;
ALTER TABLE eval_results ADD COLUMN input_tokens INTEGER;
ALTER TABLE eval_results ADD COLUMN output_tokens INTEGER;
ALTER TABLE eval_results ADD COLUMN cost_usd REAL;
ALTER TABLE eval_results ADD COLUMN model TEXT;
