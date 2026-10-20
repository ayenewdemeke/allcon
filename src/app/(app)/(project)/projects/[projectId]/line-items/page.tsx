import { ListChecks } from "lucide-react";
import { ImportDialog } from "@/components/line-items/import-dialog";
import { LineItemsTable } from "@/components/line-items/line-items-table";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { db } from "@/lib/db";
import { BOQ } from "@/lib/line-items/terms";
import { requireProject } from "@/lib/auth/session";
import { countedModels, measuredQuantities } from "@/lib/mapping/server";

export default async function LineItemsPage({ params }: PageProps<"/projects/[projectId]/line-items">) {
  const { project } = await requireProject((await params).projectId);
  const items = await db.lineItem.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" } });
  const measured = items.length ? await measuredQuantities(project.id, await countedModels(project.id)) : new Map();

  const rows = items.map((i) => ({
    id: i.id,
    parentId: i.parentId,
    code: i.code,
    description: i.description,
    unit: i.unit,
    billingType: i.billingType,
    contractQuantity: i.contractQuantity === null ? null : Number(i.contractQuantity),
    rate: i.rate === null ? null : Number(i.rate),
    scheduledValue: i.scheduledValue === null ? null : Number(i.scheduledValue),
    isHeading: i.isHeading,
    measured: (() => {
      const m = measured.get(i.id);
      if (!m || (m.model === null && m.drawings === null)) return undefined;
      return { quantity: (m.model ?? 0) + (m.drawings ?? 0), fromModel: m.model !== null, fromDrawings: m.drawings !== null };
    })(),
  }));

  return (
    <PageBody>
      <PageHeader
        title={BOQ.title}
        description={`The contract's priced ${BOQ.items}. Model quantities and sheet measurements are priced against them.`}
        actions={items.length > 0 && <ImportDialog projectId={project.id} currency={project.currency} hasItems />}
      />
      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <ListChecks className="size-6" />
            </div>
            <p className="font-medium">No {BOQ.title} yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Import your {BOQ.title} from Excel or CSV, in whatever layout you have it.
            </p>
            <ImportDialog projectId={project.id} currency={project.currency} hasItems={false} label="Import from Excel or CSV" variant="default" />
          </CardContent>
        </Card>
      ) : (
        <LineItemsTable projectId={project.id} currency={project.currency} items={rows} />
      )}
    </PageBody>
  );
}
