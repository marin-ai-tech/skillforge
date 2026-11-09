// Plugin fixture: core events -> HTTP POST. The config is read on every event (no restart needed).
export function register(ctx) {
  const deliver = async (evt) => {
    const cfg = ctx.config.get();
    if (typeof cfg.url !== "string" || cfg.url.length === 0) return;
    if (Array.isArray(cfg.events) && !cfg.events.includes(evt.type)) return;
    await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-skillforge-event": evt.type },
      body: JSON.stringify(evt),
    });
  };
  for (const type of ["artifact.published", "artifact.transitioned", "version.validated", "auth.login"]) {
    ctx.events.on(type, (evt) => deliver(evt).catch((e) => ctx.logger.warn(`webhook failed: ${e.message}`)));
  }
}
