import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BridgeWorkspace } from "@/components/bridge/bridge-workspace";
import { ImportedWorkspace } from "@/components/bridge/imported-workspace";
import { isUuid, requireUser } from "@/lib/auth/session";
import { bridgeDefinition } from "@/lib/bridge/definition";
import { importedOf } from "@/lib/bridge/imported";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: PageProps<"/bridges/[bridgeId]">): Promise<Metadata> {
  const { bridgeId } = await params;
  const user = await requireUser();
  const bridge = isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId }, select: { name: true } }) : null;
  return { title: bridge?.name ?? "Bridge" };
}

/** A bridge open in its workspace, full screen: the model, its analysis and the results. */
export default async function BridgePage({ params }: PageProps<"/bridges/[bridgeId]">) {
  const { bridgeId } = await params;
  const user = await requireUser();
  const bridge = isUuid(bridgeId) ? await db.bridge.findFirst({ where: { id: bridgeId, orgId: user.orgId } }) : null;
  if (!bridge) notFound();
  const imported = importedOf(bridge.definition);
  if (imported) return <ImportedWorkspace key={bridge.id} bridge={{ id: bridge.id, name: bridge.name }} info={imported} />;
  const projects = await db.project.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return <BridgeWorkspace key={bridge.id} bridge={{ id: bridge.id, name: bridge.name, projectId: bridge.projectId, definition: bridgeDefinition(bridge.definition) }} projects={projects} />;
}
