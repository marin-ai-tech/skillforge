-- session-preloaded-skills: how a skill got into the session: called (invoked) or preloaded to a subagent through `skills:`.
ALTER TABLE session_facts ADD COLUMN basis TEXT NOT NULL DEFAULT 'invoked' CHECK (basis IN ('invoked', 'preloaded'));
