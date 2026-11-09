// Fixture plugin: running is forbidden without the `process` capability.
export async function register(ctx) {
  ctx.routes.register((app) => {
    app.get("/run", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      try {
        const r = await ctx.process.spawnIsolated([process.execPath, "-e", "process.stdout.write('ran')"], {
          timeoutS: 10,
        });
        return { spawned: true, stdout: r.stdout };
      } catch (e) {
        return { spawned: false, error: String((e && e.message) || e) };
      }
    });
  });
}
