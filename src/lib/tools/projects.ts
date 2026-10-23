import "server-only";
import { db } from "@/lib/db";
import { buildReport } from "@/lib/report";
import { requireProject, type ToolContext } from "./context";

export async function listProjects(ctx: ToolContext) {
  const projects = await db.project.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { drawingSets: true, modelVersions: true, lineItems: true, reviews: true } } },
  });
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    location: p.location,
    currency: p.currency,
    units: p.unitSystem,
    drawingSets: p._count.drawingSets,
    models: p._count.modelVersions,
    lineItems: p._count.lineItems,
    reviews: p._count.reviews,
  }));
}

export async function getProject(ctx: ToolContext, projectId: string) {
  const project = await requireProject(ctx, projectId);
  const [sets, models, lineItems, manuals] = await Promise.all([
    db.drawingSet.findMany({
      where: { projectId, status: "ready" },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, fileName: true, pageCount: true, uploadedAt: true },
    }),
    db.modelVersion.findMany({
      where: { projectId },
      orderBy: { uploadedAt: "desc" },
      select: { id: true, fileName: true, status: true, elementCount: true },
    }),
    db.lineItem.count({ where: { projectId, isHeading: false } }),
    db.reference.findMany({ where: { orgId: ctx.orgId, status: "ready" }, select: { id: true, title: true, pageCount: true } }),
  ]);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    location: project.location, // the jurisdiction whose codes apply
    // Pinned on a map: new 3D models are georeferenced here.
    site: project.latitude !== null && project.longitude !== null ? { latitude: project.latitude, longitude: project.longitude } : null,
    currency: project.currency,
    units: project.unitSystem,
    measurementStandard: project.measurementStandard,
    retainagePct: Number(project.retentionPct),
    drawingSets: sets.map((s) => ({ id: s.id, fileName: s.fileName, sheets: s.pageCount, uploaded: s.uploadedAt.toISOString().slice(0, 10) })),
    models: models.map((m) => ({ id: m.id, fileName: m.fileName, status: m.status, elements: m.elementCount })),
    lineItems,
    libraryManuals: manuals,
    link: `/projects/${project.id}`,
  };
}

/** Quantities and amounts by line item, as the project's validation report shows them. */
export async function takeoffSummary(ctx: ToolContext, projectId: string) {
  const project = await requireProject(ctx, projectId);
  const report = await buildReport(project.id);
  const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  return {
    project: project.name,
    currency: project.currency,
    totals: {
      contractValue: r2(report.totals.contractValue),
      measuredValue: r2(report.totals.measuredValue),
      measuredCoverage: `${Math.round(report.totals.coverage * 100)}% of unit-price value has a measured quantity`,
      flaggedLines: report.totals.flagged,
    },
    lines: report.lines
      .filter((l) => !l.isHeading)
      .map((l) => ({
        code: l.code,
        description: l.description,
        unit: l.unit,
        billing: l.billingType,
        contractQuantity: r2(l.contractQuantity),
        rate: r2(l.rate),
        modelQuantity: r2(l.modelQuantity),
        drawingQuantity: r2(l.drawingQuantity),
        measuredQuantity: r2(l.measuredQuantity),
        measuredValue: r2(l.measuredValue),
        variance: l.variance === null ? null : `${Math.round(l.variance * 100)}%`,
        flags: l.flags,
      })),
    link: `/projects/${project.id}/report`,
  };
}
