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
import { SidebarTrigger } from "@/components/ui/sidebar";

const SECTION_LABELS: Record<string, string> = {
  models: "Models",
  sheets: "Sheets",
  reviews: "Review",
  "line-items": "Line items",
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
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "library") return { crumbs: [{ label: "Library", href: "/library" }], pathname };
  if (segments[0] === "connections") return { crumbs: [{ label: "Connections", href: "/connections" }], pathname };
  const crumbs: Crumb[] = [{ label: "Projects", href: "/projects" }];
  if (segments[0] === "projects" && segments[1] && projectName) {
    const projectHref = `/projects/${segments[1]}`;
    crumbs.push({ label: projectName, href: projectHref });
    if (segments[2]) {
      crumbs.push({ label: SECTION_LABELS[segments[2]] ?? segments[2], href: `${projectHref}/${segments[2]}` });
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
