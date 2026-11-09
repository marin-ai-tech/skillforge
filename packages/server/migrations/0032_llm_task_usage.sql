-- llm-skill-validation: daily usage of background LLM tasks per purpose. Counters only, no text; apart from
-- llm_usage, so tasks never touch the daily limits of users.
CREATE TABLE llm_task_usage (
  purpose TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (purpose, day)
);
