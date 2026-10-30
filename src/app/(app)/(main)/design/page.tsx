import type { Metadata } from "next";
import Link from "next/link";
import { BrickWall } from "lucide-react";
import { DesignRowActions, NewDesignButton } from "@/components/design/design-list-actions";
import { LocalTime } from "@/components/local-time";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { CATEGORIES, kindInfo } from "@/lib/design/kinds";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Design" };

/** The Design section: what can be designed, by category, and the designs made. */
export default async function DesignPage() {
  const user = await requireUser();
  const [designs, projects] = await Promise.all([
    db.design.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" }, include: { project: { select: { id: true, name: true } } } }),
    db.project.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <PageBody>
      <PageHeader title="Design" description="Structural designs worked out as you enter them, with every check and its code reference, and a calc package to print." />
      {CATEGORIES.map((category) => (
        <section key={category.id} className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BrickWall className="size-4 text-muted-foreground" />
            {category.name}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {category.kinds.map((k) => (
              <Card key={k.id} className={k.available ? "" : "opacity-70"}>
                <CardContent className="flex h-full flex-col gap-3 py-4">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 font-medium">
                      {k.name}
                      {!k.available && <Badge variant="secondary">Next</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">{k.description}</p>
                  </div>
                  <div className="mt-auto">
                    <NewDesignButton kind={k.id} available={k.available} projects={projects} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
      {designs.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Design</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {designs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/design/${d.id}`} className="font-medium hover:text-primary hover:underline">
                      {d.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{kindInfo(d.kind)?.name ?? d.kind}</TableCell>
                  <TableCell className="text-muted-foreground">{d.project ? <Link href={`/projects/${d.project.id}`} className="hover:text-primary hover:underline">{d.project.name}</Link> : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <LocalTime date={d.updatedAt} />
                  </TableCell>
                  <TableCell>
                    <DesignRowActions id={d.id} name={d.name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageBody>
  );
}
