// Fixture plugin: the ctx.process.spawnIsolated contract.
// The platform must make it work exactly this way.
// The plugin imports nothing from @skillforge/* — the runner comes only through ctx.
export async function register(ctx) {
  ctx.routes.register((app) => {
    app.get("/run", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      const code =
        "process.stdout.write(JSON.stringify({ marker: 'ran'," +
        " secret: process.env.SKILLFORGE_RUNNER_SECRET ?? null," +
        " lower: process.env.skillforge_runner_secret ?? null," +
        " input: require('fs').readFileSync(0, 'utf8') }))";
      const r = await ctx.process.spawnIsolated([process.execPath, "-e", code], {
        envNames: ["SKILLFORGE_RUNNER_SECRET", "skillforge_runner_secret"],
        timeoutS: 30,
        stdin: "from-plugin",
      });
      return { ok: r.ok, code: r.code, timedOut: r.timedOut, stdout: r.stdout };
    });
    app.get("/hang", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      const started = Date.now();
      const r = await ctx.process.spawnIsolated([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
        timeoutS: 1,
      });
      return { ok: r.ok, timedOut: r.timedOut, elapsed_ms: Date.now() - started };
    });
  });
}
