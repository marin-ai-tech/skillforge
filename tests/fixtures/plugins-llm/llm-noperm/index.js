// A plugin without the `llm` capability: the call must be rejected before the model is reached.
export async function register(ctx) {
  ctx.routes.register((app) => {
    app.post("/complete", async () => ctx.llm.complete({ purpose: "skill_validation", messages: [{ role: "user", content: "hello" }] }));
  });
}
