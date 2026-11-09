-- pr-rollout: rollouts through pull requests; the request and the result per repository (no token).
CREATE TABLE rollouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request TEXT NOT NULL CHECK (json_valid(request)),
  results TEXT CHECK (results IS NULL OR json_valid(results))
);
