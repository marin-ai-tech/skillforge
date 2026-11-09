export function register(ctx) {
  ctx.db.migrate([{ id: "0001", sql: "CREATE TABLE IF NOT EXISTS foo (id INTEGER PRIMARY KEY)" }]);
}
