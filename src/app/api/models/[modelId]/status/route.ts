import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getManifest } from "@/lib/aps/derivative";
import { findAccessibleModel } from "@/lib/auth/session";

/** Polled by the browser while a model translates; syncs the APS manifest into the database. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/models/[modelId]/status">) {
  let model = await findAccessibleModel((await ctx.params).modelId);
  if (!model) return Response.json({ error: "Not found" }, { status: 404 });

  if (model.status === "translating" && model.urn) {
    const manifest = await getManifest(model.urn);
    if (manifest) {
      const done = manifest.status === "success";
      const failed = manifest.status === "failed" || manifest.status === "timeout";
      model = await db.modelVersion.update({
        where: { id: model.id },
        data: {
          translationProgress: manifest.progress,
          // Translation done means the model can be viewed; elements are read next.
          status: done ? "extracting" : failed ? "failed" : "translating",
          errorMessage: failed ? manifest.messages.join("; ") || "Translation failed" : null,
        },
      });
    }
  }

  return Response.json({
    status: model.status,
    progress: model.translationProgress,
    error: model.errorMessage,
  });
}
