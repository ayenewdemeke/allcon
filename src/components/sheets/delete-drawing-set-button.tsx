"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDrawingSet } from "@/app/actions/sheets";
import { Button } from "@/components/ui/button";

export function DeleteDrawingSetButton({ drawingSetId, fileName, sheetCount }: { drawingSetId: string; fileName: string; sheetCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive"
      disabled={busy}
      onClick={async () => {
        const sheets = sheetCount === 1 ? "its sheet and the markups on it" : `its ${sheetCount} sheets and the markups on them`;
        if (!window.confirm(`Delete "${fileName}"? This removes ${sheets}, any share links and reviews of it, and the PDF. It can't be undone.`)) return;
        setBusy(true);
        try {
          await deleteDrawingSet(drawingSetId);
          toast.success(`Deleted ${fileName}`);
          router.refresh();
        } catch {
          toast.error("Could not delete the drawing set");
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete set
    </Button>
  );
}
