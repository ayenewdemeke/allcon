import { describe, expect, it } from "vitest";
import { CalcDocument } from "./document";
import { emptyCalc, type CalcData, type Region } from "./types";

const math = (id: string, latex: string, y = 0): Region => ({ id, kind: "math", x: 0, y, latex });
const data = (regions: Region[]): CalcData => ({ ...emptyCalc("USCS"), regions });

describe("taking in others' changes", () => {
  it("keeps what's changed here and not saved, and takes the rest", () => {
    const doc = new CalcDocument(data([math("a", "a\\coloneq1"), math("b", "b\\coloneq2"), math("c", "c\\coloneq3")]));
    doc.put(math("a", "a\\coloneq10")); // changed here
    doc.remove("c"); // removed here
    doc.applyRemote({ ...data([math("a", "a\\coloneq99"), math("b", "b\\coloneq20"), math("c", "c\\coloneq30"), math("d", "d\\coloneq4")]), header: { ...emptyCalc().header, title: "Theirs" } });
    expect((doc.regions.get("a") as { latex: string }).latex).toBe("a\\coloneq10");
    expect((doc.regions.get("b") as { latex: string }).latex).toBe("b\\coloneq20");
    expect(doc.regions.has("c")).toBe(false);
    expect(doc.regions.has("d")).toBe(true);
    expect(doc.header.title).toBe("Theirs");
  });

  it("takes everything once what's here is saved, including removals", () => {
    const doc = new CalcDocument(data([math("a", "a\\coloneq1"), math("b", "b\\coloneq2")]));
    doc.put(math("a", "a\\coloneq10"));
    doc.markSaved(doc.editSeq);
    expect(doc.unsaved).toBe(false);
    doc.applyRemote(data([math("a", "a\\coloneq99")]));
    expect((doc.regions.get("a") as { latex: string }).latex).toBe("a\\coloneq99");
    expect(doc.regions.has("b")).toBe(false);
    expect(doc.unsaved).toBe(false);
  });

  it("keeps the header and settings when they're changed here", () => {
    const doc = new CalcDocument(data([]));
    doc.setMeta({ header: { ...doc.header, title: "Mine" } });
    doc.applyRemote({ ...data([]), header: { ...emptyCalc().header, title: "Theirs" } });
    expect(doc.header.title).toBe("Mine");
  });
});
