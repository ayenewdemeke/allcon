"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ExternalLink, Loader2, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { deleteReview, setIssueStatus } from "@/app/actions/reviews";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { captureSheet } from "@/lib/pdf/review-client";
import type { ReviewIssueView, ReviewSheetView } from "@/lib/review/types";
import { cn } from "@/lib/utils";

const EST_COST_PER_SHEET = 0.02; // USD with Haiku, shown before a run; actual cost is recorded per sheet
type Filter = "suggested" | "kept" | "dismissed" | "all";
const FILTERS: [Filter, string][] = [
  ["suggested", "To review"],
  ["kept", "Kept"],
  ["dismissed", "Dismissed"],
  ["all", "All"],
];
const usd = (n: number) => `$${n.toFixed(2)}`;

export function ReviewWorkspace({
  projectId,
  review,
  references,
  enabled,
  sheets: initialSheets,
  initialIssues,
}: {
  projectId: string;
  review: { id: string; name: string; drawingSetId: string; setName: string };
  references: { id: string; title: string }[];
  enabled: boolean;
  sheets: ReviewSheetView[];
  initialIssues: ReviewIssueView[];
}) {
  const router = useRouter();
  const [sheets, setSheets] = useState(initialSheets);
  const [issues, setIssues] = useState(initialIssues);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [filter, setFilter] = useState<Filter>("suggested");
  const [focusSheet, setFocusSheet] = useState<string | null>(null);
  const stop = useRef(false);

  const names = useMemo(() => new Map(sheets.map((s) => [s.id, s.name])), [sheets]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) if (i.status !== "dismissed") m.set(i.sheetId, (m.get(i.sheetId) ?? 0) + 1);
    return m;
  }, [issues]);
  const totalCost = sheets.reduce((n, s) => n + s.costUsd, 0);

  const patchSheet = (id: string, patch: Partial<ReviewSheetView>) =>
    setSheets((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function run() {
    const queue = sheets.filter((s) => selected.has(s.id));
    if (!queue.length) return;
    setRunning(true);
    stop.current = false;
    let failed = 0;
    let lastError = "";
    for (const sheet of queue) {
      if (stop.current) break;
      patchSheet(sheet.id, { status: "running", error: null });
      try {
        const { lines, image } = await captureSheet(review.drawingSetId, sheet.pageIndex);
        const res = await fetch(`/api/reviews/${review.id}/sheets/${sheet.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines, image }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Review failed (${res.status})`);
        setIssues((list) => [...list.filter((i) => i.sheetId !== sheet.id), ...(data.issues as ReviewIssueView[])]);
        patchSheet(sheet.id, { status: "done", costUsd: data.costUsd });
        setSelected((s) => {
          const next = new Set(s);
          next.delete(sheet.id);
          return next;
        });
      } catch (err) {
        failed++;
        lastError = err instanceof Error ? err.message : "Review failed";
        patchSheet(sheet.id, { status: "failed", error: lastError });
      }
    }
    setRunning(false);
    if (failed) toast.error(`${failed} sheet${failed === 1 ? "" : "s"} could not be reviewed`, { description: lastError });
    router.refresh();
  }

  async function act(issue: ReviewIssueView, status: ReviewIssueView["status"]) {
    try {
      const updated = await setIssueStatus(issue.id, status);
      setIssues((list) => list.map((i) => (i.id === issue.id ? updated : i)));
      if (status === "kept") toast.success("Drawn on the sheet as a cloud and note");
    } catch {
      toast.error("Could not update that finding");
    }
  }

  const shown = issues.filter((i) => (filter === "all" || i.status === filter) && (!focusSheet || i.sheetId === focusSheet));
  const bySheet = sheets
    .map((s) => ({ sheet: s, items: shown.filter((i) => i.sheetId === s.id) }))
    .filter((g) => g.items.length);
  const refTitle = new Map(references.map((r) => [r.id, r.title]));

  return (
    <div className="space-y-5">
      <PageHeader
        title={review.name}
        description={`${review.setName} · against ${references.map((r) => r.title).join(", ") || "no manuals"}${totalCost ? ` · AI cost so far ${usd(totalCost)}` : ""}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!window.confirm("Delete this review? Findings you kept stay on the sheets as markups.")) return;
              await deleteReview(review.id);
              router.push(`/projects/${projectId}/reviews`);
            }}
          >
            <Trash2 /> Delete
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* Sheets */}
        <section className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sheets</h2>
            <div className="flex gap-1 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setSelected(new Set(sheets.filter((s) => s.status !== "done").map((s) => s.id)))}>
                Not reviewed
              </button>
              <span className="text-muted-foreground">·</span>
              <button type="button" className="text-primary hover:underline" onClick={() => setSelected(new Set())}>
                None
              </button>
            </div>
          </div>
          <ul className="max-h-[60svh] divide-y overflow-y-auto rounded-lg border bg-card">
            {sheets.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-2 px-3 py-2 text-sm", focusSheet === s.id && "bg-muted")}>
                <input
                  type="checkbox"
                  aria-label={`Review ${s.name}`}
                  checked={selected.has(s.id)}
                  disabled={running}
                  onChange={(e) =>
                    setSelected((sel) => {
                      const next = new Set(sel);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-primary" onClick={() => setFocusSheet(focusSheet === s.id ? null : s.id)}>
                  {s.name}
                </button>
                {s.status === "running" ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : s.status === "failed" ? (
                  <span title={s.error ?? undefined}>
                    <AlertTriangle className="size-3.5 text-destructive" />
                  </span>
                ) : s.status === "done" ? (
                  <Badge variant={counts.get(s.id) ? "warning" : "success"}>{counts.get(s.id) ? `${counts.get(s.id)}` : "OK"}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
          {running ? (
            <Button variant="outline" className="w-full" onClick={() => (stop.current = true)}>
              <Square /> Stop after this sheet
            </Button>
          ) : (
            <Button className="w-full" disabled={!enabled || !selected.size} onClick={run}>
              <Play /> Review {selected.size || ""} sheet{selected.size === 1 ? "" : "s"}
              {selected.size > 0 && <span className="opacity-75">(about {usd(selected.size * EST_COST_PER_SHEET)})</span>}
            </Button>
          )}
          {!enabled && <p className="text-xs text-muted-foreground">Add ANTHROPIC_API_KEY to run reviews.</p>}
          <p className="text-xs text-muted-foreground">
            Each sheet is read from its text and an image, and checked against the manual sections that match it.
            Findings are suggestions to confirm, not approvals.
          </p>
        </section>

        {/* Findings */}
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-muted p-[3px]">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={cn("rounded-md px-2.5 py-1 text-sm text-muted-foreground", filter === value && "bg-card font-medium text-foreground shadow-sm")}
                >
                  {label} ({issues.filter((i) => value === "all" || i.status === value).length})
                </button>
              ))}
            </div>
            {focusSheet && (
              <Button variant="ghost" size="sm" onClick={() => setFocusSheet(null)}>
                <X /> {names.get(focusSheet)}
              </Button>
            )}
          </div>

          {!bySheet.length && (
            <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              {issues.length ? "Nothing here." : "Choose sheets on the left and run the review. Findings show up here."}
            </p>
          )}
          {bySheet.map(({ sheet, items }) => (
            <div key={sheet.id} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{sheet.name}</h3>
                <LinkButton variant="ghost" size="sm" href={`/projects/${projectId}/sheets/${sheet.id}`}>
                  Open sheet <ExternalLink />
                </LinkButton>
              </div>
              {items.map((i) => (
                <article key={i.id} className={cn("space-y-2 rounded-lg border bg-card p-3", i.status === "dismissed" && "opacity-60")}>
                  <div className="flex items-start gap-2">
                    <Badge variant={i.severity === "major" ? "destructive" : "warning"}>{i.severity}</Badge>
                    <p className="min-w-0 flex-1 font-medium">{i.title}</p>
                    {i.status === "kept" && <Badge variant="success">Kept</Badge>}
                  </div>
                  <p className="text-sm">{i.detail}</p>
                  {i.quote && <p className="border-l-2 pl-2 text-xs text-muted-foreground italic">&ldquo;{i.quote}&rdquo;</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {i.citation &&
                      (i.referenceId && refTitle.has(i.referenceId) ? (
                        <a
                          href={`/api/references/${i.referenceId}/pdf${i.page ? `#page=${i.page}` : ""}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {i.citation} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{i.citation}</span>
                      ))}
                    <div className="ml-auto flex gap-1">
                      {i.status === "suggested" ? (
                        <>
                          <Button size="sm" onClick={() => act(i, "kept")} title={i.located ? "Cloud it on the sheet with a note" : "Add a note on the sheet"}>
                            <Check /> Keep
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => act(i, "dismissed")}>
                            <X /> Dismiss
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => act(i, "suggested")}>
                          <RotateCcw /> {i.status === "kept" ? "Remove from sheet" : "Undo"}
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
