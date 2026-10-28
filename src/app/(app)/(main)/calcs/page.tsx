import type { Metadata } from "next";
import Link from "next/link";
import { Sigma } from "lucide-react";
import { CalcRowActions, NewCalcDialog } from "@/components/calcs/calc-list-actions";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Calcs" };

/** Your calculation worksheets, made in the Calcs editor. */
export default async function CalcsPage() {
  const user = await requireUser();
  const calcs = await db.calc.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" } });

  return (
    <PageBody>
      <PageHeader title="Calcs" description="Engineering calculations with units, laid out on pages the way you would in Mathcad." actions={calcs.length > 0 && <NewCalcDialog />} />
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
            <NewCalcDialog label="Create your first worksheet" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Regions</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {calcs.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/calcs/${c.id}`} className="flex items-center gap-2 font-medium hover:text-primary hover:underline">
                      <Sigma className="size-4 text-muted-foreground" />
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.regionCount.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{c.updatedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                  <TableCell>
                    <CalcRowActions id={c.id} name={c.name} />
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
