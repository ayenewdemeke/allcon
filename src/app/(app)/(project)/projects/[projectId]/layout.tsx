import { AppShell } from "@/components/shell/app-shell";
import { db } from "@/lib/db";
import { requireProject } from "@/lib/auth/session";

export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[projectId]">) {
  const { user, project } = await requireProject((await params).projectId);
  const projects = await db.project.findMany({
    where: { orgId: user.orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <AppShell
      user={{ name: user.name, email: user.email }}
      project={{ id: project.id, name: project.name }}
      projects={projects}
    >
      {children}
    </AppShell>
  );
}
