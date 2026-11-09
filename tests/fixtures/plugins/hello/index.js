// Fixture plugin: the plugin context API contract.
// The platform must make it work exactly as written.
export async function register(ctx) {
  ctx.logger.info(`hello ${ctx.version} registering from ${ctx.dir}`);

  ctx.db.migrate([
    {
      id: "0001_counter",
      sql: "CREATE TABLE IF NOT EXISTS ext_hello_counter (id INTEGER PRIMARY KEY CHECK (id = 1), published INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO ext_hello_counter (id, published) VALUES (1, 0);",
    },
    {
      id: "0002_events",
      sql: "CREATE TABLE IF NOT EXISTS ext_hello_events (n INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ext_hello_events_type ON ext_hello_events (type);",
    },
  ]);

  const count = () => Number(ctx.db.prepare("SELECT published FROM ext_hello_counter WHERE id = 1").get().published);

  ctx.events.on("artifact.published", (evt) => {
    ctx.db.exec("UPDATE ext_hello_counter SET published = published + 1 WHERE id = 1");
    ctx.db.prepare("INSERT INTO ext_hello_events (type, payload) VALUES (?, ?)").run(evt.type, JSON.stringify(evt));
  });
  ctx.events.on("artifact.transitioned", (evt) => {
    ctx.db.prepare("INSERT INTO ext_hello_events (type, payload) VALUES (?, ?)").run(evt.type, JSON.stringify(evt));
  });
  ctx.events.on("server.started", (evt) => {
    ctx.db.prepare("INSERT INTO ext_hello_events (type, payload) VALUES (?, ?)").run(evt.type, JSON.stringify(evt));
  });

  ctx.routes.public("/public");
  ctx.routes.register((app) => {
    app.get("/ping", async () => {
      const cfg = ctx.config.get();
      return { pong: true, greeting: cfg.shout ? String(cfg.greeting).toUpperCase() : cfg.greeting, plugin: ctx.name };
    });
    app.get("/public", async () => ({ ok: true, anonymous: true }));
    app.get("/admin-only", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "admin")) return;
      return { ok: true, role: "admin" };
    });
    app.get("/count", async () => ({ count: count() }));
    app.get("/events", async () => {
      const rows = ctx.db.prepare("SELECT type, payload FROM ext_hello_events ORDER BY n").all();
      return { items: rows.map((r) => ({ type: r.type, payload: JSON.parse(r.payload) })) };
    });
    app.get("/active", async () => {
      const { items } = ctx.registry.listArtifacts({ status: "active", limit: 50 });
      return { names: items.map((a) => `${a.type}/${a.name}`) };
    });
    app.get("/skill-md/:name", async (request, reply) => {
      const name = request.params.name;
      const artifact = ctx.registry.getArtifact("skill", name);
      if (!artifact || !artifact.latest_version) return reply.code(404).send({ error: "not_found" });
      const version = ctx.registry.getVersion("skill", name, artifact.latest_version);
      const bytes = ctx.registry.readFile("skill", name, artifact.latest_version, `skills/${name}/SKILL.md`);
      if (!bytes) return reply.code(404).send({ error: "not_found" });
      return { version: version.version, digest: version.digest, text: Buffer.from(bytes).toString("utf8") };
    });
  });

  ctx.ui.nav({ id: "about", label: "Hello", page: "about" });
  ctx.ui.page("about", () => ({
    title: "About Hello",
    markdown: `# About Hello\n\nThis page is served by the **hello** plugin.\n\nPublished so far: ${count()}.\n\n<script>alert(1)</script>`,
  }));
  ctx.ui.artifactTab({ id: "greeting", label: "Greeting" }, ({ artifact, version }) => ({
    markdown: `${ctx.config.get().greeting}, **${artifact.type}/${artifact.name}** at version ${version ? version.version : "n/a"}.`,
  }));

  // Asynchronous page and tab handlers: the platform must await the Promise.
  const later = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 20));
  ctx.ui.page("async", async () => later({ title: "Async page", markdown: `Resolved asynchronously; published so far: ${count()}.` }));
  ctx.ui.artifactTab({ id: "async-greeting", label: "Async greeting" }, async ({ artifact }) =>
    later({ markdown: `async hello, **${artifact.type}/${artifact.name}**` }),
  );
}
