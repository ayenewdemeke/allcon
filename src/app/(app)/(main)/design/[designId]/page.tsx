import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CipEditor } from "@/components/design/cip-editor";
import { PageBody } from "@/components/shell/page-header";
import { isUuid, requireUser } from "@/lib/auth/session";
import { cipInputs } from "@/lib/design/kinds";
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
  if (design.kind !== "cip-cantilever-wall") notFound();
  return (
    <PageBody>
      <CipEditor design={{ id: design.id, name: design.name, projectId: design.projectId, inputs: cipInputs(design.inputs) }} projects={projects} />
    </PageBody>
  );
}
