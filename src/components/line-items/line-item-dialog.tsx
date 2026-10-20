"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createLineItem, updateLineItem, type LineItemInput } from "@/app/actions/line-items";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseNumber } from "@/lib/line-items/import";
import { useBoqTerms } from "@/components/line-items/boq-terms";
import { capitalize } from "@/lib/line-items/terms";

export type EditableLineItem = LineItemInput & { id: string };

const UNITS = ["CY", "CF", "m3", "SF", "SY", "m2", "LF", "m", "EA", "LS", "TON", "t"];
const selectClass = "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm";
const numberText = (n: number | null) => (n == null ? "" : String(n));

/** Add or edit one line item. */
export function LineItemDialog({
  projectId,
  item,
  open,
  onOpenChange,
}: {
  projectId: string;
  item: EditableLineItem | null; // null = new
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const terms = useBoqTerms();
  const [pending, setPending] = useState(false);
  const [billingType, setBillingType] = useState(item?.billingType ?? "unit_price");
  const [isHeading, setIsHeading] = useState(item?.isHeading ?? false);

  async function submit(form: FormData) {
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const input: LineItemInput = {
      code: get("code") || null,
      description: get("description"),
      unit: isHeading ? null : get("unit") || null,
      billingType,
      contractQuantity: isHeading ? null : parseNumber(get("quantity")),
      rate: isHeading || billingType === "lump_sum" ? null : parseNumber(get("rate")),
      scheduledValue: isHeading || billingType === "unit_price" ? null : parseNumber(get("value")),
      isHeading,
    };
    setPending(true);
    try {
      if (item) await updateLineItem(item.id, input);
      else await createLineItem(projectId, input);
      toast.success(`${capitalize(terms.item)} ${item ? "updated" : "added"}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form action={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{`${item ? "Edit" : "Add"} ${terms.item}`}</DialogTitle>
            <DialogDescription>A line of your schedule of values or bill of quantities.</DialogDescription>
          </DialogHeader>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isHeading} onChange={(e) => setIsHeading(e.target.checked)} />
            Section heading (groups the lines below it, no quantity of its own)
          </label>

          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="li-code">Code</Label>
              <Input id="li-code" name="code" defaultValue={item?.code ?? ""} placeholder="03 30 00" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="li-desc">Description</Label>
              <Input id="li-desc" name="description" required defaultValue={item?.description ?? ""} />
            </div>
          </div>

          {!isHeading && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="li-billing">Billing</Label>
                  <select
                    id="li-billing"
                    className={selectClass}
                    value={billingType}
                    onChange={(e) => setBillingType(e.target.value as typeof billingType)}
                  >
                    <option value="unit_price">Unit price (quantity × rate)</option>
                    <option value="lump_sum">Lump sum</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="li-unit">Unit</Label>
                  <Input id="li-unit" name="unit" list="li-units" defaultValue={item?.unit ?? ""} placeholder="CY, SF, LF, EA…" />
                  <datalist id="li-units">
                    {UNITS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="li-qty">Contract quantity</Label>
                  <Input id="li-qty" name="quantity" inputMode="decimal" defaultValue={numberText(item?.contractQuantity ?? null)} />
                </div>
                {billingType === "unit_price" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="li-rate">Unit rate</Label>
                    <Input id="li-rate" name="rate" inputMode="decimal" defaultValue={numberText(item?.rate ?? null)} />
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <Label htmlFor="li-value">Scheduled value</Label>
                    <Input id="li-value" name="value" inputMode="decimal" defaultValue={numberText(item?.scheduledValue ?? null)} />
                  </div>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : item ? "Save changes" : `Add ${terms.item}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
