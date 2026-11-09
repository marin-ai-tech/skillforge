-- artifact-replacement: the successor of an outdated artifact (type/name).
ALTER TABLE artifacts ADD COLUMN replaced_by TEXT;
