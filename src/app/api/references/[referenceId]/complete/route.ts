import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { completeUpload } from "@/lib/aps/oss";
import { findAccessibleReference } from "@/lib/auth/session";

const body = z.object({ uploadKey: z.string().min(1), pageCount: z.number().int().min(1).max(100_000) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/references/[referenceId]/complete">) {
  const access = await findAccessibleReference((await ctx.params).referenceId);
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });
  const { reference } = access;
  if (reference.status !== "uploading" || !reference.objectKey) {
    return Response.json({ error: "Upload already completed" }, { status: 409 });
  }
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  try {
    await completeUpload(reference.objectKey, parsed.data.uploadKey);
    await db.reference.update({ where: { id: reference.id }, data: { status: "ready", pageCount: parsed.data.pageCount } });
    return Response.json({ status: "ready" });
  } catch (err) {
    console.error("Reference upload completion failed", err);
    await db.reference.update({ where: { id: reference.id }, data: { status: "failed" } });
    return Response.json({ error: "Could not finish the upload" }, { status: 502 });
  }
}
