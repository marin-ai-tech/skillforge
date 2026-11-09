-- llm-help-assistant: LLM access settings (one row, JSON edited by admin; the API key is never stored here)
CREATE TABLE llm_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- Daily usage per user: counters only, no message text.
CREATE TABLE llm_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX idx_llm_usage_day ON llm_usage (day);
