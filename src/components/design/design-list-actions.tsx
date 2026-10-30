"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createDesign, deleteDesign, renameDesign } from "@/app/actions/design";
import { Button } from "@/components/ui/button";

/** Starts a design of a kind (filed under a project if one's chosen). */
export function NewDesignButton({ kind, available, projects }: { kind: string; available: boolean; projects: { id: string; name: string }[] }) {
  const [projectId, setProjectId] = useState("");
  const [pending, start] = useTransition();
  if (!available) return <span className="text-xs text-muted-foreground">Coming next</span>;
  return (
    <div className="flex items-center gap-2">
      {projects.length > 0 && (
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-8 max-w-40 rounded-lg border border-input bg-transparent px-2 text-xs" aria-label="Project">
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              await createDesign(kind, projectId || null); // opens it
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not start the design");
            }
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        New design
      </Button>
    </div>
  );
}

export function DesignRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const rename = () => {
    const next = window.prompt("Rename design", name)?.trim();
    if (!next || next === name) return;
    start(async () => {
      try {
        await renameDesign(id, next);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not rename the design");
      }
    });
  };
  const remove = () => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    start(async () => {
      try {
        await deleteDesign(id);
        toast.success("Design deleted");
      } catch {
        toast.error("Could not delete the design");
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
