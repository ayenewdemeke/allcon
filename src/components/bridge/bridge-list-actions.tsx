"use client";

import { useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createBridge, deleteBridge, renameBridge } from "@/app/actions/bridge";
import { Button } from "@/components/ui/button";

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
