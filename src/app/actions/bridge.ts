"use server";

import { gzipSync } from "node:zlib";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { analyzeBridge } from "@/lib/bridge/bridge";
import { BRIDGE_DEFAULTS, bridgeDefinition, type DesignLink } from "@/lib/bridge/definition";
import { designPrefill, designTargets } from "@/lib/bridge/design-links";
import { importedOf } from "@/lib/bridge/imported";
import { movingLoad } from "@/lib/bridge/moving";
import { bridgeCalcLines } from "@/lib/bridge/report";
import { ifcElements } from "@/lib/bridge/solids";
import { newModelFileKey, workerBridgeSolids, WorkerError, type WorkerSummary } from "@/lib/ifc/worker";
import { layout } from "@/lib/calcs/library/templates";
import { CALC_FILE, newCalcKey } from "@/lib/calcs/server";
import { emptyCalc } from "@/lib/calcs/types";
import { designBearing } from "@/lib/design/bearings/elastomeric";
import { designDeck } from "@/lib/design/decks/deck";
import { designGirder } from "@/lib/design/girders/prestressed";
import { designStripSeal } from "@/lib/design/joints/strip-seal";
import { bearingInputs, deckInputs, designInputs, girderInputs, stripSealInputs } from "@/lib/design/kinds";
import { columnInputs, designColumn } from "@/lib/design/piers/column";
import { db } from "@/lib/db";
import { deleteFiles, putFile } from "@/lib/storage";

const name = z.string().trim().min(1, "Give the bridge a name").max(200);

async function ownBridge(bridgeId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in first");
  const bridge = isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId } }) : null;
  if (!bridge) throw new Error("Bridge not found");
  return { user, bridge };
}

/** A new bridge with the wizard's defaults, opened. */
export async function createBridge() {
  const user = await requireUser();
  const count = await db.bridge.count({ where: { orgId: user.orgId } });
  const bridge = await db.bridge.create({ data: { orgId: user.orgId, name: `Bridge ${count + 1}`, definition: BRIDGE_DEFAULTS as unknown as Prisma.InputJsonValue, createdById: user.id } });
  revalidatePath("/bridges");
  redirect(`/bridges/${bridge.id}`);
}

/** The bridge's definition as it's edited (saved as you go). */
export async function saveBridgeDefinition(bridgeId: string, definition: unknown) {
  const { bridge } = await ownBridge(bridgeId);
  if (importedOf(bridge.definition)) throw new Error("An imported model has no definition to save");
  // The designs started from the bridge are kept as the server has them (they're added by createBridgeDesign).
  const kept = bridgeDefinition(bridge.definition);
  const next = { ...bridgeDefinition(definition), designs: kept.designs, ...(kept.ifcModelId ? { ifcModelId: kept.ifcModelId } : {}) };
  await db.bridge.update({ where: { id: bridge.id }, data: { definition: next as unknown as Prisma.InputJsonValue } });
}

