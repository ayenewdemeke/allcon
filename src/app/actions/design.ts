"use server";

import { gzipSync } from "node:zlib";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isUuid, requireUser } from "@/lib/auth/session";
import { layout } from "@/lib/calcs/library/templates";
import { CALC_FILE, newCalcKey } from "@/lib/calcs/server";
import { emptyCalc } from "@/lib/calcs/types";
import { bearingCalcLines } from "@/lib/design/bearings/elastomeric-calc";
import { deckCalcLines } from "@/lib/design/decks/deck-calc";
import { haunchCalcLines } from "@/lib/design/girders/haunch-calc";
import { toConfirm } from "@/lib/design/girders/from-plans";
import { girderCalcLines } from "@/lib/design/girders/prestressed-calc";
import { stripSealCalcLines } from "@/lib/design/joints/strip-seal-calc";
import { collisionCalcLines } from "@/lib/design/piers/collision-calc";
import { dtRatingCalcLines } from "@/lib/design/rating/double-tee-calc";
import { missingInputs } from "@/lib/design/rating/sources";
import { bearingInputs, cbcInputs, cipInputs, collisionInputs, deckInputs, designInputs, dtRatingInputs, girderInputs, haunchInputs, kindInfo, mseInputs, ptfeInputs, signInputs, stripSealInputs, wingwallInputs, zone1Inputs } from "@/lib/design/kinds";
import { signCalcLines } from "@/lib/design/signs/cantilever-calc";
import { columnInputs, type ColumnLink } from "@/lib/design/piers/column";
import { columnCalcLines } from "@/lib/design/piers/column-calc";
import { columnLinkFrom } from "@/lib/design/piers/column-link";
import { zone1CalcLines } from "@/lib/design/seismic/zone1-calc";
import { cbcCalcLines } from "@/lib/design/culverts/cbc-calc";
import { bearingFigures, capDetailFigures, takeoffFigures, cbcFigures, cipFigures, collisionFigures, columnFigures, deckFigures, dtFigures, girderFigures, haunchFigures, mseFigures, signFigures, stmFigures, stripSealFigures, wingwallFigures } from "@/lib/design/figures";
import { girderSide, type GirderSide } from "@/lib/design/stm/cap-loads";
import { nodeLpSolver } from "@/lib/design/stm/lp-node";
import { designStm, stmInputs, type StmInputs } from "@/lib/design/stm/strut-tie";
import { capDetailOrNull, capWhat, stmPackageLines, stmPayLines, stmQuantityLines } from "@/lib/design/stm/package";
import { takeoffFor, takeoffPayLines, TAKEOFF_KINDS, type TakeoffSettings } from "@/lib/design/takeoff";
import { takeoffQuantityLines } from "@/lib/design/takeoff/calc";
import { cipCalcLines } from "@/lib/design/walls/cip-calc";
import { mseCalcLines } from "@/lib/design/walls/mse-calc";
import { wingwallCalcLines } from "@/lib/design/walls/wingwall-calc";
import { agencyRulesOf } from "@/lib/design/agency";
import { db } from "@/lib/db";
import { deleteFiles, putFile } from "@/lib/storage";

const name = z.string().trim().min(1, "Give the design a name").max(200);

async function ownDesign(designId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(designId)) throw new Error("Design not found");
  const design = await db.design.findFirst({ where: { id: designId, orgId: user.orgId } });
  if (!design) throw new Error("Design not found");
  return { user, design };
}

async function orgProject(orgId: string, projectId: unknown) {
  if (typeof projectId !== "string" || !isUuid(projectId)) return null;
  return db.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
}

/** A new design of a kind, with its default inputs, opened. */
export async function createDesign(kind: string, projectId: string | null) {
  const user = await requireUser();
  const info = kindInfo(kind);
  if (!info?.available) throw new Error("That design type isn't available yet");
  if (info.agency && agencyRulesOf(user.agency) !== info.agency) throw new Error("Turn on CDOT's rules (Design → Agency rules) to start this design");
  const project = await orgProject(user.orgId, projectId);
  const count = await db.design.count({ where: { orgId: user.orgId, kind } });
  const design = await db.design.create({
    data: { orgId: user.orgId, projectId: project?.id ?? null, kind, name: `${info.name} ${count + 1}`, inputs: designInputs(kind, {}) as unknown as Prisma.InputJsonValue, createdById: user.id },
  });
  revalidatePath("/design");
  redirect(`/design/${design.id}`);
}

