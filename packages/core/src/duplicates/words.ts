export const STOP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "and",
  "for",
  "with",
  "when",
  "use",
  "this",
  "that",
  "from",
  "into",
  "your",
  "you",
  "are",
  "not",
]);

const MIN_WORD_LENGTH = 3;

/** Naive English plural stem: `ies→y`, `sses→ss`, trailing `s` unless `ss|us|is`. */
export function stemWord(word: string): string {
  if (word.length <= MIN_WORD_LENGTH) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lower-cased alphanumeric words of length ≥ 3 without stop words, stemmed. */
export function descriptionWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < MIN_WORD_LENGTH || STOP_WORDS.has(raw)) continue;
    out.add(stemWord(raw));
  }
  return out;
}

/** Jaccard coefficient |A ∩ B| / |A ∪ B|; 0 when the union is empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Similarity of two descriptions rounded to two decimals. */
export function descriptionSimilarity(a: string, b: string): number {
  const score = jaccard(descriptionWords(a), descriptionWords(b));
  return Math.round(score * 100) / 100;
}
