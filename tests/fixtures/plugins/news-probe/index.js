// Plugin fixture (news-delivery): the contract of the news events for plugins. It subscribes to `news.published` and
// `news.summary` and posts each event as it came to the configured URL; the config is read on every event.
export function register(ctx) {
  const deliver = async (evt) => {
    const { url } = ctx.config.get();
    if (typeof url !== "string" || url.length === 0) return;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-skillforge-event": evt.type },
      body: JSON.stringify(evt),
    });
  };
  for (const type of ["news.published", "news.summary"]) {
    ctx.events.on(type, (evt) => deliver(evt).catch((e) => ctx.logger.warn(`news-probe failed: ${e.message}`)));
  }
}
