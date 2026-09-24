"use client";

import { Fragment, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteLineItem } from "@/app/actions/line-items";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber } from "@/lib/format";
import { lineValue } from "@/lib/line-items/import";
import { LineItemDialog, type EditableLineItem } from "./line-item-dialog";

export type LineItemRow = EditableLineItem & {
  parentId: string | null;
  measured?: { quantity: number; fromModel: boolean; fromDrawings: boolean };
};

export function LineItemsTable({
  projectId,
  currency,
  items,
}: {
  projectId: string;
  currency: string;
  items: LineItemRow[];
}) {
  const [editing, setEditing] = useState<EditableLineItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const money = (v: number) => formatMoney(v, currency);

  const sectionTotals = new Map<string, number>();
  for (const i of items) if (i.parentId && !i.isHeading) sectionTotals.set(i.parentId, (sectionTotals.get(i.parentId) ?? 0) + lineValue(i));
  const total = items.filter((i) => !i.isHeading).reduce((s, i) => s + lineValue(i), 0);

  async function remove(item: EditableLineItem) {
    if (!confirm(`Delete "${item.description}"?${item.isHeading ? " Lines under this heading are deleted too." : ""}`)) return;
    try {
      await deleteLineItem(item.id);
      toast.success("Line item deleted");
    } catch {
      toast.error("Could not delete");
    }
  }

  const open = (item: EditableLineItem | null) => {
    setEditing(item);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => open(null)}>
          <Plus /> Add line item
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-28 pl-4">Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-16">Unit</TableHead>
              <TableHead className="w-28 text-right">Quantity</TableHead>
              <TableHead className="w-32 text-right">Measured</TableHead>
              <TableHead className="w-28 text-right">Rate</TableHead>
              <TableHead className="w-36 text-right">Value</TableHead>
              <TableHead className="w-20 pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <Fragment key={i.id}>
                {i.isHeading ? (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell className="pl-4 font-semibold">{i.code}</TableCell>
                    <TableCell className="font-semibold" colSpan={5}>
                      {i.description}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(sectionTotals.get(i.id) ?? 0)}</TableCell>
                    <RowActions onEdit={() => open(i)} onDelete={() => remove(i)} />
                  </TableRow>
                ) : (
                  <TableRow className="group">
                    <TableCell className="pl-4 text-muted-foreground">{i.code}</TableCell>
                    <TableCell className="max-w-md">
                      <span className="line-clamp-2">{i.description}</span>
                    </TableCell>
                    <TableCell>{i.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(i.contractQuantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {i.measured ? (
                        <>
                          {formatNumber(i.measured.quantity, 1)}
                          <span className="block text-[10px] text-muted-foreground">
                            {[i.measured.fromModel && "model", i.measured.fromDrawings && "drawings"].filter(Boolean).join(" + ")}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {i.billingType === "lump_sum" ? <span className="text-xs text-muted-foreground">Lump sum</span> : i.rate == null ? "—" : money(i.rate)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(lineValue(i))}</TableCell>
                    <RowActions onEdit={() => open(i)} onDelete={() => remove(i)} />
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4" colSpan={6}>
                Contract total
              </TableCell>
              <TableCell className="text-right text-base tabular-nums">{money(total)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <LineItemDialog key={editing?.id ?? "new"} projectId={projectId} item={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <TableCell className="pr-4">
      <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
        <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit">
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onDelete} aria-label="Delete">
          <Trash2 />
        </Button>
      </div>
    </TableCell>
  );
}
