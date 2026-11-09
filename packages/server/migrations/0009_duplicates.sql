-- Duplicate detection (change duplicate-detection).
-- Body fingerprint of a version's main file (sha256 of the normalized body without frontmatter).
-- NULL until computed; the server backfills at startup for NULL.
ALTER TABLE artifact_versions ADD COLUMN body_sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_artifact_versions_body_sha256 ON artifact_versions(body_sha256);

-- Duplicate groups of the latest agent snapshot (JSON array).
ALTER TABLE agents ADD COLUMN duplicates TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(duplicates));
