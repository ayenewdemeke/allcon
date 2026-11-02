"use client";

import { Suspense, useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { reviewFeedback } from "@/app/actions/feedback";
import { Button } from "@/components/ui/button";
import { FEEDBACK_STATUSES, type FeedbackStatus } from "@/lib/feedback";
import { FeedbackDialog } from "./feedback-dialog";

export function SendFeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <MessageSquarePlus />
        Send feedback
      </Button>
      <Suspense>
        <FeedbackDialog open={open} onOpenChange={setOpen} />
      </Suspense>
    </>
  );
}

/** An admin's status and reply on one item (the sender sees both). */
export function FeedbackReview({ id, status, reply }: { id: string; status: string; reply: string }) {
  const [s, setS] = useState(status as FeedbackStatus);
  const [text, setText] = useState(reply);
  const [saving, setSaving] = useState(false);
  const changed = s !== status || text.trim() !== reply.trim();
  const save = async () => {
    setSaving(true);
    try {
      await reviewFeedback(id, { status: s, reply: text });
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-wrap items-start gap-2 border-t pt-2">
      <select value={s} onChange={(e) => setS(e.target.value as FeedbackStatus)} aria-label="Status" className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
        {FEEDBACK_STATUSES.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Reply (the sender sees it)" aria-label="Reply" className="min-h-8 min-w-60 flex-1 resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:border-ring" />
      <Button size="sm" onClick={save} disabled={!changed || saving}>
        {saving && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </div>
  );
}
