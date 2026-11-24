-- security-gates: a reviewer's mark that the blocking security findings of one version are false positives. It stands
-- next to the quality report (the verdict stays `fail`); `findings` is a JSON list of {rule, file, line}, the blocking
-- findings the mark covers. A mark is current while it covers every blocking finding of the current report.
CREATE TABLE security_clearances (
  artifact_id TEXT NOT NULL,
  version TEXT NOT NULL,
  cleared_by TEXT NOT NULL,
  cleared_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  findings TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);
