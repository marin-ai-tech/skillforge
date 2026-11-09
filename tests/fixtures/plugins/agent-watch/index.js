// Fixture plugin: records agent.scanned events and serves them to signed-in users at /events.
export function register(ctx) {
  const items = [];
  ctx.events.on("agent.scanned", (evt) => {
    items.push(evt);
  });
  ctx.routes.register((app) => {
    app.get("/events", async () => ({ items }));
  });
}
