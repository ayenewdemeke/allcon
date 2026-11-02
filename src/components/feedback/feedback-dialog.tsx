"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { sendFeedback } from "@/app/actions/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FEEDBACK_KINDS, MAX_ATTACHMENT_SIZE, MAX_ATTACHMENTS, MAX_MESSAGE, type Attachment, type FeedbackKind } from "@/lib/feedback";
import { cn } from "@/lib/utils";

// Sending feedback from anywhere in the app: what kind, what they'd like, and any files (a
// screenshot, a drawing, a model). The page it's sent from goes with it.

type Upload = Attachment & { upload: { url: string; headers: Record<string, string> } };

async function uploadFiles(files: File[]): Promise<Attachment[]> {
  if (!files.length) return [];
  const res = await fetch("/api/feedback/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }),
  });
  const data = (await res.json().catch(() => ({}))) as { uploads?: Upload[]; error?: string };
  if (!res.ok || !data.uploads) throw new Error(data.error ?? "Could not attach the files");
  await Promise.all(
    data.uploads.map(async (u, i) => {
      const put = await fetch(u.upload.url, { method: "PUT", headers: u.upload.headers, body: files[i] });
      if (!put.ok) throw new Error(`Could not upload ${files[i].name}`);
    }),
  );
  return data.uploads.map(({ key, name, type, size }) => ({ key, name, type, size }));
}

const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  const addFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    const tooBig = picked.find((f) => f.size > MAX_ATTACHMENT_SIZE);
    if (tooBig) toast.error(`${tooBig.name} is over 50 MB`);
    const next = [...files, ...picked.filter((f) => f.size <= MAX_ATTACHMENT_SIZE)];
    if (next.length > MAX_ATTACHMENTS) toast.error(`Up to ${MAX_ATTACHMENTS} files`);
    setFiles(next.slice(0, MAX_ATTACHMENTS));
  };

  const send = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const attachments = await uploadFiles(files);
      const query = search.toString();
      await sendFeedback({ kind, message, page: `${pathname}${query ? `?${query}` : ""}`, userAgent: navigator.userAgent, attachments });
      toast.success("Thanks! Your feedback was sent", { description: "You can follow it under Your feedback." });
      setMessage("");
      setFiles([]);
      setKind("idea");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your feedback");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>An idea, something that isn&apos;t working, or a question. The page you&apos;re on is sent with it.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Kind">
          {FEEDBACK_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={cn("rounded-full border px-3 py-1 text-xs", kind === k.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {k.label}
            </button>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MAX_MESSAGE}
          rows={6}
          autoFocus
          placeholder={kind === "bug" ? "What happened, and what did you expect?" : kind === "question" ? "What would you like to know?" : "What would you like to see?"}
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="space-y-1.5">
          {files.map((f, i) => (
            <div key={`${f.name}${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <Paperclip className="size-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground">{sizeText(f.size)}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="rounded p-0.5 hover:bg-accent">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {files.length < MAX_ATTACHMENTS && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Paperclip className="size-3.5" />
              Attach files (screenshots, drawings, models; up to {MAX_ATTACHMENTS}, 50 MB each)
              <input type="file" multiple className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending || !message.trim()}>
            {sending && <Loader2 className="animate-spin" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
