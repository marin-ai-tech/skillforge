import type { CorpusTopic } from "./corpus.ts";

/**
 * Topic selection for the assistant context: BM25 over words, no external
 * services. Words are lowercased letters/digits; a crude stem (first 6 characters) lets inflected word forms meet.
 * Title and summary weigh more than the body.
 */
const STEM = 6;
const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((w) => w.length > 1)
    .map((w) => (w.length > STEM ? w.slice(0, STEM) : w));
}

type Indexed = { topic: CorpusTopic; tf: Map<string, number>; length: number };

function index(topics: CorpusTopic[]): Indexed[] {
  return topics.map((topic) => {
    const tf = new Map<string, number>();
    const head = tokens(`${topic.title} ${topic.summary} ${topic.id.replace(/[/_-]/g, " ")}`);
    const body = tokens(topic.body);
    for (const w of head) tf.set(w, (tf.get(w) ?? 0) + TITLE_WEIGHT);
    for (const w of body) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { topic, tf, length: head.length * TITLE_WEIGHT + body.length };
  });
}

const cache = new WeakMap<CorpusTopic[], Indexed[]>();

/** The `limit` topics closest to `query`, best first; topics with no shared word are left out. */
export function topTopics(topics: CorpusTopic[], query: string, limit: number): CorpusTopic[] {
  let docs = cache.get(topics);
  if (!docs) {
    docs = index(topics);
    cache.set(topics, docs);
  }
  const terms = [...new Set(tokens(query))];
  if (!terms.length || !docs.length) return [];
  const all = docs;
  const avg = all.reduce((s, d) => s + d.length, 0) / all.length;
  const idf = new Map(
    terms.map((t) => {
      const n = all.filter((x) => x.tf.has(t)).length;
      return [t, Math.log(1 + (all.length - n + 0.5) / (n + 0.5))];
    }),
  );
  const scored = all.map((d) => {
    let score = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (f) score += (idf.get(t)! * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avg));
    }
    return { topic: d.topic, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.topic.id.localeCompare(b.topic.id))
    .slice(0, limit)
    .map((s) => s.topic);
}
