import type { DtInputs } from "./double-tee";
import type { SiaReading, SiaValue } from "./sia";

// Reading an inspection sketch's callouts, without AI: only the labeled text a CAD sketch carries
// ("(5) PRECAST, PRESTRESSED CONC. DBL. TEE GIRDERS AT 8'-0" o.c.", "4 1/2" CONC. TOPPING ON",
// "2" PC. CONC. FLANGE", "6" ASPHALT ON", "40'-0" C/C", "C BRG." over the span…). Bare dimensions
// ("22"", "4'-0"") don't say what they measure, so stem depth, stem spacing and stem widths are left
// to the engineer. Scanned or outlined sketches have no text and give nothing. Every value carries its
// callout and is used only if picked, as with the SIA.

const FRAC: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };

/** A dimension's inches: 6'-10 1/2", 4 ½", 8", 32'-9". Null if it isn't one. */
export function dimInches(s: string): number | null {
  const t = s.replace(/[½¼¾⅛⅜⅝⅞]/g, (c) => ` ${FRAC[c]}`).replace(/\s+/g, " ").trim();
  const frac = (w?: string, n?: string, d?: string, dec?: string) => (w ? Number(w) : 0) + (n && d ? Number(n) / Number(d) : 0) + (dec ? Number(dec) : 0);
  let m = t.match(/^(\d+)'\s*-?\s*(\d+)(?:\s+(\d+)\/(\d+)|\s+(0\.\d+))?\s*"/);
  if (m) return Number(m[1]) * 12 + frac(m[2], m[3], m[4], m[5]);
  m = t.match(/^(\d+)'(?!\s*-?\s*\d)/);
  if (m) return Number(m[1]) * 12;
  m = t.match(/^(\d+)(?:\s+(\d+)\/(\d+)|\s+(0\.\d+))?\s*"/);
  if (m) return frac(m[1], m[2], m[3], m[4]);
  return null;
}

const DIM = String.raw`(\d+'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*"|\d+(?:\s+\d+\/\d+|\s*[½¼¾⅛⅜⅝⅞])?\s*"|\d+')`;
const ft = (inches: number) => +(inches / 12).toFixed(4);
const show = (inches: number) => {
  const f = Math.floor(inches / 12);
  const r = +(inches - f * 12).toFixed(3);
  return f ? `${f}'-${r}"` : `${r}"`;
};

/** A sketch's lines with stacked fractions put back: "1" over "4 | 2 | " CONC…" is 4 1/2" CONC… */
function repairFractions(lines: string[]) {
  const out: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const next = lines[k + 1]?.match(/^(\d+) \| (\d+) \| "(.*)$/);
    if (/^\d$/.test(lines[k]) && next) {
      out.push(`${next[1]} ${lines[k]}/${next[2]}"${next[3]}`);
      k++;
    } else out.push(lines[k]);
  }
  return out;
}

/** Reads a sketch's callouts (its text lines, as the SIA reader gives them). */
export function readSketchCallouts(rawLines: string[], name: string, i: DtInputs): SiaReading {
  const lines = repairFractions(rawLines.map((l) => l.trim()).filter(Boolean));
  const cells = lines.map((l) => l.split(" | ").map((c) => c.trim()));
  const all = cells.flat();
  const values: SiaValue[] = [];
  const findings: string[] = [];
  const add = (input: SiaValue["input"], label: string, value: SiaValue["value"], source: string, note?: string) => values.push({ input, label, value, source, ...(note ? { note } : {}) });
  const find = (re: RegExp) => {
    for (const c of all) {
      const m = c.match(re);
      if (m) return { m, text: c };
    }
    return null;
  };

  // The units: "(5) PRECAST, PRESTRESSED CONC. DBL. TEE GIRDERS AT 8'-0" o.c." (or "DOUBLE TEES AT …"),
  // with edge units "(1) PC./PS. CONC. DBL. TEE GIR. AT 5'-0"" split over lines.
  const main = find(new RegExp(String.raw`\((\d+)\)\s*PRECAST,?\s*PRESTRESSED\s*CONC\.?\s*(?:DOUBLE|DBL\.?)\s*TEES?(?:\s*GIRDERS)?(?:\s*AT\s*${DIM}\s*o\.?\s*c\.?)?`, "i"));
  if (main) {
    const n = Number(main.m[1]);
    const spacing = main.m[2] ? dimInches(main.m[2]) : null;
    const edges = all.filter((c) => /^\(\d+\)\s*PC\.?\s*\/\s*PS\.?$/i.test(c)).map((c) => Number(c.match(/\d+/)![0]));
    const edgeWidths = all.flatMap((c) => {
      const m = c.match(new RegExp(String.raw`^GIR\.?\s*AT\s*${DIM}`, "i"));
      return m ? [dimInches(m[1])] : [];
    });
    const nEdge = edges.reduce((a, b) => a + b, 0);
    const total = n + nEdge;
    add("units.count", "Number of units", total, nEdge ? `"(${n}) PRECAST, PRESTRESSED …" and ${nEdge} "PC./PS. … GIR." callouts` : `"${main.text}"`);
    if (spacing) {
      add("units.spacing", "Spacing (unit CL to CL)", spacing, `"${main.text}"`, nEdge ? "The units between the edge units." : undefined);
      add("units.flangeWidth", "Flange width", spacing, `"${main.text}"`, "Adjacent units: the flange as wide as the spacing.");
    }
    const edgeW = edgeWidths.find((w): w is number => w !== null);
    if (nEdge && spacing && edgeW && nEdge % 2 === 0) {
      // Edge units split equally between the two sides; stem spacing kept from the inputs (the sketch doesn't dimension it).
      const old = i.units.layout && i.units.layout.length === total ? i.units.layout : null;
      const ss = (k: number, w: number) => old?.[k]?.stemSpacing ?? Math.min(i.units.stemSpacing, Math.max(12, w - 24));
      const half = nEdge / 2;
      const layout = Array.from({ length: total }, (_, k) => {
        const w = k < half || k >= total - half ? edgeW : spacing;
        return { flangeWidth: w, stemSpacing: ss(k, w) };
      });
      add("units.layout", "Units differ", layout, `${half} unit${half > 1 ? "s" : ""} of ${show(edgeW)} at each edge ("GIR. AT ${show(edgeW)}"), ${n} of ${show(spacing)} between`, "Stem spacing within the units isn't dimensioned: kept from the inputs. Check it on the sketch.");
    } else if (nEdge) findings.push(`The sketch shows ${nEdge} edge unit${nEdge > 1 ? "s" : ""} of another width${edgeW ? ` (${show(edgeW)})` : ""}: enter the unit layout under "Units differ".`);
  }

  // Topping or deck, precast flange, asphalt.
  const deck = find(new RegExp(String.raw`${DIM}\s*(?:C\.?I\.?P\.?\s*)?CONC\.?\s*(DECK|TOPPING)`, "i"));
  if (deck) {
    const t = dimInches(deck.m[1]);
    if (t) {
      add("deck.present", "Composite CIP deck", true, `"${deck.text}"`);
      add("deck.thk", "Deck thickness", t, `"${deck.text}"`, "Inches.");
    }
  }
  const flange = find(new RegExp(String.raw`${DIM}\s*(?:PC\.?|PRECAST|P\/C)\s*CONC\.?\s*FLANGE|${DIM}\s*(?:DOUBLE|DBL\.?)\s*TEE\s*FLANGE`, "i"));
  if (flange) {
    const t = dimInches(flange.m[1] ?? flange.m[2]);
    if (t) add("units.flangeThk", "Flange thickness", t, `"${flange.text}"`, "Inches. The stem depth below it isn't labeled: enter the precast depth from the sketch.");
  }
  const asph = find(new RegExp(String.raw`${DIM}\s*ASPHALT`, "i"));
  if (asph) {
    const t = dimInches(asph.m[1]);
    if (t !== null) add("loads.asphalt", "Asphalt", t, `"${asph.text}"`, "Inches.");
    const avg = all.find((c) => new RegExp(String.raw`^${DIM}\s*AVG\.?$`, "i").test(c));
    if (avg) findings.push(`The sketch also dimensions a layer "${avg}": check whether the asphalt is ${asph.m[1].trim()} or that.`);
  }

  // The span: the dimension under "C BRG." (bearing to bearing); the structure length.
  const brg = lines.findIndex((l) => /C\s*BRG\./i.test(l));
  if (brg >= 0) {
    const next = cells[brg + 1] ?? [];
    const spans = next.map(dimInches).filter((v): v is number => v !== null);
    if (spans.length && next.every((c) => dimInches(c) !== null)) {
      add("span", "Span", ft(spans[0]), `${show(spans[0])} between "C BRG." marks`, spans.length > 1 ? `${spans.length} spans of ${spans.map(show).join(", ")} on the sketch.` : undefined);
    }
  }
  const len = find(new RegExp(String.raw`${DIM}\s*STR\.?\s*(?:LEN\.?|LENGTH)`, "i"));
  if (len) {
    const v = dimInches(len.m[1]);
    if (v) add("structureLength", "Structure (girder) length", ft(v), `"${len.text}"`, i.numSpans > 1 ? "The whole structure: for more spans, the girder length is less." : undefined);
  }

  // Widths: out to out (the smallest "O/O", the larger is the length), curb to curb, and the sidewalks beside it.
  const oo = all.flatMap((c) => {
    const m = c.match(new RegExp(String.raw`^${DIM}\s*O\/O`, "i"));
    const v = m ? dimInches(m[1]) : null;
    return v ? [{ v, c }] : [];
  });
  const width = oo.filter((x) => x.v <= 120 * 12).sort((a, b) => a.v - b.v)[0];
  if (width) add("roadway.railToRail", "Width, out to out", ft(width.v), `"${width.c}"`);
  const ccRow = cells.findIndex((r) => r.some((c) => new RegExp(String.raw`^${DIM}\s*C\/C$`, "i").test(c)));
  if (ccRow >= 0) {
    const row = cells[ccRow];
    const at = row.findIndex((c) => /C\/C$/i.test(c));
    const cc = dimInches(row[at])!;
    add("roadway.curbToCurb", "Curb to curb", ft(cc), `"${row[at]}"`);
    const side = (part: string[]) => part.map(dimInches).reduce<number>((a, b) => a + (b ?? 0), 0);
    const left = side(row.slice(0, at));
    const right = side(row.slice(at + 1));
    const walks = /SIDEWALK|\bSW\.?\b|\bS\.W\./i.test([lines[ccRow - 1], lines[ccRow + 1], lines[ccRow + 2]].join(" "));
    if (walks && left > 0 && right > 0) {
      add("loads.sidewalks", "Sidewalks", [left, right].map((w) => ({ width: ft(w), thk: 6 })), `"${row.join(" | ")}"`, "Edge to curb face each side; thickness kept from the inputs (6 in if none).");
      add("roadway.curbFaceOffset", "Curb face in from the edge", Math.min(left, right), `"${row.join(" | ")}"`, left !== right ? "Inches. The sides differ: the narrower is used for both exterior girders." : "Inches.");
    }
  }

  // Diaphragms: their weight per girder from the unit spacing.
  const dia = find(/(\d+(?:\.\d+)?)"\s*x\s*(\d+(?:\.\d+)?)"\s*CONC\.?\s*DIAP/i);
  if (dia) {
    const s = values.find((v) => v.input === "units.spacing")?.value;
    if (typeof s === "number") {
      const kip = 0.15 * (Number(dia.m[1]) / 12) * (Number(dia.m[2]) / 12) * (s / 12);
      add("loads.diaphragmKip", "Diaphragms, per girder at midspan", +kip.toFixed(3), `"${dia.text}"`, `0.150 kcf × ${dia.m[1]}" × ${dia.m[2]}" × ${show(s)} unit spacing. Check that they're at midspan.`);
    } else findings.push(`Diaphragms "${dia.text}": enter their weight per girder under Dead loads (0.150 kcf × ${dia.m[1]}" × ${dia.m[2]}" × the unit spacing, which no callout gives).`);
  }

  const structure = lines.find((l) => /^[A-Z]{2,}[\w-]*\s?[\d.]+-[\w.]+$|^[A-Z]{3,}-[A-Z ]+$/.test(l)) ?? "";
  if (!values.length) findings.push("No callouts read: the sketch's dimensions have to be entered by hand.");
  return { format: "sketch", structure, date: name, values, findings };
}
