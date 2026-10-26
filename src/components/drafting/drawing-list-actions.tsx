"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createDrawing, deleteDrawing, renameDrawing, type DrawingFormState } from "@/app/actions/drawings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewDrawingDialog({ label = "New drawing" }: { label?: string }) {
  const [state, action, pending] = useActionState<DrawingFormState, FormData>(createDrawing, {});
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New drawing</DialogTitle>
          <DialogDescription>It opens full screen in the drafting editor.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="drawing-name">Name</Label>
            <Input id="drawing-name" name="name" required autoFocus placeholder="e.g. Site plan, Footing details" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="drawing-units">Units</Label>
            <select id="drawing-units" name="units" defaultValue="architectural" className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="architectural">Architectural (feet and inches)</option>
              <option value="mm">Millimeters</option>
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

/** Opens a DXF (from AutoCAD or any CAD program) as a new drawing. */
export function ImportDxfDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [units, setUnits] = useState("auto");
  const [step, setStep] = useState<"idle" | "uploading" | "converting">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setError(null);
    try {
      setStep("uploading");
      const link = await fetch("/api/drafting/import", { method: "POST" });
      if (!link.ok) throw new Error("Could not upload the file");
      const { key, upload } = (await link.json()) as { key: string; upload: { url: string; headers: Record<string, string> } };
      const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file });
      if (!put.ok) throw new Error("Could not upload the file");
      setStep("converting");
      const res = await fetch("/api/drafting/import", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, name: name.trim(), units }) });
      const body = (await res.json().catch(() => ({}))) as { id?: string; count?: number; skipped?: Record<string, number>; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Could not read this DXF");
      const skipped = Object.entries(body.skipped ?? {}).map(([type, n]) => `${n} ${type}`);
      toast.success(`Imported ${body.count?.toLocaleString()} objects`, skipped.length ? { description: `Left out: ${skipped.join(", ")}` } : undefined);
      router.push(`/drafting/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import the file");
      setStep("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => step === "idle" && setOpen(o)}>
      <DialogTrigger render={<Button variant="outline" />}>
        <FileUp />
        Import DXF
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import DXF</DialogTitle>
          <DialogDescription>Opens a DXF from AutoCAD or another CAD program as a new drawing: layers, blocks, text, dimensions and hatches come along. (Save DWG files as DXF first.)</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="dxf-file">File</Label>
            <Input
              id="dxf-file"
              type="file"
              accept=".dxf"
              required
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.dxf$/i, ""));
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dxf-name">Name</Label>
            <Input id="dxf-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dxf-units">Units</Label>
            <select id="dxf-units" value={units} onChange={(e) => setUnits(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="auto">As saved in the file</option>
              <option value="architectural">Architectural (feet and inches)</option>
              <option value="mm">Millimeters</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={step !== "idle" || !file}>
              {step === "uploading" ? "Uploading…" : step === "converting" ? "Reading the drawing…" : "Import and open"}
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
