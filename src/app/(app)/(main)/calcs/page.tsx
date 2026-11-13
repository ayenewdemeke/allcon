import type { Metadata } from "next";
import Link from "next/link";
import { Sigma } from "lucide-react";
import { CalcRowActions, ImportCalcDialog, NewCalcDialog } from "@/components/calcs/calc-list-actions";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { CATEGORIES } from "@/lib/design/kinds";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Calcs" };

const OWN = "Worksheets";

/** Your calculation worksheets, made in the Calcs editor or from a design, listed by the design tool they came from. */
export default async function CalcsPage() {
  const user = await requireUser();
  const [calcs, projects] = await Promise.all([
    db.calc.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" }, include: { project: { select: { id: true, name: true } }, design: { select: { id: true, kind: true, name: true } } } }),
    db.project.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // The Design section's tools in its order, then the worksheets not made from a design.
  const tools = CATEGORIES.flatMap((c) => c.kinds);
  const groups = [
    ...tools.map((k) => ({ id: k.id, title: k.name, calcs: calcs.filter((c) => c.design?.kind === k.id) })),
    { id: "own", title: OWN, calcs: calcs.filter((c) => !c.design || !tools.some((k) => k.id === c.design!.kind)) },
  ].filter((g) => g.calcs.length);

  return (
    <PageBody>
      <PageHeader title="Calcs" description="Engineering calculations with units, laid out on pages the way you would in Mathcad." actions={
          <div className="flex gap-2">
            <ImportCalcDialog projects={projects} />
            {calcs.length > 0 && <NewCalcDialog projects={projects} />}
          </div>
        } />
      {calcs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Sigma className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No worksheets yet</p>
              <p className="max-w-md text-sm text-muted-foreground">Write math as you would on paper, with units: definitions with :=, results with =, and live recalculation. Print it as a calc package.</p>
            </div>
            <NewCalcDialog label="Create your first worksheet" projects={projects} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.length > 1 && (
            <nav className="flex flex-wrap gap-2 text-sm" aria-label="Tools">
              {groups.map((g) => (
                <a key={g.id} href={`#calcs-${g.id}`} className="rounded-full border px-3 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  {g.title} <span className="tabular-nums">({g.calcs.length})</span>
                </a>
              ))}
            </nav>
          )}
          {groups.map((g) => (
            <section key={g.id} id={`calcs-${g.id}`} className="scroll-mt-4 space-y-2">
              <h2 className="text-sm font-semibold">
                {g.title} <span className="font-normal text-muted-foreground tabular-nums">({g.calcs.length})</span>
              </h2>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      {g.id !== "own" && <TableHead>Design</TableHead>}
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Regions</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.calcs.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link href={`/calcs/${c.id}`} className="flex items-center gap-2 font-medium hover:text-primary hover:underline">
                            <Sigma className="size-4 text-muted-foreground" />
                            {c.name}
                          </Link>
                        </TableCell>
                        {g.id !== "own" && (
                          <TableCell>
                            {c.design && (
                              <Link href={`/design/${c.design.id}`} className="text-muted-foreground hover:text-primary hover:underline">
                                {c.design.name}
                              </Link>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          {c.project ? (
                            <Link href={`/projects/${c.project.id}`} className="text-muted-foreground hover:text-primary hover:underline">
                              {c.project.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.regionCount.toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground"><LocalTime date={c.updatedAt} /></TableCell>
                        <TableCell>
                          <CalcRowActions id={c.id} name={c.name} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          ))}
        </div>
      )}
    </PageBody>
  );
}
