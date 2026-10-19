"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Link2, Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteIfcModel } from "@/app/actions/models3d";
import { createModelShareLink, listModelShareLinks, revokeModelShareLink, type ModelShareSummary } from "@/app/actions/model-share";
import { CopyButton } from "@/components/sheets/viewer/export-share-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";

// The model page's header actions for its owner: share a read-only link, download, delete.

export function ModelActions({ projectId, model }: { projectId: string; model: { id: string; name: string } }) {
  const router = useRouter();
  const remove = async () => {
    if (!window.confirm(`Delete "${model.name}" and its revisions?`)) return;
    try {
      await deleteIfcModel(model.id);
      router.push(`/projects/${projectId}/models`);
    } catch {
      toast.error("Could not delete the model");
    }
  };
  return (
    <>
      <ShareModelDialog modelId={model.id} />
      <LinkButton href={`/api/ifc-models/${model.id}/ifc?download=1`} variant="outline" size="sm" prefetch={false}>
        <Download /> <span className="max-sm:hidden">Download IFC</span>
      </LinkButton>
      <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={remove} title="Delete model" aria-label="Delete model">
        <Trash2 />
      </Button>
    </>
  );
}

function ShareModelDialog({ modelId }: { modelId: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30); // 0 = no expiry
  const [download, setDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [links, setLinks] = useState<ModelShareSummary[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLinks(await listModelShareLinks(modelId));
    } catch {
      setLinks([]);
    }
  }, [modelId]);

  async function create() {
    setBusy(true);
    try {
      const link = await createModelShareLink(modelId, { allowDownload: download, expiresInDays: days || null });
      setCreated(link.url);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await revokeModelShareLink(id);
      toast.success("Link revoked. It no longer opens.");
      if (links?.find((l) => l.id === id)?.url === created) setCreated(null);
      await refresh();
    } catch {
      toast.error("Could not revoke the link");
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void refresh();
        else setCreated(null);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Share2 /> <span className="max-sm:hidden">Share</span>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share a read-only link</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this model in 3D, without an account, until it expires or you revoke it. It always shows the latest revision.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="grid gap-2 rounded-lg border border-success/40 bg-success/5 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Link2 className="size-4" /> Link ready
            </p>
            <div className="flex gap-2">
              <Input readOnly value={created} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <CopyButton text={created} />
            </div>
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setCreated(null)}>
              Create another
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="model-share-expiry" className="text-xs">
                  Expires after
                </Label>
                <select
                  id="model-share-expiry"
                  className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={0}>Never (until revoked)</option>
                </select>
              </div>
              <label className="flex items-end gap-2 pb-1.5 text-sm">
                <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} /> Allow IFC download
              </label>
            </div>
            <Button onClick={create} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Create link
            </Button>
          </div>
        )}

        {links && links.length > 0 && (
          <div className="grid gap-2 border-t pt-3">
            <Label className="text-xs">Links for this model</Label>
            <ul className="grid gap-1.5">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <Badge variant={l.active ? "success" : "secondary"}>{l.active ? "Active" : "Off"}</Badge>
                      {l.allowDownload ? "View and download" : "View only"}
                    </p>
                    <p className="text-muted-foreground">
                      Created {fmt(l.createdAt)} · {!l.active ? "revoked or expired" : l.expiresAt ? `expires ${fmt(l.expiresAt)}` : "no expiry"} · {l.viewCount} view
                      {l.viewCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {l.active && (
                    <>
                      <CopyButton text={l.url} />
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => revoke(l.id)}>
                        Revoke
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
