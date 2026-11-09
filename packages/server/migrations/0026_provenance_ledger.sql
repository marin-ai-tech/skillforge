-- Provenance ledger.
-- Append-only history of what produced or informed an artifact version:
-- publish/import, eval and workflow run completion, explicit derive links.
-- Immutability is enforced by triggers; only the purge eraser may bypass
-- pl_no_delete (drop → delete → recreate, inside its own transaction).
CREATE TABLE provenance_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version TEXT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  ref TEXT,
  transform TEXT,
  parent_artifact_id TEXT,
  parent_version TEXT,
  actor TEXT,
  ts TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta))
);
CREATE INDEX idx_provenance_ledger_artifact ON provenance_ledger (artifact_id, id);

CREATE TRIGGER pl_no_update BEFORE UPDATE ON provenance_ledger
BEGIN
  SELECT RAISE(ABORT, 'provenance_ledger is append-only');
END;
CREATE TRIGGER pl_no_delete BEFORE DELETE ON provenance_ledger
BEGIN
  SELECT RAISE(ABORT, 'provenance_ledger is append-only');
END;
