import type { Metadata } from "next";
import { Download } from "lucide-react";
import { ShareHeader, ShareUnavailable } from "@/components/share/share-header";
import { IfcViewer } from "@/components/models/ifc-viewer";
import { LinkButton } from "@/components/ui/link-button";
import { db } from "@/lib/db";
import { findActiveModelShare, recordModelShareView, sharedByName } from "@/lib/ifc/model-share";
import { modelSummary } from "@/lib/ifc/model-summary";
import { viewCacheKey } from "@/lib/ifc/view-cache";

export const metadata: Metadata = { title: "Shared 3D model" };

/** A 3D model opened from a share link: the viewer, read-only, at the model's latest revision. */
export default async function SharedModelPage({ params }: PageProps<"/share/model/[token]">) {
  const { token } = await params;
  const share = await findActiveModelShare(token);
  if (!share) return <ShareUnavailable />;
  await recordModelShareView(share.id);
  const { model } = share;
  const cache = await db.ifcModelViewCache.findUnique({ where: { modelId: model.id }, select: { key: true } });
  const api = `/api/share/model/${token}`;
  const until = share.expiresAt && ` · available until ${share.expiresAt.toLocaleDateString("en-US", { dateStyle: "medium" })}`;

  return (
    <div className="flex h-svh flex-col bg-background">
      <ShareHeader />
      <IfcViewer
        key={`${model.id}:${model.revision}`}
        model={{
          id: model.id,
          name: model.name,
          description: model.description,
          revision: model.revision,
          updated: model.updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
          detailed: model.kind === "ifc",
        }}
        summary={modelSummary(model)}
        source={{ ifc: `${api}/ifc`, view: cache?.key === viewCacheKey(model.revision) ? `${api}/view` : null, save: null }}
        subtitle={`${model.project.name} · shared by ${sharedByName(share)} · read-only${until || ""}`}
        actions={
          share.allowDownload && (
            <LinkButton href={`${api}/ifc?download=1`} variant="outline" size="sm" prefetch={false}>
              <Download /> Download IFC
            </LinkButton>
          )
        }
        shared
      />
    </div>
  );
}
