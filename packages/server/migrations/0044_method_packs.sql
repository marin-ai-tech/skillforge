-- method-packs: team method packs; each version is an immutable manifest of roles with pinned artifact versions.
CREATE TABLE method_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE method_pack_versions (
  pack_id INTEGER NOT NULL REFERENCES method_packs(id),
  version TEXT NOT NULL,
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (pack_id, version)
);
