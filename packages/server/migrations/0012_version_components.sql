-- Plugin components column.
-- NULL for non-plugins. Migrates legacy frontmatter.__sf_components into the column
-- and removes the service key from frontmatter (empty object stays {}, not NULL).
ALTER TABLE artifact_versions ADD COLUMN components TEXT CHECK (components IS NULL OR json_valid(components));

UPDATE artifact_versions
SET components = json_extract(frontmatter, '$.__sf_components')
WHERE frontmatter IS NOT NULL
  AND json_valid(frontmatter)
  AND json_type(frontmatter, '$.__sf_components') = 'array';

UPDATE artifact_versions
SET frontmatter = json_remove(frontmatter, '$.__sf_components')
WHERE frontmatter IS NOT NULL
  AND json_valid(frontmatter)
  AND json_extract(frontmatter, '$.__sf_components') IS NOT NULL;
