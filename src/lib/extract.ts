import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { normalizeElements, type RawObject, type TreeNode } from "@/lib/aps/normalize";
import { downloadBuffer, uploadBuffer } from "@/lib/aps/oss";
import { getAllProperties, getModelViewGuid, getObjectTree } from "@/lib/aps/properties";
import { applyAllRules } from "@/lib/mapping/server";

const INSERT_CHUNK = 500;

// A claim older than this is treated as abandoned (e.g. the server restarted mid-run).
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Marks the model as being extracted, unless another run already holds the claim.
 * Returns false when extraction is already in progress.
 */
export async function claimExtraction(modelVersionId: string) {
  const { count } = await db.modelVersion.updateMany({
    where: {
      id: modelVersionId,
      OR: [
        { extractionStartedAt: null },
        { extractionStartedAt: { lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) } },
      ],
    },
    data: { status: "extracting", extractionStartedAt: new Date(), errorMessage: null },
  });
  return count > 0;
}

type PropertyDump = { tree: TreeNode[]; collection: RawObject[] };

/**
 * The raw property data for a model version. The first read comes from Model Derivative and
 * is kept as one gzipped file in storage; later reads (re-extraction after we add a field or
 * fix the normalizer) come from that file instead of APS.
 */
async function loadPropertyDump(model: { id: string; projectId: string; urn: string; propertiesObjectKey: string | null }) {
  if (model.propertiesObjectKey) {
    try {
      return JSON.parse(gunzipSync(await downloadBuffer(model.propertiesObjectKey)).toString("utf8")) as PropertyDump;
    } catch (err) {
      console.warn("Stored property dump unreadable; fetching from Model Derivative again", err);
    }
  }

  const guid = await getModelViewGuid(model.urn);
  const [tree, collection] = await Promise.all([getObjectTree(model.urn, guid), getAllProperties(model.urn, guid)]);
  const dump: PropertyDump = { tree, collection };

  // Keeping the dump is an optimisation; failing to save it must not fail extraction.
  const objectKey = `${model.projectId}/models/${model.id}/properties.json.gz`;
  try {
    await uploadBuffer(objectKey, gzipSync(JSON.stringify(dump)));
    await db.modelVersion.update({ where: { id: model.id }, data: { propertiesObjectKey: objectKey } });
  } catch (err) {
    console.warn("Could not store the property dump", err);
  }
  return dump;
}

/**
 * Reads every element of a translated model and stores the slim rows valuation needs.
 * Safe to re-run: existing elements for the model version are replaced.
 * Call `claimExtraction` first.
 */
export async function extractElements(modelVersionId: string) {
  const model = await db.modelVersion.findUniqueOrThrow({ where: { id: modelVersionId } });
  if (!model.urn) throw new Error("Model has not been translated yet");

  try {
    const { tree, collection } = await loadPropertyDump({ ...model, urn: model.urn });
    const elements = normalizeElements(collection, tree);

    await db.element.deleteMany({ where: { modelVersionId: model.id } });
    for (let i = 0; i < elements.length; i += INSERT_CHUNK) {
      await db.element.createMany({
        data: elements.slice(i, i + INSERT_CHUNK).map((e) => ({ ...e, modelVersionId: model.id })),
      });
    }

    // Mappings survive revisions: the project's rules are re-applied to the new version.
    await applyAllRules(model.projectId, model.id);

    await db.modelVersion.update({
      where: { id: model.id },
      data: { status: "ready", elementCount: elements.length, extractionStartedAt: null },
    });
    return elements.length;
  } catch (err) {
    console.error("Element extraction failed", err);
    await db.modelVersion.update({
      where: { id: model.id },
      data: {
        status: "failed",
        extractionStartedAt: null,
        errorMessage: err instanceof Error ? err.message : "Element extraction failed",
      },
    });
    throw err;
  }
}
