import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BridgeEditor } from "@/components/bridge/bridge-editor";
import { PageBody } from "@/components/shell/page-header";
import { isUuid, requireUser } from "@/lib/auth/session";
import { bridgeDefinition } from "@/lib/bridge/definition";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: PageProps<"/bridges/[bridgeId]">): Promise<Metadata> {
  const { bridgeId } = await params;
  const user = await requireUser();
  const bridge = isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId }, select: { name: true } }) : null;
  return { title: bridge?.name ?? "Bridge" };
}

/** A bridge, open for editing: its definition, the model and the analysis results. */
export default async function BridgePage({ params }: PageProps<"/bridges/[bridgeId]">) {
  const { bridgeId } = await params;
  const user = await requireUser();
  const bridge = isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId } }) : null;
  if (!bridge) notFound();
  const projects = await db.project.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <PageBody>
      <BridgeEditor bridge={{ id: bridge.id, name: bridge.name, projectId: bridge.projectId, definition: bridgeDefinition(bridge.definition) }} projects={projects} />
    </PageBody>
  );
}
