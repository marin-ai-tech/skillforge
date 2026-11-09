// Plugin fixture: the extension contract for a badge on an artifact card.
// The platform must make this file work exactly as written.
export async function register(ctx) {
  ctx.routes.register((app) => {
    app.post("/badge/:type/:name", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      try {
        ctx.registry.setBadge(request.params.type, request.params.name, request.body ?? {});
        return { ok: true };
      } catch (e) {
        return reply.code(400).send({ error: "bad_badge", message: String(e?.message ?? e) });
      }
    });
    app.delete("/badge/:type/:name/:id", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      ctx.registry.clearBadge(request.params.type, request.params.name, request.params.id);
      return { ok: true };
    });
  });
}
