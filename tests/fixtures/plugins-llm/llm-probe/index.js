// The ctx.llm contract for the `plugin-llm-capability` test.
export async function register(ctx) {
  ctx.llm.registerConsumer("skill_validation");
  ctx.routes.register((app) => {
    app.get("/status", async () => ctx.llm.status("skill_validation"));
    app.post("/complete", async (request) => {
      const { purpose } = request.body ?? {};
      return ctx.llm.complete({ purpose, messages: [{ role: "user", content: "hello" }] });
    });
    app.get("/dump", async () => ({ keys: Object.keys(ctx.llm), env: Object.keys(ctx).sort(), status: ctx.llm.status("skill_validation") }));
  });
}
