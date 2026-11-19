// news-delivery: absolute links of news items, built the way other absolute links are (PUBLIC_URL, else baseUrl).

/** The absolute base of links: PUBLIC_URL when set, else the listen URL; no trailing slash. */
export function linkBase(config: { publicUrl: string | null; baseUrl: string }): string {
  return (config.publicUrl ?? config.baseUrl).replace(/\/+$/, "");
}

export function newsItemUrl(
  base: string,
  item: { id: number | string; artifact: { type: string; name: string } | null },
): string {
  return item.artifact
    ? `${base}/artifacts/${encodeURIComponent(item.artifact.type)}/${encodeURIComponent(item.artifact.name)}`
    : `${base}/news#news-${item.id}`;
}
