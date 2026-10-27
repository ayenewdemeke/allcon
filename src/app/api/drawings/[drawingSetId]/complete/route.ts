import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { completeUpload } from "@/lib/aps/oss";
import { findAccessibleDrawingSet } from "@/lib/auth/session";

const MAX_PAGES = 5000;

// Page facts are read in the browser with pdf.js while the file uploads, so the server
// never has to download or parse the PDF. Sheets published from drafting also know their
// scale (from their viewports), so they arrive calibrated.
const body = z.object({
  uploadKey: z.string().min(1),
  pages: z
    .array(
      z.object({
        width: z.number().positive().max(100_000),
        height: z.number().positive().max(100_000),
        number: z.string().trim().max(40).nullish(),
        title: z.string().trim().max(200).nullish(),
        metersPerPoint: z.number().positive().max(1e6).nullish(),
        scaleLabel: z.string().trim().max(60).nullish(),
      }),
    )
    .min(1)
    .max(MAX_PAGES),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/drawings/[drawingSetId]/complete">) {
  const access = await findAccessibleDrawingSet((await ctx.params).drawingSetId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });
  const { drawingSet } = access;
  if (drawingSet.status !== "uploading" || !drawingSet.objectKey) {
    return Response.json({ error: "Upload already completed" }, { status: 409 });
  }

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid page data" }, { status: 400 });
  const { uploadKey, pages } = parsed.data;

  try {
    await completeUpload(drawingSet.objectKey, uploadKey);
    await db.$transaction([
      db.sheet.createMany({
        data: pages.map((p, pageIndex) => ({
          drawingSetId: drawingSet.id,
          pageIndex,
          width: p.width,
          height: p.height,
          number: p.number || null,
          title: p.title || null,
          metersPerPoint: p.metersPerPoint ?? null,
          scaleLabel: p.metersPerPoint ? p.scaleLabel || null : null,
        })),
      }),
      db.drawingSet.update({
        where: { id: drawingSet.id },
        data: { status: "ready", pageCount: pages.length },
      }),
    ]);
    return Response.json({ status: "ready", pageCount: pages.length });
  } catch (err) {
    console.error("Drawing upload completion failed", err);
    await db.drawingSet.update({ where: { id: drawingSet.id }, data: { status: "failed" } });
    return Response.json({ error: "Could not finish the upload" }, { status: 502 });
  }
}
