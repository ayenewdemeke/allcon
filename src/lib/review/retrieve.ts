// Picks the manual sections most relevant to a sheet (BM25 over section text, with the
// section title weighted up), within a character budget, so each review request carries
// only what it needs.

const STOP = new Set(
  "the and for with that this from are was were shall will may not all any each per its into than then when where which who whom have has had been being also only other such these those there their them they use used using must should can could would within without between under over upon see note notes typ typical".split(
    " ",
  ),
);

export function tokenize(text: string) {
  return (text.toLowerCase().match(/[a-z][a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t));
}

/** `number` is the section number; unnumbered text (appendices, examples) ranks a little lower. */
export type SectionDoc = { id: string; number: string | null; title: string; text: string };

export function rankSections<T extends SectionDoc>(query: string, sections: T[], budgetChars: number, maxSections = 24): T[] {
  const TITLE_WEIGHT = 3;
  const k1 = 1.2;
  const b = 0.75;
  const docs = sections.map((s) => {
    const tf = new Map<string, number>();
    const add = (t: string, w: number) => tf.set(t, (tf.get(t) ?? 0) + w);
    for (const t of tokenize(s.title)) add(t, TITLE_WEIGHT);
    let len = 0;
    for (const t of tokenize(s.text)) {
      add(t, 1);
      len++;
    }
    return { s, tf, len: len + 1 };
  });
  if (!docs.length) return [];
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);

  const q = new Map<string, number>();
  for (const t of tokenize(query)) q.set(t, (q.get(t) ?? 0) + 1);

  const scored = docs
    .map((d) => {
      let score = 0;
      for (const [t, qtf] of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = df.get(t)!;
        const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
        score += (1 + Math.log(qtf)) * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
      }
      return { s: d.s, score: d.s.number ? score : score * 0.6 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score);

  const picked: T[] = [];
  let used = 0;
  for (const { s } of scored) {
    if (picked.length >= maxSections) break;
    const size = s.title.length + s.text.length;
    if (used + size > budgetChars) continue; // a smaller, still-relevant section may fit
    picked.push(s);
    used += size;
  }
  return picked;
}