export async function renameBridge(bridgeId: string, newName: string) {
  const { bridge } = await ownBridge(bridgeId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.bridge.update({ where: { id: bridge.id }, data: { name: parsed.data } });
  revalidatePath("/bridges", "layout");
}

export async function setBridgeProject(bridgeId: string, projectId: string | null) {
  const { user, bridge } = await ownBridge(bridgeId);
  const project = projectId && isUuid(projectId) ? await db.project.findFirst({ where: { id: projectId, orgId: user.orgId }, select: { id: true } }) : null;
  if (projectId && !project) throw new Error("Project not found");
  await db.bridge.update({ where: { id: bridge.id }, data: { projectId: project?.id ?? null } });
  revalidatePath("/bridges");
}

export async function deleteBridge(bridgeId: string) {
  const { bridge } = await ownBridge(bridgeId);
  await db.bridge.delete({ where: { id: bridge.id } });
  const file = importedOf(bridge.definition)?.fileKey;
  if (file) await deleteFiles([file]).catch(() => undefined);
  revalidatePath("/bridges");
}

/**
 * A design for one part of the bridge (its girders, deck, a line of bearings, a pier's columns, a
 * joint), started in the Design section with its inputs taken from the bridge's model and analysis.
 * Started again for the same part, it makes a new design from the bridge as it is now.
 */
export async function createBridgeDesign(bridgeId: string, targetKey: string): Promise<{ designId: string; designs: DesignLink[] }> {
  const { user, bridge } = await ownBridge(bridgeId);
  if (importedOf(bridge.definition)) throw new Error("Designs from an imported model are coming: its members need naming first");
  const definition = bridgeDefinition(bridge.definition);
  const target = designTargets(definition).find((t) => t.key === targetKey);
  if (!target) throw new Error("That part of the bridge has no design tool");
  const analysis = analyzeBridge(definition);
  const live = movingLoad(analysis.generated, analysis.stage(2));
  const { inputs, name } = designPrefill(target, definition, analysis, live);
  const design = await db.design.create({
    data: { orgId: user.orgId, projectId: bridge.projectId, kind: target.kind, name: `${bridge.name}: ${name}`, inputs: designInputs(target.kind, inputs) as unknown as Prisma.InputJsonValue, createdById: user.id },
  });
  const designs = [...definition.designs.filter((l) => l.target !== target.key), { id: design.id, target: target.key, kind: target.kind }];
  await db.bridge.update({ where: { id: bridge.id }, data: { definition: { ...definition, designs } as unknown as Prisma.InputJsonValue } });
  revalidatePath("/design");
  return { designId: design.id, designs };
}

export type BridgeDesignStatus = { id: string; target: string; name: string; ok: boolean | null };

/** The designs started from the bridge, each with whether its checks pass (null: it can't be worked out as entered; missing: deleted). */
export async function bridgeDesignStatus(bridgeId: string): Promise<BridgeDesignStatus[]> {
  const { user, bridge } = await ownBridge(bridgeId);
  const links = importedOf(bridge.definition) ? [] : bridgeDefinition(bridge.definition).designs;
  if (!links.length) return [];
  const designs = await db.design.findMany({ where: { orgId: user.orgId, id: { in: links.map((l) => l.id) } }, select: { id: true, kind: true, name: true, inputs: true } });
  return links.flatMap((l) => {
    const d = designs.find((x) => x.id === l.id);
    if (!d) return [];
    let ok: boolean | null = null;
    try {
      ok =
        d.kind === "lrfd-girder-check"
          ? designGirder(girderInputs(d.inputs)).ok
          : d.kind === "deck-slab"
            ? designDeck(deckInputs(d.inputs)).ok
            : d.kind === "elastomeric-bearing"
              ? designBearing(bearingInputs(d.inputs)).ok
              : d.kind === "pier-column"
                ? designColumn(columnInputs(d.inputs)).ok
                : d.kind === "strip-seal-joint"
                  ? designStripSeal(stripSealInputs(d.inputs)).ok
                  : null;
    } catch {
      ok = null;
    }
    return [{ id: d.id, target: l.target, name: d.name, ok }];
  });
}

/** The bridge's analysis written out as a Calcs worksheet, filed with the bridge's project. */
export async function createBridgeCalc(bridgeId: string): Promise<{ calcId: string }> {
  const { user, bridge } = await ownBridge(bridgeId);
  if (importedOf(bridge.definition)) throw new Error("The calc package is for bridges made with the wizard");
  const definition = bridgeDefinition(bridge.definition);
  const analysis = analyzeBridge(definition);
  if (!analysis.ok) throw new Error("The analysis isn't in equilibrium: no calc package was made");
  const live = movingLoad(analysis.generated, analysis.stage(2));
  const data = emptyCalc("USCS");
  const project = bridge.projectId ? await db.project.findUnique({ where: { id: bridge.projectId }, select: { name: true } }) : null;
  data.header = { ...data.header, title: `${bridge.name}: bridge analysis`, project: project?.name ?? "", by: user.name ?? "" };
  data.regions = layout(bridgeCalcLines(definition, analysis, live, bridge.name), { x: 0, y: 0 }, data.paper);
  const calc = await db.calc.create({ data: { orgId: user.orgId, projectId: bridge.projectId, name: `${bridge.name} analysis`, createdById: user.id } });
  const key = newCalcKey(calc.id);
  await putFile(key, gzipSync(JSON.stringify(data)), CALC_FILE);
  await db.calc.update({ where: { id: calc.id }, data: { fileKey: key, revision: 1, regionCount: data.regions.length } });
  revalidatePath("/calcs");
  return { calcId: calc.id };
}

/**
 * The bridge written as an IFC 4.3 model under its project's Models: its girders, deck, barriers,
 * diaphragms, bearings, pier caps and columns as bridge elements with their shapes and materials.
 * Exported again, the same model gets the bridge as it is now, as a new revision.
 */
export async function exportBridgeIfc(bridgeId: string): Promise<{ modelId: string; projectId: string; elements: number }> {
  const { user, bridge } = await ownBridge(bridgeId);
  if (importedOf(bridge.definition)) throw new Error("The IFC export is for bridges made with the wizard");
  if (!bridge.projectId) throw new Error("File the bridge under a project first (the project list at the top right): its 3D model goes to that project's Models");
  const project = await db.project.findFirst({ where: { id: bridge.projectId, orgId: user.orgId } });
  if (!project) throw new Error("Project not found");
  const definition = bridgeDefinition(bridge.definition);
  const elements = ifcElements(definition, analyzeBridge(definition).generated);
  const existing = definition.ifcModelId ? await db.ifcModel.findFirst({ where: { id: definition.ifcModelId, projectId: project.id } }) : null;
  const id = existing?.id ?? crypto.randomUUID();
  const fileKey = newModelFileKey(id);
  let made: { summary: WorkerSummary; size: number | null };
  try {
    made = await workerBridgeSolids(fileKey, { name: bridge.name, elements, location: project.latitude !== null && project.longitude !== null ? { lat: project.latitude, lon: project.longitude, heading: 0 } : undefined });
  } catch (e) {
    throw new Error(e instanceof WorkerError ? e.message : "The IFC engine couldn't write the model");
  }
  const data = { name: bridge.name, description: `Exported from the bridge "${bridge.name}" (Bridge section).`, fileKey, fileSize: made.size, summary: made.summary as unknown as Prisma.InputJsonValue, elementCount: made.summary.elements, editedAt: new Date() };
  if (existing) {
    await db.ifcModel.update({ where: { id }, data: { ...data, revision: existing.revision + 1, backupKey: existing.fileKey, backupRevision: existing.revision } });
    await deleteFiles([existing.backupKey]).catch(() => undefined);
  } else {
    await db.ifcModel.create({ data: { id, projectId: project.id, ...data, createdById: user.id } });
    await db.bridge.update({ where: { id: bridge.id }, data: { definition: { ...definition, ifcModelId: id } as unknown as Prisma.InputJsonValue } });
  }
  revalidatePath(`/projects/${project.id}`, "layout");
  return { modelId: id, projectId: project.id, elements: made.summary.elements };
}
