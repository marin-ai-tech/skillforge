
-- artifact ownership: owner column + maintainers table.
-- Added without rebuilding artifacts (existing FK constraints stay valid on SQLite 3.35+).

ALTER TABLE artifacts ADD COLUMN owner TEXT NOT NULL DEFAULT '';

CREATE TABLE artifact_maintainers (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  username TEXT NOT NULL COLLATE NOCASE,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, username)
);

CREATE INDEX idx_artifact_maintainers_artifact ON artifact_maintainers(artifact_id);

-- Backfill owner = canonical users.username matching created_by (case-insensitive).
UPDATE artifacts
SET owner = (
  SELECT u.username
  FROM users u
  WHERE u.username = artifacts.created_by COLLATE NOCASE
  LIMIT 1
)
WHERE owner = ''
  AND EXISTS (
    SELECT 1 FROM users u WHERE u.username = artifacts.created_by COLLATE NOCASE
  );

-- Orphans (no matching user) become owned by the first admin by created_at,
-- with an owner_transfer audit event for each.
UPDATE artifacts
SET owner = (
  SELECT username
  FROM users
  WHERE role = 'admin' AND disabled = 0
  ORDER BY created_at ASC, username ASC
  LIMIT 1
)
WHERE owner = '';

INSERT INTO audit_events (ts, actor, artifact_id, version, action, reason, meta)
SELECT
  artifacts.updated_at,
  (SELECT username FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at ASC, username ASC LIMIT 1),
  artifacts.id,
  NULL,
  'owner_transfer',
  'migration 0011: orphan (created_by=' || artifacts.created_by || ')',
  json_object(
    'from', artifacts.created_by,
    'to', (SELECT username FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at ASC, username ASC LIMIT 1)
  )
FROM artifacts
WHERE owner <> ''
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.username = artifacts.created_by COLLATE NOCASE
  );
