"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Download, Link2, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { createShareLink, getExportData, listShareLinks, revokeShareLink, type ShareLinkSummary } from "@/app/actions/share";
import { Badge } from "@/components/ui/badge";
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
import { downloadMarkedUpPdf } from "@/lib/pdf/export-client";

export type ScopeSheet = { id: string; markupCount: number };
type Scope = "sheet" | "marked" | "all";

const selectClass = "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm";

function ScopePicker({
  scope,
  onChange,
  sheets,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
  sheets: ScopeSheet[];
}) {
  const marked = sheets.filter((s) => s.markupCount > 0).length;
  const options: [Scope, string][] = [
    ["sheet", "This sheet"],
    ["marked", `Sheets with markups (${marked})`],
    ["all", `The whole set (${sheets.length} sheets)`],
  ];
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">Sheets</Label>
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <input type="radio" checked={scope === value} onChange={() => onChange(value)} disabled={value === "marked" && !marked} />
          {label}
        </label>
      ))}
    </div>
  );
}

const pickSheets = (scope: Scope, sheets: ScopeSheet[], current: string) =>
  scope === "sheet" ? [current] : scope === "marked" ? sheets.filter((s) => s.markupCount > 0 || s.id === current).map((s) => s.id) : sheets.map((s) => s.id);

// --- export -----------------------------------------------------------------------------------

export function ExportPdfDialog({
  drawingSetId,
  currentSheetId,
  sheets,
  hasLineItems,
  author,
}: {
  drawingSetId: string;
  currentSheetId: string;
  sheets: ScopeSheet[];
  hasLineItems: boolean;
  author: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("sheet");
  const [summary, setSummary] = useState(true);
  const [prices, setPrices] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const ids = pickSheets(scope, sheets, currentSheetId);
      const data = await getExportData(drawingSetId, scope === "all" ? null : ids, prices);
      await downloadMarkedUpPdf({ pdfUrl: `${window.location.origin}/api/drawings/${drawingSetId}/pdf`, data, summary, author });
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Download /> <span className="hidden xl:inline">Export PDF</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export marked-up PDF</DialogTitle>
          <DialogDescription>
            Markups become standard PDF annotations, so they can be reviewed and commented on in Acrobat or Bluebeam.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <ScopePicker scope={scope} onChange={setScope} sheets={sheets} />
          <div className="grid gap-1.5">
            <Label className="text-xs">Include</Label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} /> A summary page listing the measurements
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prices} disabled={!hasLineItems} onChange={(e) => setPrices(e.target.checked)} /> Line items and prices
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- share ------------------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function ShareDialog({
  drawingSetId,
  currentSheetId,
  sheets,
  hasLineItems,
}: {
  drawingSetId: string;
  currentSheetId: string;
  sheets: ScopeSheet[];
  hasLineItems: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("sheet");
  const [days, setDays] = useState(30); // 0 = no expiry
  const [prices, setPrices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [links, setLinks] = useState<ShareLinkSummary[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLinks(await listShareLinks(drawingSetId));
    } catch {
      setLinks([]);
    }
  }, [drawingSetId]);

  async function create() {
    setBusy(true);
    try {
      const link = await createShareLink(drawingSetId, { sheetIds: pickSheets(scope, sheets, currentSheetId), includePrices: prices, expiresInDays: days || null });
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
      await revokeShareLink(id);
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
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Share2 /> <span className="hidden xl:inline">Share</span>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share a read-only link</DialogTitle>
          <DialogDescription>Anyone with the link can view these sheets and their markups, without an account, until it expires or you revoke it.</DialogDescription>
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
            <ScopePicker scope={scope} onChange={setScope} sheets={sheets} />
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="share-expiry" className="text-xs">
                  Expires after
                </Label>
                <select id="share-expiry" className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={0}>Never (until revoked)</option>
                </select>
              </div>
              <label className="flex items-end gap-2 pb-1.5 text-sm">
                <input type="checkbox" checked={prices} disabled={!hasLineItems} onChange={(e) => setPrices(e.target.checked)} /> Show line items and prices
              </label>
            </div>
            <Button onClick={create} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Create link
            </Button>
          </div>
        )}

        {links && links.length > 0 && (
          <div className="grid gap-2 border-t pt-3">
            <Label className="text-xs">Links for this drawing set</Label>
            <ul className="grid gap-1.5">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <Badge variant={l.active ? "success" : "secondary"}>{l.active ? "Active" : "Off"}</Badge>
                      {l.sheetCount} sheet{l.sheetCount === 1 ? "" : "s"}
                      {l.includePrices && <Badge variant="outline">prices</Badge>}
                    </p>
                    <p className="text-muted-foreground">
                      Created {fmt(l.createdAt)} · {!l.active ? "revoked or expired" : l.expiresAt ? `expires ${fmt(l.expiresAt)}` : "no expiry"} · {l.viewCount} view{l.viewCount === 1 ? "" : "s"}
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
