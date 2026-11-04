import "server-only";
import { db } from "@/lib/db";
import { rankSections } from "@/lib/review/retrieve";
import type { ToolContext } from "./context";

const EXCERPT_CHARS = 2500;

/** Library sections matching a query, best first, with what's needed to cite them. */
export async function searchManuals(ctx: ToolContext, query: string, referenceId?: string, limit = 6) {
  const references = await db.reference.findMany({
    where: { orgId: ctx.orgId, status: "ready", ...(referenceId ? { id: referenceId } : {}) },
    select: { id: true, title: true },
  });
  if (!references.length) return { results: [], note: "The library has no manuals yet. Add one on the Library page in allcon." };
  const titles = new Map(references.map((r) => [r.id, r.title]));
  const sections = await db.referenceSection.findMany({
    where: { referenceId: { in: references.map((r) => r.id) } },
    select: { id: true, referenceId: true, number: true, title: true, page: true, text: true },
  });
  const ranked = rankSections(query, sections, Number.POSITIVE_INFINITY, Math.min(Math.max(limit, 1), 15));
  return {
    results: ranked.map((s) => ({
      manual: titles.get(s.referenceId),
      section: [s.number, s.title].filter(Boolean).join(" "),
      citation: `${titles.get(s.referenceId)} §${[s.number, s.title].filter(Boolean).join(" ")}`,
      page: s.page,
      text: s.text.length > EXCERPT_CHARS ? `${s.text.slice(0, EXCERPT_CHARS)}…` : s.text,
      link: `/api/references/${s.referenceId}/pdf#page=${s.page}`,
    })),
    manuals: references.map((r) => r.title),
  };
}
