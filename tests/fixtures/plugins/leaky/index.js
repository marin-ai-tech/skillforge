// Fixture plugin: subscribes and declares a contribution, then fails — the platform must roll everything back.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function register(ctx) {
  ctx.events.on("artifact.published", () => {
    writeFileSync(join(ctx.dir, "RAN.txt"), "handler of a failed plugin ran");
  });
  ctx.events.on("server.started", () => {
    writeFileSync(join(ctx.dir, "RAN.txt"), "handler of a failed plugin ran");
  });
  ctx.routes.public("/x");
  ctx.routes.register((app) => {
    app.get("/x", async () => ({ leaky: true }));
  });
  ctx.ui.nav({ id: "leak", label: "Leak", page: "leak" });
  ctx.ui.page("leak", () => ({ title: "Leak", markdown: "leak" }));
  ctx.ui.artifactTab({ id: "leak", label: "Leak" }, () => ({ markdown: "leak" }));
  throw new Error("boom after subscribing");
}
