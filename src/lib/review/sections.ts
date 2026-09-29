// Splits a manual's text into numbered sections ("5.4.3 Clear Cover") so review findings
// can cite them and only the relevant ones are sent with each sheet. Uses the PDF's
// bookmarks when it has them, otherwise headings found in the text.

export type ManualPage = { page: number; lines: string[] }; // 1-based page, text lines in reading order
export type OutlineEntry = { title: string; page: number };
export type ManualSection = { number: string | null; title: string; page: number; text: string };

// Front matter that would match every query: contents, lists of tables/figures, the cover.
const FRONT_MATTER = /^(tableofcontents|contents|listof(tables|figures|examples)|index|cover)$|manualcover$/;
const isFrontMatter = (title: string) => FRONT_MATTER.test(title.toLowerCase().replace(/\s+/g, ""));

const MAX_SECTION_CHARS = 3000; // longer sections are split into parts
const MIN_OUTLINE_ENTRIES = 8;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const normalize = (s: string) => squash(s).toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();

/**
 * "5.4.3 Clear Cover" / "SECTION 5 CONCRETE STRUCTURES" -> number + title. Bookmarks named
 * after files ("BDM_Section 1_2024") are tidied into "Section 1".
 */
export function parseHeading(raw: string): { number: string | null; title: string } {
  const text = squash(raw.replace(/_(19|20)\d\d\b/g, "").replace(/^[A-Z]{2,6}_/, "").replace(/_/g, " "));
  const m = /^(?:section|chapter|part)?\s*(\d+(?:\.\d+)*\.?|[A-Z]\.|[IVX]+\.)\s+(.+)$/i.exec(text);
  if (m && m[2].length > 1) return { number: m[1].replace(/\.$/, ""), title: m[2] };
  return { number: null, title: text };
}

/**
 * Running headers and footers ("CDOT Bridge Design Manual  February 2026", page numbers)
 * repeat on most pages and would pollute every section, so they're dropped.
 */
function repeatedLines(pages: ManualPage[]) {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const key of new Set(p.lines.map((l) => normalize(l).replace(/\d+/g, "#")))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(4, pages.length * 0.3);
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
}

// Numbered headings in the text: "5.4.3 Clear Cover", "SECTION 5 CONCRETE STRUCTURES".
// Table-of-contents lines end in a page reference ("5-4", "12", dotted leaders) and are skipped.
const HEADING = /^(?:SECTION\s+\d+|\d+(?:\.\d+){1,3})\.?\s+[A-Z][^.]{2,100}$/;
const TOC_LINE = /(\.{3,}|\s\d+-\d+|\s[ivx]+|\s\d{1,3})$/;

type Cursor = { pageIdx: number; lineIdx: number };

function splitLong(section: ManualSection): ManualSection[] {
  if (section.text.length <= MAX_SECTION_CHARS) return [section];
  const parts: ManualSection[] = [];
  let rest = section.text;
  while (rest.length) {
    let cut = rest.length <= MAX_SECTION_CHARS ? rest.length : rest.lastIndexOf("\n", MAX_SECTION_CHARS);
    if (cut < MAX_SECTION_CHARS / 2) cut = Math.min(rest.length, MAX_SECTION_CHARS);
    parts.push({ ...section, title: parts.length ? `${section.title} (cont.)` : section.title, text: rest.slice(0, cut).trim() });
    rest = rest.slice(cut).trim();
  }
  return parts;
}

export function splitManual(pages: ManualPage[], outline: OutlineEntry[]): ManualSection[] {
  const skip = repeatedLines(pages);
  const clean = pages.map((p) => ({
    page: p.page,
    lines: p.lines.map(squash).filter((l) => l && !skip.has(normalize(l).replace(/\d+/g, "#"))),
  }));
  const pageIdx = new Map(clean.map((p, i) => [p.page, i]));

  // Where each section starts: bookmarks (matched to their line on the page) or headings.
  const starts: { at: Cursor; number: string | null; title: string; page: number }[] = [];
  if (outline.length >= MIN_OUTLINE_ENTRIES) {
    let last: Cursor = { pageIdx: 0, lineIdx: 0 };
    for (const entry of outline) {
      let pi = pageIdx.get(entry.page);
      if (pi === undefined || pi < last.pageIdx) continue;
      const heading = parseHeading(entry.title);
      const want = normalize(heading.title);
      const full = normalize(`${heading.number ?? ""} ${heading.title}`);
      // Prefer the heading line itself over a table caption or cross-reference that mentions
      // it; bookmarks sometimes point at the page before the heading.
      const find = (p: number, test: (l: string) => boolean) => {
        const from = p === last.pageIdx ? last.lineIdx : 0;
        return clean[p]?.lines.findIndex((l, i) => i >= from && test(normalize(l))) ?? -1;
      };
      const heads = (l: string) => l.startsWith(full) || l.startsWith(want);
      let li = find(pi, heads);
      if (li < 0 && find(pi + 1, heads) >= 0) li = find(++pi, heads);
      if (li < 0) li = find(pi, (l) => l.includes(want));
      if (li < 0) li = pi === last.pageIdx ? last.lineIdx : 0;
      last = { pageIdx: pi, lineIdx: li };
      starts.push({ at: last, page: entry.page, ...parseHeading(entry.title) });
    }
  } else {
    clean.forEach((p, pi) =>
      p.lines.forEach((line, li) => {
        if (HEADING.test(line) && !TOC_LINE.test(line)) starts.push({ at: { pageIdx: pi, lineIdx: li }, page: p.page, ...parseHeading(line) });
      }),
    );
  }
  if (!starts.length) {
    // No structure at all: one section per page.
    return clean
      .filter((p) => p.lines.length)
      .flatMap((p) => splitLong({ number: null, title: `Page ${p.page}`, page: p.page, text: p.lines.join("\n") }));
  }

  const textBetween = (a: Cursor, b: Cursor | null) => {
    const out: string[] = [];
    for (let pi = a.pageIdx; pi < clean.length; pi++) {
      if (b && pi > b.pageIdx) break;
      const lines = clean[pi].lines;
      const from = pi === a.pageIdx ? a.lineIdx : 0;
      const to = b && pi === b.pageIdx ? b.lineIdx : lines.length;
      out.push(...lines.slice(from, to));
    }
    return out.join("\n").trim();
  };

  return starts.flatMap((s, i) => {
    if (isFrontMatter(s.title)) return [];
    const text = textBetween(s.at, starts[i + 1]?.at ?? null);
    return text ? splitLong({ number: s.number, title: s.title, page: s.page, text }) : [];
  });
}
