-- artifact-agent-compat: the author's declaration of agents with a minimum version, [{runtime, min_version}].
-- The version keeps what was published; the artifact keeps the effective list (metadata override over the version).
ALTER TABLE artifact_versions ADD COLUMN agents TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(agents));
ALTER TABLE artifacts ADD COLUMN agents TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(agents));
