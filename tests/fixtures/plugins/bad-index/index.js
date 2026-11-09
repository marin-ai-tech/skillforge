// Plugin fixture: a table with a correct prefix, but a unique index without it.
export function register(ctx) {
  ctx.db.migrate([
    {
      id: "0001",
      sql: "CREATE TABLE IF NOT EXISTS ext_bad_index_t (id INTEGER PRIMARY KEY, k TEXT); CREATE UNIQUE INDEX IF NOT EXISTS foo_unique ON ext_bad_index_t (k);",
    },
  ]);
}
