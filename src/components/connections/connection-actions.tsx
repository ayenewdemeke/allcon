"use client";

import { useState } from "react";
import { Check, Copy, Loader2, RotateCcw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { disconnectApp, undoActivity } from "@/app/actions/connections";
import { Button } from "@/components/ui/button";

export function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <code className="flex h-9 min-w-0 flex-1 items-center truncate rounded-lg border bg-muted/40 px-3 text-sm">{url}</code>
      <Button
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function DisconnectButton({ clientId, name }: { clientId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await disconnectApp(clientId);
          toast.success(`Disconnected ${name}`);
        } catch {
          toast.error("Could not disconnect it");
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Unplug />} Disconnect
    </Button>
  );
}

export function UndoButton({ activityId }: { activityId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await undoActivity(activityId);
          toast.success("Removed those markups");
        } catch {
          toast.error("Could not undo that");
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Undo
    </Button>
  );
}
