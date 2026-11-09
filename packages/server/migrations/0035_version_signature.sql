-- release-signing: the registry's signature of each version's exact files (JSON: alg, key_id, sig).
ALTER TABLE artifact_versions ADD COLUMN signature TEXT;
