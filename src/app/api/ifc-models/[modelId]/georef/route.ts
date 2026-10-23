import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { workerSummary } from "@/lib/ifc/worker";
import { georefChecked, modelPlacement } from "@/lib/maps/placement";

/**
 * Where the model sits on the map. Models summarized before georeferencing was read get
 * their IFC read again for it (once), so the map can use the model's own location.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/ifc-models/[modelId]/georef">) {
  const { modelId } = await ctx.params;
  const user = await getCurrentUser();
  const model =
    user && isUuid(modelId)
      ? await db.ifcModel.findFirst({
          where: { id: modelId, project: { orgId: user.orgId } },
          select: { id: true, fileKey: true, summary: true, placement: true, project: { select: { latitude: true, longitude: true } } },
        })
      : null;
  if (!model) return Response.json({ error: "Not found" }, { status: 404 });

  let summary = model.summary;
  if (!georefChecked(summary)) {
    try {
      const fresh = await workerSummary(model.fileKey);
      summary = fresh as unknown as typeof summary;
      // Only if the file is still the one read.
      await db.ifcModel.updateMany({ where: { id: model.id, fileKey: model.fileKey }, data: { summary: fresh as unknown as object } });
    } catch (err) {
      console.error("Could not read a model's georeferencing", err);
    }
  }
  return Response.json({ placement: modelPlacement({ placement: model.placement, summary }, model.project) });
}
