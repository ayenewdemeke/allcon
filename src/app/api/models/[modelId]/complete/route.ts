import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { startTranslation } from "@/lib/aps/derivative";
import { completeUpload, toUrn } from "@/lib/aps/oss";
import { findAccessibleModel } from "@/lib/session";

const body = z.object({ uploadKey: z.string().min(1) });

/** Called by the browser once all parts are uploaded: finalizes the object and starts translation. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/models/[modelId]/complete">) {
  const model = await findAccessibleModel((await ctx.params).modelId);
  if (!model) return Response.json({ error: "Not found" }, { status: 404 });
  if (model.status !== "uploading" || !model.objectKey) {
    return Response.json({ error: "Upload already completed" }, { status: 409 });
  }

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Missing uploadKey" }, { status: 400 });

  try {
    const { objectId } = await completeUpload(model.objectKey, parsed.data.uploadKey);
    const urn = toUrn(objectId);
    await startTranslation(urn);
    await db.modelVersion.update({
      where: { id: model.id },
      data: { urn, status: "translating", translationProgress: "0% complete" },
    });
    return Response.json({ status: "translating" });
  } catch (err) {
    console.error("Upload completion failed", err);
    await db.modelVersion.update({
      where: { id: model.id },
      data: { status: "failed", errorMessage: "Upload or translation request failed" },
    });
    return Response.json({ error: "Upload or translation request failed" }, { status: 502 });
  }
}
