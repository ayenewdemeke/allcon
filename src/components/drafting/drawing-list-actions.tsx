"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createDrawing, deleteDrawing, renameDrawing, type DrawingFormState } from "@/app/actions/drawings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewDrawingDialog({ projectId, label = "New drawing" }: { projectId: string; label?: string }) {
  const [state, action, pending] = useActionState<DrawingFormState, FormData>(createDrawing.bind(null, projectId), {});
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New drawing</DialogTitle>
          <DialogDescription>It opens in the drafting editor, in the project&apos;s units.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="drawing-name">Name</Label>
            <Input id="drawing-name" name="name" required autoFocus placeholder="e.g. Site plan, Footing details" />
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

export function DrawingRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const rename = () => {
    const next = window.prompt("Rename drawing", name)?.trim();
    if (!next || next === name) return;
    start(async () => {
      try {
        await renameDrawing(id, next);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not rename the drawing");
      }
    });
  };
  const remove = () => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    start(async () => {
      try {
        await deleteDrawing(id);
        toast.success("Drawing deleted");
      } catch {
        toast.error("Could not delete the drawing");
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
