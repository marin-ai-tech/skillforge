-- skill-harvest: recurring rules found in pull request reviews, with links to the comments.
CREATE TABLE harvests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request TEXT NOT NULL CHECK (json_valid(request)),
  rules TEXT NOT NULL CHECK (json_valid(rules))
);
