import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";

const SOURCE_LABELS: Record<string, string> = {
  qto_set: "Quantity sets",
  property: "Model properties",
  geometry: "Computed geometry",
  missing: "No quantity",
};

/** Per-category element counts and where their quantities came from. */
export async function ElementSummary({ modelVersionId }: { modelVersionId: string }) {
  const [byCategory, bySource, total] = await Promise.all([
    db.element.groupBy({
      by: ["category"],
      where: { modelVersionId },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
    }),
    db.element.groupBy({
      by: ["quantitySource"],
      where: { modelVersionId },
      _count: { _all: true },
    }),
    db.element.count({ where: { modelVersionId } }),
  ]);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No elements have been read from this model yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="default">{total.toLocaleString()} elements</Badge>
        {bySource.map((s) => (
          <Badge key={s.quantitySource} variant={s.quantitySource === "missing" ? "destructive" : "secondary"}>
            {SOURCE_LABELS[s.quantitySource] ?? s.quantitySource}: {s._count._all.toLocaleString()}
          </Badge>
        ))}
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Elements</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byCategory.map((c) => (
              <TableRow key={c.category ?? "none"}>
                <TableCell>{c.category ?? "Uncategorised"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c._count._all.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
