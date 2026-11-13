/** Token estimate of a text: CJK one per character, Cyrillic one per two, the rest one per four characters. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/gu;
const CYRILLIC_RE = /[\u0400-\u04FF]/gu;

export function tokensEst(body: string): number {
  const cjk = body.match(CJK_RE)?.length ?? 0;
  const cyr = body.match(CYRILLIC_RE)?.length ?? 0;
  return cjk + Math.ceil(cyr / 2) + Math.ceil((body.length - cjk - cyr) / 4);
}
