"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createCalc, deleteCalc, renameCalc, type CalcFormState } from "@/app/actions/calcs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATES } from "@/lib/calcs/library/templates";

export function NewCalcDialog({ label = "New worksheet" }: { label?: string }) {
  const [state, action, pending] = useActionState<CalcFormState, FormData>(createCalc, {});
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New worksheet</DialogTitle>
          <DialogDescription>Math with units, laid out on pages like Mathcad. It opens full screen.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="calc-name">Name</Label>
            <Input id="calc-name" name="name" required autoFocus placeholder="e.g. Beam B2 design, Footing F1" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="calc-template">Start from</Label>
            <select id="calc-template" name="template" defaultValue="" className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="">A blank worksheet</option>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id} title={t.description}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="calc-system">Units</Label>
            <select id="calc-system" name="system" defaultValue="USCS" className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="USCS">US customary (kip, ft, ksi)</option>
              <option value="SI">SI (kN, m, MPa)</option>
            </select>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create and open"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CalcRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const rename = () => {
    const next = window.prompt("Rename worksheet", name)?.trim();
    if (!next || next === name) return;
    start(async () => {
      try {
        await renameCalc(id, next);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not rename the worksheet");
      }
    });
  };
  const remove = () => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    start(async () => {
      try {
        await deleteCalc(id);
        toast.success("Worksheet deleted");
      } catch {
        toast.error("Could not delete the worksheet");
      }
    });
  };
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon-sm" onClick={rename} disabled={pending} title="Rename" aria-label={`Rename ${name}`}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={remove} disabled={pending} title="Delete" aria-label={`Delete ${name}`}>
        {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
    </div>
  );
}
