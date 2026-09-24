import type { NextRequest } from "next/server";
import { claimExtraction, extractElements } from "@/lib/extract";
import { findAccessibleModel } from "@/lib/session";

// Reading every property of a large model takes a while.
export const maxDuration = 300;

/** Pulls elements out of a translated model. Triggered by the client once translation finishes. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/models/[modelId]/extract">) {
  const model = await findAccessibleModel((await ctx.params).modelId);
  if (!model) return Response.json({ error: "Not found" }, { status: 404 });
  if (!model.urn) return Response.json({ error: "Model has not been translated" }, { status: 409 });
  if (model.status === "ready" && model.elementCount !== null) {
    return Response.json({ status: "ready", elementCount: model.elementCount });
  }

  if (!(await claimExtraction(model.id))) {
    return Response.json({ status: "extracting" }, { status: 202 });
  }

  try {
    const elementCount = await extractElements(model.id);
    return Response.json({ status: "ready", elementCount });
  } catch {
    return Response.json({ error: "Could not read elements from this model" }, { status: 502 });
  }
}
