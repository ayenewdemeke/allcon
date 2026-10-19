import "server-only";
import { compileIfc } from "@/lib/ifc/compile";
import { modelSpecSchema } from "@/lib/ifc/spec";
import { gunzipIfc } from "@/lib/ifc/worker";

type StoredModel = { id: string; name: string; kind: string; spec: unknown; ifcGz: Uint8Array | null; revision: number };

/** A model's current revision as IFC text: stored for detailed models, compiled for conkit's format. */
export function modelIfcText(model: StoredModel, author?: string | null) {
  return model.kind === "ifc" && model.ifcGz
    ? gunzipIfc(model.ifcGz)
    : compileIfc(modelSpecSchema.parse(model.spec), { modelId: model.id, name: model.name, author: author || undefined }).text;
}

/** The IFC as an HTTP response, inline for the viewer or as a download. */
export function ifcResponse(model: StoredModel, text: string, download: boolean) {
  const fileName = `${model.name.replace(/[^\w.-]+/g, "_")}-r${model.revision}.ifc`;
  return new Response(text, {
    headers: {
      "Content-Type": "application/x-step; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
