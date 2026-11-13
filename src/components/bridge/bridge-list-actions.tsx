"use client";

import { useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { FileUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createBridge, deleteBridge, renameBridge } from "@/app/actions/bridge";
import { Button } from "@/components/ui/button";
import { parseMct } from "@/lib/bridge/mct";
import { analyze } from "@/lib/bridge/solver";

export function NewBridgeButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await createBridge(); // opens it
          } catch (err) {
            unstable_rethrow(err); // the redirect to the new bridge isn't a failure
            toast.error(err instanceof Error ? err.message : "Could not start the bridge");
          }
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Plus />}
      New bridge
    </Button>
  );
}

/** Import a midas Civil text model (MCT): read in the browser, checked by analyzing it, then kept as a bridge. */
export function ImportBridgeButton() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const take = async (file: File) => {
    setBusy(true);
    try {
      const { model, report } = parseMct(await file.text());
      if (model.nodes.length < 2 || !model.elements.length) throw new Error("No beam or truss members were found in the file. Export it from midas Civil as an MCT file (File > Export > midas Civil MCT File).");
      if (!model.loadCases.length) model.loadCases.push({ name: "No load", type: "USER" });
      analyze(model); // an unstable or incomplete model is refused here, with the reason
      const res = await fetch("/api/bridges/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, "").slice(0, 200) || "Imported model", source: file.name.slice(0, 200), model, report }) });
      if (!res.ok) throw new Error((await res.text()) || "Could not keep the model");
      const { id } = (await res.json()) as { id: string };
      toast.success(`Imported: ${model.nodes.length} nodes, ${model.elements.length} members${report.warnings.length ? `, ${report.warnings.length} notes to read` : ""}`);
      router.push(`/bridges/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" accept=".mct,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && void take(e.target.files[0])} />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()} title="A midas Civil text model: File > Export > midas Civil MCT File">
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
        Import MCT
      </Button>
    </>
  );
}

export function BridgeRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const rename = () => {
    const next = window.prompt("Rename bridge", name)?.trim();
    if (!next || next === name) return;
    start(async () => {
      try {
        await renameBridge(id, next);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not rename the bridge");
      }
    });
  };
  const remove = () => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    start(async () => {
      try {
        await deleteBridge(id);
        toast.success("Bridge deleted");
      } catch {
        toast.error("Could not delete the bridge");
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
