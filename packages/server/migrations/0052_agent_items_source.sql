-- agent-source-marker: the registry artifact a scanned file was built from (front matter skillforge-source), JSON or NULL
ALTER TABLE agent_items ADD COLUMN source TEXT;
