import type { Metadata } from "next";
import Link from "next/link";
import { DraftingCompass } from "lucide-react";
import { DrawingRowActions, ImportDxfDialog, NewDrawingDialog } from "@/components/drafting/drawing-list-actions";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Drafting" };

/** Your 2D drawings, made in the drafting editor. */
export default async function DraftingPage() {
  const user = await requireUser();
  const drawings = await db.drawing.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" } });

  return (
    <PageBody>
      <PageHeader title="Drafting" description="2D drawings, drafted the way you would in AutoCAD." actions={
          <div className="flex gap-2">
            <ImportDxfDialog />
            {drawings.length > 0 && <NewDrawingDialog />}
          </div>
        }
      />
      {drawings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <DraftingCompass className="size-6" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">No drawings yet</p>
              <p className="max-w-md text-sm text-muted-foreground">Draw and edit with the commands, object snaps, polar tracking, layers and command line you know from AutoCAD.</p>
            </div>
            <NewDrawingDialog label="Create your first drawing" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Units</TableHead>
                <TableHead className="text-right">Objects</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {drawings.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/drafting/${d.id}`} className="flex items-center gap-2 font-medium hover:text-primary hover:underline">
                      <DraftingCompass className="size-4 text-muted-foreground" />
                      {d.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.units === "mm" ? "Millimeters" : "Architectural"}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.entityCount.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground"><LocalTime date={d.updatedAt} /></TableCell>
                  <TableCell>
                    <DrawingRowActions id={d.id} name={d.name} />
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
