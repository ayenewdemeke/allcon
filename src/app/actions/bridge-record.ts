"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, isUuid } from "@/lib/auth/session";
import { bridgeInputs } from "@/lib/design/bridge/kinds";
import { girderInputsFor, runBridge, spanGroups, type BridgeInputs } from "@/lib/design/bridge/bridge";
import { designBearing } from "@/lib/design/bearings/elastomeric";
import { designDeck } from "@/lib/design/decks/deck";
import { abutmentFromBridge, approachSlabFromBridge, bearingFromBridge, deckFromBridge, capFromBridge, changedKeys, columnFromBridge, footingFromColumn, pilesFromColumn, shaftFromColumn, wingwallFromBridge } from "@/lib/design/bridge/loadpath";
import { designApproachSlab } from "@/lib/design/approach/approach-slab";
import { designWingwall } from "@/lib/design/walls/wingwall";
import { nodeLpSolver } from "@/lib/design/stm/lp-node";
import { abutmentInputs, footingInputs, pileFoundationInputs, shaftInputs } from "@/lib/design/foundations/kinds";
import { runFoundation } from "@/lib/design/foundations/run";
import type { GirderInputs } from "@/lib/design/girders/prestressed";
import { approachSlabInputs, bearingInputs, deckInputs, designInputs, girderInputs, kindInfo, wingwallInputs } from "@/lib/design/kinds";
import { columnInputs, designColumn } from "@/lib/design/piers/column";
import { columnLinkFrom } from "@/lib/design/piers/column-link";
import { designStm, stmInputs } from "@/lib/design/stm/strut-tie";
import { db } from "@/lib/db";
import { bridgeIfc, type BridgeComponents } from "@/lib/design/bridge/ifc";
import { attachRebar, rebarSources, type RebarDesigns } from "@/lib/design/bridge/ifc-rebar";
import { newModelFileKey, workerBridge, WorkerError } from "@/lib/ifc/worker";

// The Bridge's load path through its linked designs (docs/bridge-model.md): each linked design's
// inputs brought up to date from the Bridge, top to bottom (girders, abutments, pier caps, columns,
// foundations), the missing girder and abutment designs created when asked, and a report of what
// changed and each component's verdict.

export type SyncRow = { component: string; kind: string; designId: string | null; name: string; action: "created" | "updated" | "unchanged" | "missing" | "error"; changes: string[]; verdict: string };

async function ownBridge(bridgeId: string) {
  const user = await getCurrentUser();
  if (!user || !isUuid(bridgeId)) throw new Error("Bridge not found");
  const design = await db.design.findFirst({ where: { id: bridgeId, orgId: user.orgId, kind: "bridge" } });
  if (!design) throw new Error("Bridge not found");
  return { user, design };
}

/** The designs a Bridge can link to: the org's designs of each component kind, newest first. */
export async function bridgeCandidates(): Promise<Record<string, { id: string; name: string }[]>> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in");
  const kinds = ["lrfd-girder-check", "deck-slab", "elastomeric-bearing", "abutment", "approach-slab", "cantilever-wingwall", "stm-d-region", "pier-column", "spread-footing", "pile-foundation", "drilled-shaft"];
  const rows = await db.design.findMany({ where: { orgId: user.orgId, kind: { in: kinds } }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, kind: true }, take: 500 });
  return Object.fromEntries(kinds.map((k) => [k, rows.filter((r) => r.kind === k).map((r) => ({ id: r.id, name: r.name }))]));
}

const verdictOf = (checks: { ok: boolean; advisory?: boolean }[]) => {
  const fail = checks.filter((c) => !c.ok && !c.advisory).length;
  return fail ? `${fail} of ${checks.filter((c) => !c.advisory).length} checks fail` : `all ${checks.filter((c) => !c.advisory).length} checks pass`;
};

