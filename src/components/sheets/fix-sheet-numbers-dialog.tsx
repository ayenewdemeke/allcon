"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hash, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { applySheetNumbers, previewSheetNumbers, type SheetNumberChange } from "@/app/actions/sheets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Re-reads a set's title blocks and offers the corrected sheet numbers, one checkbox each. */
export function FixSheetNumbersButton({ drawingSetId, fileName }: { drawingSetId: string; fileName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changes, setChanges] = useState<SheetNumberChange[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function start() {
    setLoading(true);
    try {
      const found = await previewSheetNumbers(drawingSetId);
      if (!found.length) {
        toast.success("The sheet numbers already match the title blocks");
        return;
      }
      setChanges(found);
      setPicked(new Set(found.map((c) => c.sheetId)));
      setOpen(true);
    } catch {
      toast.error("Could not read the title blocks");
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    setSaving(true);
    try {
      await applySheetNumbers(
        drawingSetId,
        changes.filter((c) => picked.has(c.sheetId)).map((c) => ({ sheetId: c.sheetId, number: c.detected })),
      );
      toast.success(`Updated ${picked.size} sheet number${picked.size === 1 ? "" : "s"}`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Could not update the sheet numbers");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={loading} onClick={start}>
        {loading ? <Loader2 className="animate-spin" /> : <Hash />} {loading ? "Reading title blocks…" : "Fix sheet numbers"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fix sheet numbers</DialogTitle>
            <DialogDescription>
              Numbers read again from the title blocks of {fileName}. Untick any you named yourself and want to keep.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set(changes.map((c) => c.sheetId)))}>
              All
            </button>
            <span className="text-muted-foreground">·</span>
            <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set())}>
              None
            </button>
          </div>
          <ul className="divide-y rounded-lg border text-sm">
            {changes.map((c) => (
              <li key={c.sheetId}>
                <label className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={picked.has(c.sheetId)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (e.target.checked) next.add(c.sheetId);
                        else next.delete(c.sheetId);
                        return next;
                      })
                    }
                  />
                  <span className="w-14 text-xs text-muted-foreground">Page {c.page}</span>
                  <span className="text-muted-foreground line-through">{c.current ?? "—"}</span>
                  <span>→</span>
                  <span className="font-medium">{c.detected}</span>
                  {c.title && <span className="truncate text-xs text-muted-foreground">{c.title}</span>}
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={saving || !picked.size}>
              {saving && <Loader2 className="animate-spin" />} Update {picked.size} sheet{picked.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
