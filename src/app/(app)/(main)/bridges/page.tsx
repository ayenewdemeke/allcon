import type { Metadata } from "next";
import Link from "next/link";
import { BridgeRowActions, ImportBridgeButton, NewBridgeButton } from "@/components/bridge/bridge-list-actions";
import { LocalTime } from "@/components/local-time";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { bridgeDefinition } from "@/lib/bridge/definition";
import { importedOf } from "@/lib/bridge/imported";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Bridge" };

/** The Bridge section: bridges modeled once, analyzed and designed. */
export default async function BridgesPage() {
  const user = await requireUser();
  const bridges = await db.bridge.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" }, include: { project: { select: { id: true, name: true } } } });
  return (
    <PageBody>
      <PageHeader title="Bridge" description="A bridge modeled once: its girders, deck and piers as an analysis model, solved as you enter it, with the forces every member carries." actions={
          <div className="flex items-center gap-2">
            <ImportBridgeButton />
            <NewBridgeButton />
          </div>
        }
      />
      {bridges.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-6 text-sm text-muted-foreground">
            <p>No bridges yet. Start one: a precast girder bridge with its deck and piers is set up for you, and every value can be changed. Or import a model from midas Civil (an MCT file) to analyze it here and compare the results.</p>
            <div className="flex gap-2">
              <NewBridgeButton />
              <ImportBridgeButton />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bridge</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bridges.map((b) => {
                const imp = importedOf(b.definition);
                const d = bridgeDefinition(b.definition);
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/bridges/${b.id}`} className="font-medium hover:text-primary hover:underline">
                        {b.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {imp ? `Imported from ${imp.source} · ${imp.nodes} nodes, ${imp.elements} elements` : `${d.spans.map((s) => `${+s.toFixed(2)}`).join(" – ")} ft · ${d.nGirders} girders`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.project ? (
                        <Link href={`/projects/${b.project.id}`} className="hover:text-primary hover:underline">
                          {b.project.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <LocalTime date={b.updatedAt.toISOString()} />
                    </TableCell>
                    <TableCell>
                      <BridgeRowActions id={b.id} name={b.name} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageBody>
  );
}
