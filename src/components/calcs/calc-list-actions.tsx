"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createCalc, createImportedCalc, deleteCalc, renameCalc, type CalcFormState } from "@/app/actions/calcs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TEMPLATES } from "@/lib/calcs/library/templates";
import { uploadCalc } from "./upload";

export function NewCalcDialog({ label = "New worksheet", projects }: { label?: string; projects: { id: string; name: string }[] }) {
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
          {projects.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="calc-project">Project</Label>
              <select id="calc-project" name="project" defaultValue="" className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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

/** Opening a Mathcad Prime (.mcdx) or SMath Studio (.sm) worksheet as a Calcs worksheet. */
export function ImportCalcDialog({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // Read in the browser (the reader loads only now).
      const { importWorksheet } = await import("@/lib/calcs/import");
      const { data, report } = importWorksheet(file.name, new Uint8Array(await file.arrayBuffer()));
      const { id } = await createImportedCalc(file.name, projectId || null);
      await uploadCalc(id, data);
      try {
        sessionStorage.setItem(`calc-import:${id}`, JSON.stringify(report));
      } catch {
        // The summary is a nicety.
      }
      router.push(`/calcs/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that file");
      setBusy(false);
    }
  };
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        <FileUp />
        Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import a worksheet</DialogTitle>
          <DialogDescription>From Mathcad Prime (.mcdx) or SMath Studio (.sm): its math, text, solve blocks and plots, where they were. Anything that can&apos;t come across is noted in place.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="calc-file">File</Label>
            <Input id="calc-file" type="file" accept=".mcdx,.sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {projects.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="calc-import-project">Project</Label>
              <select id="calc-import-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm">
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button onClick={() => void run()} disabled={!file || busy}>
              {busy ? "Importing…" : "Import and open"}
            </Button>
          </div>
        </div>
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