/** The person's agency rules in Design: AASHTO only, or an agency's criteria, standards, pay items and tools too. */
export async function setAgencyRules(rules: string) {
  const user = await requireUser();
  const value = agencyRulesOf(rules);
  await db.user.update({ where: { id: user.id }, data: { agency: value === "none" ? null : value } });
  revalidatePath("/design", "layout");
}

/**
 * A new design of another kind started from this one's results (e.g. the girder check's camber
 * into Camber and Haunch), filed under the same project. Returns its id; the editor opens it.
 */
export async function createLinkedDesign(fromDesignId: string, kind: string, inputs: Record<string, unknown>): Promise<{ designId: string }> {
  const { user, design: from } = await ownDesign(fromDesignId);
  const info = kindInfo(kind);
  if (!info?.available) throw new Error("That design type isn't available yet");
  const design = await db.design.create({
    data: { orgId: user.orgId, projectId: from.projectId, kind, name: `${info.name} for ${from.name}`.slice(0, 200), inputs: designInputs(kind, inputs) as unknown as Prisma.InputJsonValue, createdById: user.id },
  });
  revalidatePath("/design");
  return { designId: design.id };
}

/** The girder designs a pier cap can take its loads from: each with its spans. */
export async function listGirderDesigns(): Promise<{ id: string; name: string; spans: number[] }[]> {
  const user = await requireUser();
  const rows = await db.design.findMany({ where: { orgId: user.orgId, kind: "lrfd-girder-check" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, inputs: true }, take: 200 });
  return rows.map((d) => {
    const g = girderInputs(d.inputs);
    return { id: d.id, name: d.name, spans: [g.L, ...g.extraSpans.map((s) => s.L)] };
  });
}

/** A girder design's girders and dead load reactions at the end of one of its spans, copied for a cap. */
export async function girderReactions(designId: string, span: number, end: "start" | "end" = "end"): Promise<GirderSide> {
  const user = await requireUser();
  if (!isUuid(designId)) throw new Error("Design not found");
  const d = await db.design.findFirst({ where: { id: designId, orgId: user.orgId, kind: "lrfd-girder-check" }, select: { id: true, name: true, inputs: true } });
  if (!d) throw new Error("Design not found");
  return girderSide(girderInputs(d.inputs), span, d.id, d.name, end === "start" ? "start" : "end");
}

/** The strut-and-tie designs built from a standard pier cap, for a pier column to take its loads from. */
export async function listPierCapDesigns(): Promise<{ id: string; name: string; kind: string; columns: number }[]> {
  const user = await requireUser();
  const rows = await db.design.findMany({ where: { orgId: user.orgId, kind: "stm-d-region" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, inputs: true }, take: 200 });
  return rows.flatMap((d) => {
    const t = stmInputs(d.inputs).template;
    return t && t.kind !== "abutment" ? [{ id: d.id, name: d.name, kind: t.kind, columns: t.columns.length }] : [];
  });
}

/** A pier cap's load cases and geometry, and its bridge's data from the girder designs, copied for a pier column. */
export async function pierCapLink(stmId: string): Promise<ColumnLink> {
  const user = await requireUser();
  if (!isUuid(stmId)) throw new Error("Design not found");
  const d = await db.design.findFirst({ where: { id: stmId, orgId: user.orgId, kind: "stm-d-region" }, select: { id: true, name: true, inputs: true } });
  if (!d) throw new Error("Design not found");
  const i = stmInputs(d.inputs);
  const ids = [i.girders?.back?.designId, i.girders?.ahead?.designId].filter((x): x is string => !!x && isUuid(x));
  const girders = new Map<string, ReturnType<typeof girderInputs>>();
  if (ids.length) for (const g of await db.design.findMany({ where: { id: { in: ids }, orgId: user.orgId, kind: "lrfd-girder-check" }, select: { id: true, inputs: true } })) girders.set(g.id, girderInputs(g.inputs));
  try {
    return columnLinkFrom(d.id, d.name, i, girders);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Could not read the cap's loads");
  }
}

