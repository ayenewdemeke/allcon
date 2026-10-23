import type { Metadata } from "next";
import { MapsProvider } from "@/components/maps/maps-provider";
import { NoMapsKey, ProjectsMap, UnpinnedProjects } from "@/components/maps/projects-map";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mapsConfig } from "@/lib/maps/config";

export const metadata: Metadata = { title: "Map" };

/** Every project at its site, on a map or in 3D. */
export default async function MapPage() {
  const user = await requireUser();
  const projects = await db.project.findMany({
    where: { orgId: user.orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, location: true, latitude: true, longitude: true, _count: { select: { modelVersions: true, ifcModels: true } } },
  });
  const pinned = projects.flatMap((p) =>
    p.latitude !== null && p.longitude !== null
      ? [{ id: p.id, name: p.name, location: p.location, lat: p.latitude, lon: p.longitude, models: p._count.modelVersions + p._count.ifcModels }]
      : [],
  );
  const maps = mapsConfig();

  return (
    <PageBody>
      <PageHeader title="Map" description="Your projects at their sites. Pick one to open it; switch to 3D to see the sites as they are." />
      {maps ? (
        <MapsProvider config={maps}>
          <ProjectsMap projects={pinned} />
        </MapsProvider>
      ) : (
        <NoMapsKey />
      )}
      <UnpinnedProjects projects={projects.filter((p) => p.latitude === null || p.longitude === null)} />
    </PageBody>
  );
}
