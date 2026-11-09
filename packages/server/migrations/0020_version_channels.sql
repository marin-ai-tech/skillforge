-- version-channels-pinning: release channel per version; latest_version = max stable, else max of all.
ALTER TABLE artifact_versions
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta'));

-- semver pre-release: a '-' in the version before any '+' build metadata.
UPDATE artifact_versions
SET channel = 'beta'
WHERE instr(version, '-') > 0
  AND (instr(version, '+') = 0 OR instr(version, '-') < instr(version, '+'));

-- Stable versions have no pre-release part, so numeric major.minor.patch order is semver order.
-- Artifacts without any stable version keep latest_version (already the max over all versions).
WITH core AS (
  SELECT artifact_id, version,
    CASE WHEN instr(version, '+') > 0 THEN substr(version, 1, instr(version, '+') - 1) ELSE version END AS c
  FROM artifact_versions
  WHERE channel = 'stable'
),
split1 AS (
  SELECT artifact_id, version,
    CAST(substr(c, 1, instr(c, '.') - 1) AS INTEGER) AS major,
    substr(c, instr(c, '.') + 1) AS rest
  FROM core
),
split2 AS (
  SELECT artifact_id, version, major,
    CAST(substr(rest, 1, instr(rest, '.') - 1) AS INTEGER) AS minor,
    CAST(substr(rest, instr(rest, '.') + 1) AS INTEGER) AS patch
  FROM split1
)
UPDATE artifacts
SET latest_version = (
  SELECT version FROM split2
  WHERE split2.artifact_id = artifacts.id
  ORDER BY major DESC, minor DESC, patch DESC, version DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM artifact_versions v WHERE v.artifact_id = artifacts.id AND v.channel = 'stable'
);