/** The design's inputs as they're edited (saved as you go). */
export async function saveDesignInputs(designId: string, inputs: unknown) {
  const { design } = await ownDesign(designId);
  const parsed = z.record(z.string(), z.unknown()).safeParse(inputs);
  if (!parsed.success) throw new Error("Invalid inputs");
  const clean = kindInfo(design.kind) ? designInputs(design.kind, parsed.data) : parsed.data;
  await db.design.update({ where: { id: design.id }, data: { inputs: clean as unknown as Prisma.InputJsonValue } });
}

export async function renameDesign(designId: string, newName: string) {
  const { design } = await ownDesign(designId);
  const parsed = name.safeParse(newName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  await db.design.update({ where: { id: design.id }, data: { name: parsed.data } });
  revalidatePath("/design", "layout");
}

export async function setDesignProject(designId: string, projectId: string | null) {
  const { user, design } = await ownDesign(designId);
  const project = projectId ? await orgProject(user.orgId, projectId) : null;
  if (projectId && !project) throw new Error("Project not found");
  await db.design.update({ where: { id: design.id }, data: { projectId: project?.id ?? null } });
  revalidatePath("/design");
}

/** The files a design's inputs point to (its attachments), only under its own folder. */
const designFiles = (designId: string, inputs: unknown) => [...new Set(JSON.stringify(inputs ?? null).match(new RegExp(`designs/${designId}/attachments/[\\w-]+\\.(?:png|jpg|webp)`, "g")) ?? [])];

export async function deleteDesign(designId: string) {
  const { design } = await ownDesign(designId);
  await db.design.delete({ where: { id: design.id } });
  await deleteFiles(designFiles(design.id, design.inputs)).catch((e) => console.error("Could not delete a design's files", e));
  revalidatePath("/design");
}

/** Deletes attachments no longer used (a sketch replaced or removed): only the design's own files that its saved inputs don't use. */
export async function deleteDesignAttachments(designId: string, keys: string[]) {
  const { design } = await ownDesign(designId);
  const inUse = new Set(designFiles(design.id, design.inputs));
  const own = new RegExp(`^designs/${design.id}/attachments/[\\w-]+\\.(png|jpg|webp)$`);
  await deleteFiles(keys.filter((k) => typeof k === "string" && own.test(k) && !inUse.has(k)));
}

/**
 * A design's quantities into its project's line items: a heading for the design with a line per
 * pay item under it (the pay item's number, description and unit: generic MasterFormat or the agency's). Pushed again, the same
 * heading's lines are updated in place (their rates kept), lines no longer produced removed.
 */
export async function pushDesignQuantities(designId: string, payItems: Partial<Record<string, string>>): Promise<{ headingId: string; lines: { code: string; description: string; unit: string; quantity: number }[] }> {
  const { design } = await ownDesign(designId);
  if (!design.projectId) throw new Error("File the design under a project first: its quantities go to that project's line items");
  let lines: { code: string; description: string; unit: string; quantity: number }[];
  let label: string;
  let oldHeading: string | null | undefined;
  if (design.kind === "stm-d-region") {
    const i = stmInputs(design.inputs);
    const d = capDetailOrNull(i);
    if (!d) throw new Error("Build the model from a standard cap first: its bars are detailed from it");
    lines = stmPayLines({ ...i, payItems: { ...i.payItems, ...payItems } as StmInputs["payItems"] }, d).lines;
    label = capWhat(i);
    oldHeading = i.payItems?.headingId;
  } else if (TAKEOFF_KINDS.includes(design.kind)) {
    const i = designInputs(design.kind, design.inputs) as { takeoff?: TakeoffSettings };
    const t = takeoffFor(design.kind, i, i.takeoff);
    if (!t) throw new Error("This design has no quantities yet");
    lines = takeoffPayLines(design.kind, t, payItems, i, i.takeoff?.agency);
    label = t.what;
    oldHeading = i.takeoff?.headingId;
  } else throw new Error("Pushing quantities for this design type is coming");
  if (!lines.length) throw new Error("This design has no quantities to push");
  const projectId = design.projectId;
  const description = `${design.name} (${label})`;
  const headingId = await db.$transaction(async (tx) => {
    let heading = oldHeading && isUuid(oldHeading) ? await tx.lineItem.findFirst({ where: { id: oldHeading, projectId, isHeading: true } }) : null;
    if (heading) await tx.lineItem.update({ where: { id: heading.id }, data: { description } });
    else {
      const last = await tx.lineItem.aggregate({ where: { projectId }, _max: { sortOrder: true } });
      heading = await tx.lineItem.create({ data: { projectId, description, isHeading: true, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
    }
    const existing = await tx.lineItem.findMany({ where: { parentId: heading.id } });
    for (const [k, l] of lines.entries()) {
      const same = existing.find((e) => e.code === l.code);
      const data = { code: l.code, description: l.description, unit: l.unit, contractQuantity: new Prisma.Decimal(l.quantity), billingType: "unit_price" as const };
      if (same) await tx.lineItem.update({ where: { id: same.id }, data });
      else await tx.lineItem.create({ data: { ...data, projectId, parentId: heading.id, sortOrder: heading.sortOrder + k + 1 } });
    }
    const stale = existing.filter((e) => !lines.some((l) => l.code === e.code)).map((e) => e.id);
    if (stale.length) await tx.lineItem.deleteMany({ where: { id: { in: stale } } });
    // Keep the pushed lines with their heading: the project's later lines move down.
    await tx.lineItem.updateMany({ where: { projectId, sortOrder: { gt: heading.sortOrder }, NOT: { OR: [{ parentId: heading.id }, { id: heading.id }] } }, data: { sortOrder: { increment: lines.length } } });
    return heading.id;
  });
  // The design keeps its pay items and heading, so a push again updates the same lines.
  const saved = design.inputs as Record<string, unknown>;
  const next = design.kind === "stm-d-region" ? { ...saved, payItems: { ...((saved.payItems as object) ?? {}), ...payItems, headingId } } : { ...saved, takeoff: { ...((saved.takeoff as object) ?? {}), items: payItems, headingId } };
  await db.design.update({ where: { id: design.id }, data: { inputs: next as unknown as Prisma.InputJsonValue } });
  revalidatePath(`/projects/${projectId}`, "layout");
  return { headingId, lines };
}

/** The design written out as a Calcs worksheet (the calc package), filed with the design. */
export async function createCalcFromDesign(designId: string, variant?: "quantities"): Promise<{ calcId: string }> {
  const { user, design } = await ownDesign(designId);
  // A design started from plans makes a calc package only once every value is confirmed.
  if (design.kind === "lrfd-girder-check" && toConfirm(girderInputs(design.inputs).fromPlans).length > 0) throw new Error("Confirm the values from the plans first");
  // A rating makes a calc package only once every input it needs has a source.
  if (design.kind === "dt-load-rating" && missingInputs(dtRatingInputs(design.inputs)).length > 0) throw new Error("Enter the bridge's remaining inputs first");
  // The editor's sketches go in as pictures (or the calc goes without them if one can't be drawn).
  const figures = <T>(draw: () => T) => {
    try {
      return draw();
    } catch (e) {
      console.error("Could not draw the design's figures", e);
      return undefined;
    }
  };
  // A strut-and-tie model is solved (HiGHS, asynchronously) before it's written out.
  // A strut-and-tie design's quantity sheet: its bars as detailed, and its concrete.
  const quantities = variant === "quantities";
  if (quantities && design.kind !== "stm-d-region" && !TAKEOFF_KINDS.includes(design.kind)) throw new Error("Quantity sheets for this design type are coming");
  // Any other tool's quantity sheet: its take-off.
  const takeoffLines =
    quantities && design.kind !== "stm-d-region"
      ? (() => {
          const i = designInputs(design.kind, design.inputs) as { takeoff?: TakeoffSettings };
          const t = takeoffFor(design.kind, i, i.takeoff);
          if (!t) throw new Error("This design has no quantities yet");
          return takeoffQuantityLines(design.kind, t, design.name, i.takeoff?.items ?? {}, i, figures(() => takeoffFigures(t)));
        })()
      : null;
  const stmLines =
    design.kind === "stm-d-region"
      ? await (async () => {
          const i = stmInputs(design.inputs);
          const d = capDetailOrNull(i);
          if (quantities) {
            if (!d) throw new Error("Build the model from a standard cap first: its bars are detailed from it");
            return stmQuantityLines(i, design.name, figures(() => capDetailFigures(d)));
          }
          const r = await designStm(i, nodeLpSolver);
          return stmPackageLines(i, r, design.name, { ...figures(() => stmFigures(r)), ...(d ? figures(() => capDetailFigures(d)) : {}) });
        })()
      : null;
  const lines = takeoffLines ?? stmLines ??
    (design.kind === "dt-load-rating"
      ? dtRatingCalcLines(dtRatingInputs(design.inputs), design.name, figures(() => dtFigures(dtRatingInputs(design.inputs))))
      : design.kind === "lrfd-girder-check"
      ? girderCalcLines(girderInputs(design.inputs), design.name, figures(() => girderFigures(girderInputs(design.inputs))))
      : design.kind === "cip-cantilever-wall"
      ? cipCalcLines(cipInputs(design.inputs), design.name, figures(() => cipFigures(cipInputs(design.inputs))))
      : design.kind === "mse-wall"
        ? mseCalcLines(mseInputs(design.inputs), design.name, figures(() => mseFigures(mseInputs(design.inputs))))
        : design.kind === "box-culvert"
          ? cbcCalcLines(cbcInputs(design.inputs), design.name, figures(() => cbcFigures(cbcInputs(design.inputs))))
          : design.kind === "elastomeric-bearing"
            ? bearingCalcLines(bearingInputs(design.inputs), design.name, figures(() => bearingFigures(bearingInputs(design.inputs))))
            : design.kind === "cantilever-wingwall"
              ? wingwallCalcLines(wingwallInputs(design.inputs), design.name, figures(() => wingwallFigures(wingwallInputs(design.inputs))))
              : design.kind === "deck-slab"
                ? deckCalcLines(deckInputs(design.inputs), design.name, figures(() => deckFigures(deckInputs(design.inputs))))
                : design.kind === "seismic-zone1"
                  ? zone1CalcLines(zone1Inputs(design.inputs), design.name)
                  : design.kind === "pier-column"
                    ? columnCalcLines(columnInputs(design.inputs), design.name, figures(() => columnFigures(columnInputs(design.inputs))))
                    : design.kind === "pier-collision"
                    ? collisionCalcLines(collisionInputs(design.inputs), design.name, figures(() => collisionFigures(collisionInputs(design.inputs))))
                    : design.kind === "camber-haunch"
                      ? haunchCalcLines(haunchInputs(design.inputs), design.name, figures(() => haunchFigures(haunchInputs(design.inputs))))
                      : design.kind === "sign-cantilever"
                        ? signCalcLines(signInputs(design.inputs), design.name, figures(() => signFigures(signInputs(design.inputs))))
                        : design.kind === "ptfe-bearing"
                          ? bearingCalcLines(ptfeInputs(design.inputs), design.name, figures(() => bearingFigures(ptfeInputs(design.inputs))))
                          : design.kind === "strip-seal-joint"
                            ? stripSealCalcLines(stripSealInputs(design.inputs), design.name, figures(() => stripSealFigures(stripSealInputs(design.inputs))))
                            : null);
  if (!lines) throw new Error("Calc packages for this design type are coming");
  const data = emptyCalc("USCS");
  // The header filled in as far as the design knows it: its project, and for a rating, the rater and checker.
  const project = design.projectId ? await db.project.findUnique({ where: { id: design.projectId }, select: { name: true } }) : null;
  const rating = design.kind === "dt-load-rating" ? dtRatingInputs(design.inputs).bridge : null;
  data.header = { ...data.header, title: design.name, project: project?.name ?? "", by: rating?.rater.trim() || user.name || "", checked: rating?.checker.trim() ?? "" };
  data.regions = layout(lines, { x: 0, y: 0 }, data.paper);
  const calc = await db.calc.create({ data: { orgId: user.orgId, projectId: design.projectId, designId: design.id, name: `${design.name} ${quantities ? "quantities" : "calc"}`, createdById: user.id } });
  const key = newCalcKey(calc.id);
  await putFile(key, gzipSync(JSON.stringify(data)), CALC_FILE);
  await db.calc.update({ where: { id: calc.id }, data: { fileKey: key, revision: 1, regionCount: data.regions.length } });
  revalidatePath("/calcs");
  return { calcId: calc.id };
}
