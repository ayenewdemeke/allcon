"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteReference, renameReference } from "@/app/actions/reviews";
import { Button } from "@/components/ui/button";

export function ReferenceActions({ referenceId, title }: { referenceId: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          const next = window.prompt("Manual name", title)?.trim();
          if (!next || next === title) return;
          try {
            await renameReference(referenceId, next);
            router.refresh();
          } catch {
            toast.error("Could not rename the manual");
          }
        }}
      >
        <Pencil /> Rename
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Delete "${title}" from the library? Past review findings keep their text but lose the link.`)) return;
          setBusy(true);
          try {
            await deleteReference(referenceId);
            router.push("/library");
          } catch {
            toast.error("Could not delete the manual");
            setBusy(false);
          }
        }}
      >
        <Trash2 /> Delete
      </Button>
    </>
  );
}
