import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApproachSlabEditor } from "@/components/design/approach-slab-editor";
import { FoundationEditor } from "@/components/design/foundation-editor";
import { BridgeEditor } from "@/components/design/bridge-editor";
import { bridgeCandidates } from "@/app/actions/bridge-record";
import { bridgeInputs } from "@/lib/design/bridge/kinds";
import { spanGroups } from "@/lib/design/bridge/bridge";
import { FOUNDATION_KINDS, foundationInputs, type FoundationKind } from "@/lib/design/foundations/kinds";
import { BearingEditor } from "@/components/design/bearing-editor";
import { CbcEditor } from "@/components/design/cbc-editor";
import { CipEditor } from "@/components/design/cip-editor";
import { ColumnEditor } from "@/components/design/column-editor";
import { columnInputs } from "@/lib/design/piers/column";
import { DeckEditor } from "@/components/design/deck-editor";
import { GirderEditor } from "@/components/design/girder-editor";
import { HaunchEditor } from "@/components/design/haunch-editor";
import { MseEditor } from "@/components/design/mse-editor";
import { SignEditor } from "@/components/design/sign-editor";
import { StmEditor } from "@/components/design/stm-editor";
import { stmInputs } from "@/lib/design/stm/strut-tie";
import { StripSealEditor } from "@/components/design/strip-seal-editor";
import { WingwallEditor } from "@/components/design/wingwall-editor";
import { Zone1Editor } from "@/components/design/zone1-editor";
import { PageBody } from "@/components/shell/page-header";
import { isUuid, requireUser } from "@/lib/auth/session";
import { CollisionEditor } from "@/components/design/collision-editor";
import { DtRatingEditor } from "@/components/design/dt-rating-editor";
import { approachSlabInputs, bearingInputs, cbcInputs, cipInputs, collisionInputs, deckInputs, dtRatingInputs, girderInputs, haunchInputs, mseInputs, ptfeInputs, signInputs, stripSealInputs, wingwallInputs, zone1Inputs } from "@/lib/design/kinds";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: PageProps<"/design/[designId]">): Promise<Metadata> {
  const { designId } = await params;
  const user = await requireUser();
  const design = isUuid(designId) ? await db.design.findFirst({ where: { id: designId, orgId: user.orgId }, select: { name: true } }) : null;
  return { title: design?.name ?? "Design" };
}

/** A design, open for editing: inputs, results and the calc package. */
export default async function DesignEditorPage({ params }: PageProps<"/design/[designId]">) {
  const { designId } = await params;
  const user = await requireUser();
  const design = isUuid(designId) ? await db.design.findFirst({ where: { id: designId, orgId: user.orgId } }) : null;
  if (!design) notFound();
  const projects = await db.project.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const base = { id: design.id, name: design.name, projectId: design.projectId };
  if (design.kind === "lrfd-girder-check")
    return (
      <PageBody>
        <GirderEditor design={{ ...base, inputs: girderInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "stm-d-region")
    return (
      <PageBody>
        <StmEditor design={{ ...base, inputs: stmInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "dt-load-rating")
    return (
      <PageBody>
        <DtRatingEditor design={{ ...base, inputs: dtRatingInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "pier-collision")
    return (
      <PageBody>
        <CollisionEditor design={{ ...base, inputs: collisionInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "cip-cantilever-wall")
    return (
      <PageBody>
        <CipEditor design={{ ...base, inputs: cipInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "mse-wall")
    return (
      <PageBody>
        <MseEditor design={{ ...base, inputs: mseInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "box-culvert")
    return (
      <PageBody>
        <CbcEditor design={{ ...base, inputs: cbcInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "sign-cantilever")
    return (
      <PageBody>
        <SignEditor design={{ ...base, inputs: signInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "camber-haunch")
    return (
      <PageBody>
        <HaunchEditor design={{ ...base, inputs: haunchInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "pier-column")
    return (
      <PageBody>
        <ColumnEditor design={{ ...base, inputs: columnInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "seismic-zone1")
    return (
      <PageBody>
        <Zone1Editor design={{ ...base, inputs: zone1Inputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "deck-slab")
    return (
      <PageBody>
        <DeckEditor design={{ ...base, inputs: deckInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "cantilever-wingwall")
    return (
      <PageBody>
        <WingwallEditor design={{ ...base, inputs: wingwallInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "bridge") {
    const b = bridgeInputs(design.inputs);
    const ids = spanGroups(b).map((_, gi) => b.girderDesignIds[gi] ?? null);
    const rows = await db.design.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) }, orgId: design.orgId, kind: "lrfd-girder-check" }, select: { id: true, inputs: true } });
    const girders = ids.map((id) => {
      const row = rows.find((x) => x.id === id);
      return row ? girderInputs(row.inputs) : null;
    });
    return (
      <PageBody>
        <BridgeEditor design={{ ...base, inputs: b }} projects={projects} girders={girders} candidates={await bridgeCandidates()} />
      </PageBody>
    );
  }
  if ((FOUNDATION_KINDS as readonly string[]).includes(design.kind))
    return (
      <PageBody>
        <FoundationEditor kind={design.kind as FoundationKind} design={{ ...base, inputs: foundationInputs(design.kind, design.inputs)! }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "approach-slab")
    return (
      <PageBody>
        <ApproachSlabEditor design={{ ...base, inputs: approachSlabInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "strip-seal-joint")
    return (
      <PageBody>
        <StripSealEditor design={{ ...base, inputs: stripSealInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "ptfe-bearing")
    return (
      <PageBody>
        <BearingEditor design={{ ...base, inputs: ptfeInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  if (design.kind === "elastomeric-bearing")
    return (
      <PageBody>
        <BearingEditor design={{ ...base, inputs: bearingInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  notFound();
}
