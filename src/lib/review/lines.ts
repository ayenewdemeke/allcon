// Groups a sheet's text-layer pieces into lines with boxes (sheet points, top-left origin),
// so the reviewer can point at text by line id and a kept issue is clouded in the right spot.
// Drawings put notes in columns, so pieces on one row far apart become separate lines.

export type TextPiece = { text: string; box: [number, number, number, number] }; // x0, y0, x1, y1
export type SheetLine = { id: number; text: string; box: [number, number, number, number] };

const MAX_LINES = 600;
const MAX_LINE_CHARS = 300;

export function groupLines(pieces: TextPiece[]): SheetLine[] {
  const items = pieces
    .map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ") }))
    .filter((p) => p.text.trim() && p.box[3] > p.box[1]);
  // Rows: sorted by vertical centre; a piece joins a row when its centre is within half its height.
  items.sort((a, b) => (a.box[1] + a.box[3]) / 2 - (b.box[1] + b.box[3]) / 2);
  const rows: (typeof items)[] = [];
  for (const it of items) {
    const cy = (it.box[1] + it.box[3]) / 2;
    const h = it.box[3] - it.box[1];
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (ref && Math.abs(cy - (ref.box[1] + ref.box[3]) / 2) <= Math.max(h, ref.box[3] - ref.box[1]) * 0.5) row.push(it);
    else rows.push([it]);
  }

  const lines: SheetLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.box[0] - b.box[0]);
    let cur = null as TextPiece | null;
    const flush = () => {
      if (cur && cur.text.trim()) lines.push({ id: lines.length + 1, text: cur.text.trim().slice(0, MAX_LINE_CHARS), box: cur.box });
      cur = null;
    };
    for (const it of row) {
      const h = it.box[3] - it.box[1];
      if (cur && it.box[0] - cur.box[2] <= h * 2) {
        const gap: string = it.box[0] - cur.box[2] > h * 0.2 && !cur.text.endsWith(" ") && !it.text.startsWith(" ") ? " " : "";
        cur = {
          text: cur.text + gap + it.text,
          box: [Math.min(cur.box[0], it.box[0]), Math.min(cur.box[1], it.box[1]), Math.max(cur.box[2], it.box[2]), Math.max(cur.box[3], it.box[3])],
        };
      } else {
        flush();
        cur = { text: it.text, box: [...it.box] };
      }
    }
    flush();
    if (lines.length >= MAX_LINES) break;
  }
  // Reading order: top to bottom, then left to right.
  return lines.slice(0, MAX_LINES).map((l, i) => ({ ...l, id: i + 1 }));
}

/** The box around the given lines, padded, or null if none of them exist. */
export function boxOfLines(lines: SheetLine[], ids: number[], pad = 6): [number, number, number, number] | null {
  const hit = lines.filter((l) => ids.includes(l.id));
  if (!hit.length) return null;
  return [
    Math.min(...hit.map((l) => l.box[0])) - pad,
    Math.min(...hit.map((l) => l.box[1])) - pad,
    Math.max(...hit.map((l) => l.box[2])) + pad,
    Math.max(...hit.map((l) => l.box[3])) + pad,
  ];
}
