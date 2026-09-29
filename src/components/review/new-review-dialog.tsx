"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createReview } from "@/app/actions/reviews";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";

const selectClass = "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm";

export function NewReviewDialog({
  projectId,
  drawingSets,
  references,
  label = "New review",
}: {
  projectId: string;
  drawingSets: { id: string; fileName: string; pageCount: number | null }[];
  references: { id: string; title: string }[];
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [setId, setSetId] = useState(drawingSets[0]?.id ?? "");
  const [refIds, setRefIds] = useState<string[]>(references.length === 1 ? [references[0].id] : []);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const set = drawingSets.find((s) => s.id === setId);
      const id = await createReview(projectId, {
        name: name.trim() || `Review of ${set?.fileName.replace(/\.pdf$/i, "") ?? "drawings"}`,
        drawingSetId: setId,
        referenceIds: refIds,
      });
      router.push(`/projects/${projectId}/reviews/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the review");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus /> {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New plan review</DialogTitle>
          <DialogDescription>Check a drawing set against manuals from your library. You pick which sheets to review next.</DialogDescription>
        </DialogHeader>
        {!drawingSets.length || !references.length ? (
          <div className="space-y-3 text-sm">
            {!drawingSets.length && <p>Upload a drawing set in Sheets first.</p>}
            {!references.length && (
              <>
                <p>Add a manual to the library first, such as a design manual PDF.</p>
                <LinkButton href="/library" variant="outline" size="sm">
                  Go to Library
                </LinkButton>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="review-name" className="text-xs">
                  Name
                </Label>
                <Input id="review-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 90% submittal review" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="review-set" className="text-xs">
                  Drawing set
                </Label>
                <select id="review-set" className={selectClass} value={setId} onChange={(e) => setSetId(e.target.value)}>
                  {drawingSets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fileName}
                      {s.pageCount ? ` (${s.pageCount} sheets)` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Check against</Label>
                {references.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={refIds.includes(r.id)}
                      onChange={(e) => setRefIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                    />
                    {r.title}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !setId || !refIds.length}>
                {busy && <Loader2 className="animate-spin" />} Create review
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
