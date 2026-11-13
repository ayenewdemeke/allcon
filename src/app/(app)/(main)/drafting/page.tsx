import type { Metadata } from "next";
import Link from "next/link";
import { DraftingCompass, LayoutTemplate } from "lucide-react";
import { DrawingRowActions, ImportDxfDialog, NewDrawingDialog } from "@/components/drafting/drawing-list-actions";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Drafting" };

/** Your 2D drawings, made in the drafting editor, and the templates new ones start from. */
export default async function DraftingPage() {
  const user = await requireUser();
  const all = await db.drawing.findMany({ where: { orgId: user.orgId }, orderBy: { updatedAt: "desc" } });
  const drawings = all.filter((d) => !d.isTemplate);
  const templates = all
    .filter((d) => d.isTemplate)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ id: t.id, name: t.name, description: t.description, units: t.units, entityCount: t.entityCount, updatedAt: t.updatedAt }));
  const options = templates.map(({ id, name, description, units }) => ({ id, name, description, units }));

  return (
    <PageBody>
      <PageHeader
        title="Drafting"
        description="2D drawings, drafted the way you would in AutoCAD."
        actions={
          <div className="flex gap-2">
            <ImportDxfDialog />
            {all.length > 0 && <NewDrawingDialog templates={options} />}
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
            <NewDrawingDialog label="Create your first drawing" templates={options} />
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
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            {templates.length
              ? "New drawings can start as a copy of a template: its layers, styles, layouts, title block, notes and details. Open one to change it."
              : "Set up a sheet once (title block, layers, general notes, typical details), then use Save As → Drawing Template in the editor. New drawings can start from it."}
          </CardDescription>
        </CardHeader>
        {templates.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Units</TableHead>
                <TableHead className="text-right">Objects</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/drafting/${t.id}`} className="flex items-center gap-2 font-medium hover:text-primary hover:underline">
                      <LayoutTemplate className="size-4 text-muted-foreground" />
                      {t.name}
                    </Link>
                    {t.description && <p className="mt-0.5 pl-6 text-xs text-muted-foreground">{t.description}</p>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.units === "mm" ? "Millimeters" : "Architectural"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.entityCount.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground"><LocalTime date={t.updatedAt} /></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <NewDrawingDialog label={`New drawing from ${t.name}`} templates={options} template={t.id} variant="ghost" />
                      <DrawingRowActions id={t.id} name={t.name} template />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
