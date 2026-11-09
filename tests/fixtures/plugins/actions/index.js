// Plugin fixture: the platform extension contract for review assistants:
// tab sections with actions (`sections[].actions`), the user in the tab handler (`user`),
// `ctx.registry.addEvidence`. The platform must make this file work exactly as written.
export async function register(ctx) {
  ctx.db.migrate([
    {
      id: "0001_ticks",
      sql: "CREATE TABLE IF NOT EXISTS ext_actions_ticks (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, by TEXT)",
    },
  ]);
  const ticks = (id) => Number(ctx.db.prepare("SELECT n FROM ext_actions_ticks WHERE id = ?").get(id)?.n ?? 0);

  ctx.routes.register((app) => {
    app.post("/tick/:id", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
      const id = request.params.id;
      const by = request.user.username;
      const step = Number(request.body?.step ?? 1);
      ctx.db
        .prepare("INSERT INTO ext_actions_ticks (id, n, by) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET n = n + excluded.n, by = excluded.by")
        .run(id, step, by);
      return { id, n: ticks(id), by };
    });
    app.post("/evidence/:type/:name/:version", async (request, reply) => {
      if (!ctx.auth.requireRole(request, reply, "reviewer")) return;
      const { type, name, version } = request.params;
      const result = ctx.registry.addEvidence(type, name, version, { kind: request.body.kind, url: request.body.url });
      return { evidence: result };
    });
  });

  ctx.ui.artifactTab({ id: "todo", label: "Todo" }, ({ artifact, version, user }) => {
    const who = user ? `${user.username} (${user.role})` : "anonymous";
    const canAct = Boolean(user && (user.role === "reviewer" || user.role === "admin"));
    return {
      markdown: `Todo for **${artifact.type}/${artifact.name}** @ ${version ? version.version : "n/a"} — viewer: ${who}`,
      sections: [
        {
          id: "t1",
          markdown: `**T1** ticked ${ticks("t1")} times`,
          actions: canAct ? [{ id: "t1-tick", label: "Tick T1", path: "/tick/t1", body: { step: 1 } }] : [],
        },
        {
          id: "t2",
          markdown: `**T2** ticked ${ticks("t2")} times`,
          actions: canAct
            ? [
                { id: "t2-tick", label: "Tick T2", path: "/tick/t2", body: { step: 2 } },
                { id: "t2-confirm", label: "Tick T2 (confirm)", path: "/tick/t2", body: { step: 10 }, confirm: "Add ten?" },
              ]
            : [],
        },
      ],
    };
  });
}