export async function syncBridge(bridgeId: string, inputsNow: unknown, create: boolean): Promise<{ rows: SyncRow[]; inputs: BridgeInputs }> {
  const { user, design } = await ownBridge(bridgeId);
  const b = bridgeInputs(inputsNow ?? design.inputs);
  const rows: SyncRow[] = [];
  const load = async (id: string | null | undefined, kind: string) => (id && isUuid(id) ? db.design.findFirst({ where: { id, orgId: user.orgId, kind }, select: { id: true, name: true, inputs: true } }) : null);
  const save = async (id: string, before: object, after: object) => {
    const changes = changedKeys(before, after);
    if (changes.length) await db.design.update({ where: { id }, data: { inputs: after as unknown as Prisma.InputJsonValue } });
    return changes;
  };
  const make = async (kind: string, name: string, inputs: object) => {
    const info = kindInfo(kind)!;
    const d = await db.design.create({ data: { orgId: user.orgId, projectId: design.projectId, kind, name: `${name} (${info.name})`.slice(0, 200), inputs: designInputs(kind, inputs) as unknown as Prisma.InputJsonValue, createdById: user.id } });
    return d.id;
  };

  // --- girders: one design per group of spans ---------------------------------------------------------------------
  const groups = spanGroups(b);
  const girderIds: (string | null)[] = groups.map((_, gi) => b.girderDesignIds[gi] ?? null);
  const bases: (GirderInputs | null)[] = [];
  const names: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const d = await load(girderIds[gi], "lrfd-girder-check");
    bases.push(d ? girderInputs(d.inputs) : null);
    names.push(d?.name ?? "");
    if (!d) girderIds[gi] = null;
  }
  const run = runBridge(b, bases);
  for (let gi = 0; gi < groups.length; gi++) {
    const label = `Girders, span${groups[gi].length > 1 ? "s" : ""} ${groups[gi].map((j) => j + 1).join("–")}`;
    const next = girderInputsFor(b, run.layout, groups[gi], bases[gi] ?? undefined);
    const verdict = run.groups[gi].result.ok ? "all checks pass" : "some checks fail";
    if (girderIds[gi]) {
      const changes = await save(girderIds[gi]!, bases[gi]!, next);
      rows.push({ component: label, kind: "lrfd-girder-check", designId: girderIds[gi], name: names[gi], action: changes.length ? "updated" : "unchanged", changes, verdict });
    } else if (create) {
      girderIds[gi] = await make("lrfd-girder-check", `${design.name}, ${label.toLowerCase()}`, next);
      names[gi] = `${design.name}, ${label.toLowerCase()}`;
      rows.push({ component: label, kind: "lrfd-girder-check", designId: girderIds[gi], name: names[gi], action: "created", changes: [], verdict });
    } else rows.push({ component: label, kind: "lrfd-girder-check", designId: null, name: "", action: "missing", changes: [], verdict });
  }

  // --- each support's components ------------------------------------------------------------------------------------
  const comps = b.supports.map((_, i) => ({ support: i, ...(b.components.find((c) => c.support === i) ?? {}) }));
  /** A component brought up to date: saved if linked, created if missing and asked to, else reported missing. Returns its id. */
  const upsert = async (label: string, kind: string, existing: { id: string; name: string } | null, before: object, next: object, verdict: string, newName: string) => {
    if (existing) {
      const changes = await save(existing.id, before, next);
      rows.push({ component: label, kind, designId: existing.id, name: existing.name, action: changes.length ? "updated" : "unchanged", changes, verdict });
      return existing.id;
    }
    if (create) {
      const id = await make(kind, newName, next);
      rows.push({ component: label, kind, designId: id, name: `${newName} (${kindInfo(kind)!.name})`, action: "created", changes: [], verdict });
      return id;
    }
    rows.push({ component: label, kind, designId: null, name: "", action: "missing", changes: [], verdict });
    return null;
  };
  const verdictTry = (f: () => { ok: boolean; advisory?: boolean }[]) => {
    try {
      return verdictOf(f());
    } catch (e) {
      return e instanceof Error ? e.message : "can't be worked out";
    }
  };
  const girders = new Map<string, GirderInputs>();
  for (let gi = 0; gi < groups.length; gi++) if (girderIds[gi]) girders.set(girderIds[gi]!, run.groups[gi].inputs);

  // --- the deck slab (the deck between the girders, the overhang and the rail) ----------------------------------------
  const dd = await load(b.deckDesignId, "deck-slab");
  const dBefore = deckInputs(dd?.inputs ?? {});
  const dNext = deckFromBridge(b, run, dBefore, girderIds[0] ? { id: girderIds[0], name: names[0] || `${design.name}, girders` } : null);
  const deckId = await upsert("Deck, overhang and rail", "deck-slab", dd, dBefore, dNext, verdictTry(() => designDeck(dNext).checks), `${design.name}, deck`);

  for (const c of comps) {
    const s = b.supports[c.support];
    // The bearing pads under the girders here.
    const bd = await load(c.bearingId, "elastomeric-bearing");
    const bBefore = bearingInputs(bd?.inputs ?? {});
    const bNext = bearingFromBridge(b, run, c.support, bBefore);
    c.bearingId = await upsert(`${s.name}, bearings`, "elastomeric-bearing", bd, bBefore, bNext, verdictTry(() => designBearing(bNext).checks), `${design.name}, ${s.name} bearings`);
    if (s.type.endsWith("abutment")) {
      const d = await load(c.abutmentId, "abutment");
      const before = d ? abutmentInputs(d.inputs) : abutmentInputs({});
      const next = abutmentFromBridge(b, run, c.support, before);
      c.abutmentId = await upsert(s.name, "abutment", d, before, next, verdictTry(() => runFoundation("abutment", next).checks), `${design.name}, ${s.name}`);
      // Its approach slab and a wingwall.
      const sd = await load(c.approachSlabId, "approach-slab");
      const sBefore = approachSlabInputs(sd?.inputs ?? {});
      const sNext = approachSlabFromBridge(b, c.support, sBefore);
      c.approachSlabId = await upsert(`${s.name}, approach slab`, "approach-slab", sd, sBefore, sNext, verdictTry(() => designApproachSlab(sNext).checks), `${design.name}, ${s.name} approach slab`);
      const wd = await load(c.wingwallId, "cantilever-wingwall");
      const wBefore = wingwallInputs(wd?.inputs ?? {});
      const wNext = wingwallFromBridge(b, c.support, next, wBefore);
      c.wingwallId = await upsert(`${s.name}, wingwall`, "cantilever-wingwall", wd, wBefore, wNext, verdictTry(() => designWingwall(wNext).checks), `${design.name}, ${s.name} wingwall`);
      continue;
    }
    // A pier: its cap (strut-and-tie from a standard pier cap), column and foundation, from the Bridge's pier.
    if (!s.pier) {
      rows.push({ component: `${s.name}`, kind: "stm-d-region", designId: null, name: "", action: "missing", changes: [], verdict: "describe the pier (cap, columns, foundation) in the Bridge's supports" });
      continue;
    }
    const cap = await load(c.capId, "stm-d-region");
    const capBefore = cap ? stmInputs(cap.inputs) : stmInputs({});
    let capNext = capBefore;
    let capVerdict = "";
    try {
      capNext = capFromBridge(b, run, c.support, capBefore, girderIds, names);
      capVerdict = verdictOf((await designStm(capNext, nodeLpSolver)).checks);
    } catch (e) {
      capVerdict = e instanceof Error ? e.message : "the cap couldn't be built";
    }
    c.capId = await upsert(`${s.name}, cap`, "stm-d-region", cap, capBefore, capNext, capVerdict, `${design.name}, ${s.name} cap`);
    if (!c.capId) continue;
    const capName = cap?.name ?? `${design.name}, ${s.name} cap`;
    const col = await load(c.columnId, "pier-column");
    const colBefore = columnInputs(col?.inputs ?? {});
    let colNext = colBefore;
    let colResult: ReturnType<typeof designColumn> | null = null;
    let colVerdict = "";
    try {
      colNext = columnFromBridge(b, run, c.support, colBefore, columnLinkFrom(c.capId, capName, capNext, girders));
      colResult = designColumn(colNext);
      colVerdict = verdictOf(colResult.checks);
    } catch (e) {
      colVerdict = e instanceof Error ? e.message : "the column couldn't be worked out";
    }
    c.columnId = await upsert(`${s.name}, column`, "pier-column", col, colBefore, colNext, colVerdict, `${design.name}, ${s.name} column`);
    const kind = s.pier.foundation;
    if (c.foundationKind !== kind) c.foundationId = null;
    c.foundationKind = kind;
    const fd = await load(c.foundationId, kind);
    const fBefore = kind === "spread-footing" ? footingInputs(fd?.inputs ?? {}) : kind === "pile-foundation" ? pileFoundationInputs(fd?.inputs ?? {}) : shaftInputs(fd?.inputs ?? {});
    let fNext: object = fBefore;
    if (colResult) {
      fNext = kind === "spread-footing" ? footingFromColumn(colResult, fBefore as ReturnType<typeof footingInputs>) : kind === "pile-foundation" ? pilesFromColumn(colResult, fBefore as ReturnType<typeof pileFoundationInputs>) : shaftFromColumn(colResult, fBefore as ReturnType<typeof shaftInputs>);
      if (kind === "drilled-shaft") fNext = { ...fNext, D: Math.max((fNext as ReturnType<typeof shaftInputs>).D, s.pier.columnShape === "round" ? s.pier.columnSize : 0) };
    }
    c.foundationId = await upsert(`${s.name}, foundation`, kind, fd, fBefore, fNext, colResult ? verdictTry(() => runFoundation(kind, fNext).checks) : "the column's base forces are needed first", `${design.name}, ${s.name} foundation`);
  }

  // The Bridge keeps the links it made.
  const next: BridgeInputs = {
    ...b,
    girderDesignIds: girderIds,
    deckDesignId: deckId,
    components: comps.map(({ support, bearingId, abutmentId, approachSlabId, wingwallId, capId, columnId, foundationId, foundationKind }) => ({ support, bearingId: bearingId ?? null, abutmentId: abutmentId ?? null, approachSlabId: approachSlabId ?? null, wingwallId: wingwallId ?? null, capId: capId ?? null, columnId: columnId ?? null, foundationId: foundationId ?? null, foundationKind: foundationKind ?? null })),
  };
  await db.design.update({ where: { id: design.id }, data: { inputs: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/design");
  return { rows, inputs: next };
}

/**
 * The Bridge's IFC 4.3 model (phase 2, docs/bridge-model.md): the alignment, the bridge's parts and every
 * element at its designed size and place, from the Bridge and its linked designs, saved as a 3D model in
 * the Bridge's project. Returns the model's link.
 */
export async function buildBridgeModel(bridgeId: string, inputsNow: unknown): Promise<{ link: string; elements: number } | { error: string }> {
  const { user, design } = await ownBridge(bridgeId);
  if (!design.projectId) return { error: "Put the Bridge in a project first (the project picker at the top): the model is saved there." };
  const b = bridgeInputs(inputsNow ?? design.inputs);
  const ids = b.girderDesignIds.filter((x): x is string => !!x && isUuid(x));
  const linked = await db.design.findMany({ where: { id: { in: ids }, orgId: user.orgId, kind: "lrfd-girder-check" }, select: { id: true, inputs: true } });
  let run: ReturnType<typeof runBridge>;
  try {
    run = runBridge(b, b.girderDesignIds.map((id) => { const d = linked.find((x) => x.id === id); return d ? girderInputs(d.inputs) : null; }));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The bridge can't be laid out." };
  }
  const verdicts: Record<string, string> = {};
  const verdictTry = (id: string | null | undefined, f: () => { ok: boolean; advisory?: boolean }[]) => {
    if (!id) return;
    try {
      verdicts[id] = verdictOf(f());
    } catch {
      verdicts[id] = "can't be worked out";
    }
  };
  run.groups.forEach((g, gi) => {
    const id = b.girderDesignIds[gi];
    if (id) verdicts[id] = g.result.ok ? "all checks pass" : "some checks fail";
  });
  const load = async (id: string | null | undefined, kind: string) => (id && isUuid(id) ? db.design.findFirst({ where: { id, orgId: user.orgId, kind }, select: { id: true, inputs: true } }) : null);
  const deck = await load(b.deckDesignId, "deck-slab");
  const comps: BridgeComponents = { verdicts, abutments: {}, approachSlabs: {}, foundations: {}, deckId: deck?.id ?? null, ids: { girders: b.girderDesignIds, caps: {}, columns: {} } };
  // The designs whose bars go in the model besides those comps carries.
  const rebar: RebarDesigns = { deck: deck ? { id: deck.id, inputs: deckInputs(deck.inputs) } : null, caps: {}, columns: {} };
  for (const c of b.components) {
    const s = b.supports[c.support];
    if (!s) continue;
    if (s.type.endsWith("abutment")) {
      const a = await load(c.abutmentId, "abutment");
      if (a) {
        const inputs = abutmentInputs(a.inputs);
        comps.abutments![c.support] = { id: a.id, inputs };
        verdictTry(a.id, () => runFoundation("abutment", inputs).checks);
      }
      const ap = await load(c.approachSlabId, "approach-slab");
      if (ap) {
        const inputs = approachSlabInputs(ap.inputs);
        comps.approachSlabs![c.support] = { id: ap.id, inputs };
        verdictTry(ap.id, () => designApproachSlab(inputs).checks);
      }
      continue;
    }
    comps.ids!.caps![c.support] = c.capId ?? null;
    comps.ids!.columns![c.support] = c.columnId ?? null;
    const cap = await load(c.capId, "stm-d-region");
    if (cap) rebar.caps![c.support] = { id: cap.id, inputs: stmInputs(cap.inputs) };
    const col = await load(c.columnId, "pier-column");
    if (col) rebar.columns![c.support] = { id: col.id, inputs: columnInputs(col.inputs) };
    const kind = s.pier?.foundation;
    const f = kind && c.foundationKind === kind ? await load(c.foundationId, kind) : null;
    if (f && kind) {
      const inputs = kind === "spread-footing" ? footingInputs(f.inputs) : kind === "pile-foundation" ? pileFoundationInputs(f.inputs) : shaftInputs(f.inputs);
      comps.foundations![c.support] = { id: f.id, kind, inputs };
      verdictTry(f.id, () => runFoundation(kind, inputs).checks);
    }
  }
  const description = attachRebar(bridgeIfc(b, run, comps, design.name), rebarSources(comps, rebar));
  const id = randomUUID();
  const fileKey = newModelFileKey(id);
  let made: Awaited<ReturnType<typeof workerBridge>>;
  try {
    made = await workerBridge(fileKey, { ...description, project: design.name });
  } catch (e) {
    return { error: e instanceof WorkerError ? e.message : "The IFC model couldn't be written." };
  }
  await db.ifcModel.create({
    data: {
      id,
      projectId: design.projectId,
      name: `${design.name} (IFC 4.3)`.slice(0, 200),
      description: `Built from the Bridge "${design.name}": the alignment, ${run.layout.spans.length} span(s) and ${run.layout.supports.length} supports, each element from its linked design.`,
      fileKey,
      fileSize: made.size,
      summary: made.summary as unknown as object,
      elementCount: made.summary.elements,
      editedAt: new Date(),
      createdById: user.id,
    },
  });
  revalidatePath(`/projects/${design.projectId}`);
  return { link: `/projects/${design.projectId}/models/ifc/${id}`, elements: made.summary.elements };
}
