"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ClipboardCheck,
  Box,
  DraftingCompass,
  PencilRuler,
  Sigma,
  Check,
  ChevronsUpDown,
  FileSearch,
  FolderKanban,
  GitMerge,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map as MapIcon,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { LogoMark, Wordmark } from "@/components/brand/logo";
import { BOQ } from "@/lib/line-items/terms";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type NavItem = { name: string; href: string; icon: LucideIcon; exact?: boolean };

export type SidebarUser = { name: string | null; email: string };
export type SidebarProject = { id: string; name: string };

const mainNav: NavItem[] = [
  { name: "Projects", href: "/projects", icon: FolderKanban },
  // Every project at its site, in 2D or photorealistic 3D.
  { name: "Map", href: "/map", icon: MapIcon },
  // 2D drafting, like AutoCAD (drawings open full screen).
  { name: "Drafting", href: "/drafting", icon: DraftingCompass },
  // Engineering calculations with units, like Mathcad (worksheets open full screen).
  { name: "Calcs", href: "/calcs", icon: Sigma },
  // Structural designs (walls...) worked out as they're entered, with a calc package.
  { name: "Design", href: "/design", icon: PencilRuler },
  // Shared by all projects: manuals and standards that plan reviews check against.
  { name: "Library", href: "/library", icon: BookOpen },
  // AI apps (Claude, ChatGPT...) connected through MCP.
  { name: "Connections", href: "/connections", icon: Plug },
];

function projectNav(projectId: string, boq: string): NavItem[] {
  const base = `/projects/${projectId}`;
  return [
    { name: "Overview", href: base, icon: LayoutDashboard, exact: true },
    { name: "Models", href: `${base}/models`, icon: Box },
    { name: "Sheets", href: `${base}/sheets`, icon: Layers },
    { name: "Review", href: `${base}/reviews`, icon: FileSearch },
    { name: boq, href: `${base}/line-items`, icon: ListChecks },
    { name: "Mapping", href: `${base}/mapping`, icon: GitMerge },
    { name: "Report", href: `${base}/report`, icon: ClipboardCheck },
    { name: "Settings", href: `${base}/settings`, icon: Settings },
  ];
}

// Active items get a solid highlight, as in Live Jobsite, rather than shadcn's subtle tint.
const activeItem =
  "data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground data-active:hover:bg-sidebar-primary data-active:hover:text-sidebar-primary-foreground";

function initials(user: SidebarUser) {
  const source = user.name?.trim() || user.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function NavList({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={active}
              tooltip={item.name}
              className={cn("h-9", activeItem)}
              render={<Link href={item.href} onClick={() => setOpenMobile(false)} />}
            >
              <item.icon />
              <span>{item.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function ProjectSwitcher({ current, projects }: { current: SidebarProject; projects: SidebarProject[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="bg-sidebar-accent hover:bg-sidebar-accent/80 data-popup-open:bg-sidebar-accent"
          />
        }
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <FolderKanban className="size-4" />
        </div>
        <div className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate text-sm font-medium">{current.name}</span>
          <span className="truncate text-xs text-sidebar-foreground/60">Switch project</span>
        </div>
        <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-60" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          <div className="max-h-[min(60vh,20rem)] overflow-y-auto">
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} render={<Link href={`/projects/${p.id}`} />}>
                <FolderKanban className="text-muted-foreground" />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === current.id && <Check className="text-primary" />}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/projects" />}>
          <FolderKanban className="text-muted-foreground" />
          View all projects
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: SidebarUser }) {
  const router = useRouter();
  async function signOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}>
        <Avatar className="size-8 rounded-md">
          <AvatarFallback className="rounded-md bg-sidebar-primary text-xs text-sidebar-primary-foreground">
            {initials(user)}
          </AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate text-sm font-medium">{user.name ?? user.email}</span>
          {user.name && <span className="truncate text-xs text-sidebar-foreground/60">{user.email}</span>}
        </div>
        <ChevronsUpDown className="ml-auto size-4 text-sidebar-foreground/50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width) min-w-56" side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <p className="truncate text-sm font-medium text-foreground">{user.name ?? user.email}</p>
            {user.name && <p className="truncate text-xs">{user.email}</p>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar({
  user,
  project,
  projects = [],
}: {
  user: SidebarUser;
  /** Set inside a project: switches to the project workspace navigation. */
  project?: SidebarProject;
  projects?: SidebarProject[];
}) {
  return (
    <Sidebar collapsible="icon" className={cn(project && "sidebar-project")}>
      <SidebarHeader className="gap-2 border-b border-sidebar-border">
        {project ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="All projects"
                className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
                render={<Link href="/projects" />}
              >
                <ArrowLeft />
                <span>All projects</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <ProjectSwitcher current={project} projects={projects} />
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Projects" render={<Link href="/projects" />}>
                {/* The wordmark is the logo; collapsed to icons, its "c" mark takes its place. */}
                <LogoMark className="hidden bg-sidebar-primary group-data-[collapsible=icon]:flex" />
                <Wordmark className="px-1 text-[1.35rem] group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {project && <SidebarGroupLabel className="text-sidebar-foreground/50">Project</SidebarGroupLabel>}
          <SidebarGroupContent>
            <NavList items={project ? projectNav(project.id, BOQ.title) : mainNav} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu user={user} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
