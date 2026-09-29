import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findAccessibleReference } from "@/lib/auth/session";

// Sections are split out of the manual in the browser (pdf.js) and sent in batches, so the
// server never parses the PDF and no single request gets too large.
const body = z.object({
  offset: z.number().int().min(0).max(100_000),
  sections: z
    .array(
      z.object({
        number: z.string().trim().max(40).nullable(),
        title: z.string().trim().min(1).max(300),
        page: z.number().int().min(1).max(100_000),
        text: z.string().max(20_000),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/references/[referenceId]/sections">) {
  const access = await findAccessibleReference((await ctx.params).referenceId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });
  if (access.reference.status !== "uploading") return Response.json({ error: "Already processed" }, { status: 409 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid sections" }, { status: 400 });
  const { offset, sections } = parsed.data;
  await db.referenceSection.createMany({
    data: sections.map((s, i) => ({ ...s, referenceId: access.reference.id, sortOrder: offset + i })),
  });
  return Response.json({ ok: true });
}
