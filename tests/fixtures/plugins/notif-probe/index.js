// Fixture plugin: records comment.created / notification.created events
// and can call ctx.notifications.send. The plugin API contract is defined by this fixture, not by prose.
export function register(ctx) {
  const items = [];
  ctx.events.on("comment.created", (evt) => {
    items.push(evt);
  });
  ctx.events.on("notification.created", (evt) => {
    items.push(evt);
  });
  ctx.routes.register((app) => {
    app.get("/events", async () => ({ items }));
    app.post("/send", async (request, reply) => {
      try {
        const sent = await ctx.notifications.send(request.body ?? {});
        return { sent };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  });
}
