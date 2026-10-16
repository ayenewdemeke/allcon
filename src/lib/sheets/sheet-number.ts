// Guesses a sheet's number (A101, S-2.01, B1...) from its text, where title blocks put it:
// the bottom-right of the sheet. Works in the browser (before upload) and on the server
// (re-detecting an uploaded set).

export type PlacedText = { text: string; x: number; y: number; size: number }; // displayed points, top-left origin

// Must start with a discipline letter: A101, A-101, S2.01, C1.0, M-3, B12, and inserted
// sheets like B28a.
const SHEET_NUMBER = /^[A-Z]{1,2}[-.]?\d{1,3}(?:\.\d{1,2})?[A-Za-z]?$/;
// Labels that sit next to the number in a title block.
const LABEL = /\b(sheet|dwg|drawing)\s*(no\.?|num(ber)?|#)|^sheet$/i;

export function guessSheetNumber(items: PlacedText[], width: number, height: number): string | null {
  const inCorner = (t: PlacedText) => t.x >= width * 0.6 && t.y >= height * 0.6;
  const sameRow = (a: PlacedText, b: PlacedText) => Math.abs(a.y - b.y) <= Math.max(a.size, b.size);
  const corner = items.filter((t) => t.text.trim() && inCorner(t));

  let best: { text: string; score: number } | null = null;
  for (const item of corner) {
    const text = item.text.trim();
    if (!SHEET_NUMBER.test(text)) continue;
    // "B1 of B56": the number after "of" is the count of sheets, not this sheet.
    const before = corner.filter((o) => o !== item && sameRow(o, item) && o.x < item.x && item.x - o.x < item.size * 8);
    const nearest = before.sort((a, b) => b.x - a.x)[0];
    if (nearest && /^of$/i.test(nearest.text.trim())) continue;
    // Next to (left of, or just above) a "Sheet No." label: almost certainly the number.
    const labelled = corner.some(
      (o) =>
        LABEL.test(o.text) &&
        ((sameRow(o, item) && o.x < item.x && item.x - o.x < item.size * 25) ||
          (o.y < item.y && item.y - o.y < item.size * 4 && Math.abs(o.x - item.x) < item.size * 12)),
    );
    const score = item.size + (labelled ? 1000 : 0) + (item.x + item.y) / 10_000; // ties: further bottom-right
    if (!best || score > best.score) best = { text, score };
  }
  return best?.text ?? null;
}
