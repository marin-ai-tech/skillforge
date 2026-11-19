-- fix-notification-prefs-source: the kinds of notification preferences are checked at the boundary (the route's
-- list), not by a CHECK that repeats that list: `source` was added to the route and the panel but not here, so it
-- could not be switched off. SQLite cannot change a CHECK in place: the table is rebuilt with its rows.
CREATE TABLE notification_prefs_v2 (
  username TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (username, kind)
);
INSERT INTO notification_prefs_v2 (username, kind, enabled)
  SELECT username, kind, enabled FROM notification_prefs;
DROP TABLE notification_prefs;
ALTER TABLE notification_prefs_v2 RENAME TO notification_prefs;
