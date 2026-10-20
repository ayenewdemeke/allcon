import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "./app-header";
import { AppSidebar, type SidebarProject, type SidebarUser } from "./app-sidebar";

/** Sidebar + header frame shared by the portfolio and project workspaces. */
export async function AppShell({
  user,
  project,
  projects,
  children,
}: {
  user: SidebarUser;
  project?: SidebarProject;
  projects?: SidebarProject[];
  children: React.ReactNode;
}) {
  // shadcn's sidebar stores its open/collapsed state in this cookie.
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={user} project={project} projects={projects} />
      <SidebarInset className="min-w-0 bg-background">
        <AppHeader projectName={project?.name} />
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
