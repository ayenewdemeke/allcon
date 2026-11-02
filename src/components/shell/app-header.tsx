"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { BOQ } from "@/lib/line-items/terms";
import { SidebarTrigger } from "@/components/ui/sidebar";

const SECTION_LABELS: Record<string, string> = {
  models: "Models",
  sheets: "Sheets",
  reviews: "Review",
  mapping: "Mapping",
  report: "Report",
  settings: "Settings",
};

type Crumb = { label: string; href: string };

/**
 * Breadcrumbs derived from the URL: Projects / {project} / {section}.
 * Deeper pages (e.g. a single model) show their own title, so the trail stops at the
 * section and keeps it as a link back.
 */
function useCrumbs(projectName?: string) {
  const pathname = usePathname();
  const boq = BOQ.title;
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "library") return { crumbs: [{ label: "Library", href: "/library" }], pathname };
  if (segments[0] === "connections") return { crumbs: [{ label: "Connections", href: "/connections" }], pathname };
  if (segments[0] === "feedback") return { crumbs: [{ label: "Feedback", href: "/feedback" }], pathname };
  if (segments[0] === "map") return { crumbs: [{ label: "Map", href: "/map" }], pathname };
  if (segments[0] === "drafting") return { crumbs: [{ label: "Drafting", href: "/drafting" }], pathname };
  if (segments[0] === "calcs") return { crumbs: [{ label: "Calcs", href: "/calcs" }], pathname };
  if (segments[0] === "design") return { crumbs: [{ label: "Design", href: "/design" }], pathname };
  const crumbs: Crumb[] = [{ label: "Projects", href: "/projects" }];
  if (segments[0] === "projects" && segments[1] && projectName) {
    const projectHref = `/projects/${segments[1]}`;
    crumbs.push({ label: projectName, href: projectHref });
    if (segments[2]) {
      const label = segments[2] === "line-items" ? boq : (SECTION_LABELS[segments[2]] ?? segments[2]);
      crumbs.push({ label, href: `${projectHref}/${segments[2]}` });
    }
  }
  return { crumbs, pathname };
}

export function AppHeader({ projectName }: { projectName?: string }) {
  const { crumbs, pathname } = useCrumbs(projectName);
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-center" />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, i) => {
            const current = crumb.href === pathname;
            return (
              <Fragment key={crumb.href}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className={i < crumbs.length - 2 ? "hidden md:inline-flex" : undefined}>
                  {current ? (
                    <BreadcrumbPage className="max-w-60 truncate">{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink className="max-w-60 truncate" render={<Link href={crumb.href} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
