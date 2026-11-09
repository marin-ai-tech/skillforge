CREATE TABLE user_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);