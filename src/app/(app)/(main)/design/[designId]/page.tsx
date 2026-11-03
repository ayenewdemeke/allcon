import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BearingEditor } from "@/components/design/bearing-editor";
import { CbcEditor } from "@/components/design/cbc-editor";
import { CipEditor } from "@/components/design/cip-editor";
import { DeckEditor } from "@/components/design/deck-editor";
import { MseEditor } from "@/components/design/mse-editor";
import { WingwallEditor } from "@/components/design/wingwall-editor";
import { Zone1Editor } from "@/components/design/zone1-editor";
import { PageBody } from "@/components/shell/page-header";
import { isUuid, requireUser } from "@/lib/auth/session";
import { bearingInputs, cbcInputs, cipInputs, deckInputs, mseInputs, wingwallInputs, zone1Inputs } from "@/lib/design/kinds";
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
  if (design.kind === "elastomeric-bearing")
    return (
      <PageBody>
        <BearingEditor design={{ ...base, inputs: bearingInputs(design.inputs) }} projects={projects} />
      </PageBody>
    );
  notFound();
}
