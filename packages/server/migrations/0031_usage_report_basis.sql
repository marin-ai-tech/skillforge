-- usage-report-basis: what a usage report rests on; NULL for reports that do not say (all older ones).
-- An `assigned` report does not touch the version counters.
ALTER TABLE artifact_usage_reports ADD COLUMN basis TEXT CHECK (basis IN ('loaded', 'assigned'));
