import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { planReviewEnabled } from "@/lib/env";
import { findAccessibleReview } from "@/lib/auth/session";
import { reviewSheetWithClaude, type Excerpt } from "@/lib/review/claude";
import { boxOfLines } from "@/lib/review/lines";
import { rankSections } from "@/lib/review/retrieve";
import { toIssueView } from "@/lib/review/types";
import { sheetName } from "@/lib/sheets/export-data";

// A review of one sheet can take a minute; it runs as its own request so a long set is
// never one long-running call.
export const maxDuration = 300;

const EXCERPT_BUDGET_CHARS = 32_000; // ~8k tokens of manual text per sheet

// The browser reads the sheet with pdf.js and sends its text lines and a JPEG of the page.
const body = z.object({
  lines: z
    .array(
      z.object({
        id: z.number().int().min(1),
        text: z.string().max(400),
        box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      }),
    )
    .max(800),
  image: z.string().max(4_000_000).nullable(), // base64 JPEG
});

// Section texts per manual, kept warm between sheets of the same run.
const sectionCache = new Map<string, { at: number; sections: (Excerpt & { sectionId: string; referenceId: string })[] }>();
async function sectionsOf(reference: { id: string; title: string; uploadedAt: Date }) {
  const hit = sectionCache.get(reference.id);
  if (hit && hit.at > reference.uploadedAt.getTime() && Date.now() - hit.at < 30 * 60_000) return hit.sections;
  const rows = await db.referenceSection.findMany({ where: { referenceId: reference.id }, orderBy: { sortOrder: "asc" } });
  const sections = rows.map((r) => ({
    id: r.id,
    sectionId: r.id,
    referenceId: reference.id,
    source: reference.title,
    number: r.number,
    title: r.title,
    page: r.page,
    text: r.text,
  }));
  sectionCache.set(reference.id, { at: Date.now(), sections });
  return sections;
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/reviews/[reviewId]/sheets/[sheetId]">) {
  const { reviewId, sheetId } = await ctx.params;
  const access = await findAccessibleReview(reviewId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });
  const { review } = access;
  if (!planReviewEnabled()) return Response.json({ error: "Plan review isn't set up: ANTHROPIC_API_KEY is missing" }, { status: 503 });

  const sheet = await db.sheet.findFirst({ where: { id: sheetId, drawingSetId: review.drawingSetId } });
  if (!sheet) return Response.json({ error: "Sheet not found" }, { status: 404 });
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid sheet data" }, { status: 400 });
  const { lines, image } = parsed.data;

  const references = await db.reference.findMany({
    where: { id: { in: review.referenceIds }, orgId: access.user.orgId, status: "ready" },
  });
  const all = (await Promise.all(references.map(sectionsOf))).flat();
  const excerpts = rankSections(lines.map((l) => l.text).join("\n"), all, EXCERPT_BUDGET_CHARS).map((s, i) => ({ ...s, id: `E${i + 1}` }));

  await db.reviewSheet.upsert({
    where: { reviewId_sheetId: { reviewId, sheetId } },
    create: { reviewId, sheetId, status: "running" },
    update: { status: "running", error: null, reviewedAt: new Date() },
  });

  let result: Awaited<ReturnType<typeof reviewSheetWithClaude>>;
  try {
    result = await reviewSheetWithClaude({
      sheetName: sheetName(sheet),
      setName: review.drawingSet.fileName,
      lines,
      imageJpegBase64: image,
      excerpts,
    });
  } catch (err) {
    const message =
      err instanceof Anthropic.RateLimitError
        ? "Rate limited by the AI service; wait a minute and retry"
        : err instanceof Anthropic.AuthenticationError
          ? "The Anthropic API key was rejected"
          : err instanceof Anthropic.BadRequestError
            ? // e.g. "Your credit balance is too low..." — worth showing as is
              ((err.error as { error?: { message?: string } } | undefined)?.error?.message ?? "The AI service rejected the request")
            : err instanceof Anthropic.APIError
              ? `AI service error (${err.status ?? "network"})`
              : err instanceof Error
                ? err.message
                : "Review failed";
    console.error("Sheet review failed", err);
    await db.reviewSheet.update({ where: { reviewId_sheetId: { reviewId, sheetId } }, data: { status: "failed", error: message } });
    return Response.json({ error: message }, { status: 502 });
  }

  const byExcerpt = new Map(excerpts.map((e) => [e.id, e]));
  const lineText = new Map(lines.map((l) => [l.id, l.text]));
  await db.$transaction([
    // A re-run replaces the suggestions nobody has acted on; kept and dismissed stay.
    db.reviewIssue.deleteMany({ where: { reviewId, sheetId, status: "suggested" } }),
    db.reviewIssue.createMany({
      data: result.issues.map((f) => {
        const e = f.excerpt_id ? byExcerpt.get(f.excerpt_id) : undefined;
        const box = boxOfLines(lines, f.line_ids);
        const quote = f.line_ids.map((id) => lineText.get(id)).filter(Boolean).join(" / ").slice(0, 500);
        return {
          reviewId,
          sheetId,
          title: f.title.slice(0, 200),
          detail: f.detail.slice(0, 2000),
          severity: f.severity,
          quote: quote || null,
          box: box ?? undefined,
          referenceId: e?.referenceId ?? null,
          sectionId: e?.sectionId ?? null,
          citation: e ? `${e.source} §${[e.number, e.title].filter(Boolean).join(" ")}` : null,
        };
      }),
    }),
    db.reviewSheet.update({
      where: { reviewId_sheetId: { reviewId, sheetId } },
      data: { status: "done", error: null, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd, reviewedAt: new Date() },
    }),
  ]);

  const issues = await db.reviewIssue.findMany({
    where: { reviewId, sheetId },
    orderBy: { createdAt: "asc" },
    include: { section: { select: { page: true } } },
  });
  return Response.json({ issues: issues.map(toIssueView), costUsd: result.costUsd });
}
