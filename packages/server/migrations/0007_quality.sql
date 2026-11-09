-- Quality report (QualityReport JSON from @skillforge/core assessQuality) per version.
-- NULL until computed; the server backfills at startup for NULL or outdated algorithm.
ALTER TABLE artifact_versions ADD COLUMN quality TEXT CHECK (quality IS NULL OR json_valid(quality));
