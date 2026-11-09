ALTER TABLE artifacts ADD COLUMN meta_override TEXT CHECK (meta_override IS NULL OR json_valid(meta_override));
ALTER TABLE artifacts ADD COLUMN purged_at TEXT;
ALTER TABLE artifacts ADD COLUMN purged_by TEXT;
ALTER TABLE artifact_versions ADD COLUMN purged_at TEXT;
ALTER TABLE artifact_versions ADD COLUMN purged_by TEXT;
