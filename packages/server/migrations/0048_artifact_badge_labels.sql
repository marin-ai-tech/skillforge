-- The label of a badge per interface language (JSON object, e.g. {"de": "..."}).
ALTER TABLE artifact_badges ADD COLUMN labels TEXT CHECK (labels IS NULL OR json_valid(labels));
