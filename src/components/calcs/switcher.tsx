"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, List, Loader2, Plus, Search } from "lucide-react";
import { createBlankCalc, listCalcsForSwitcher } from "@/app/actions/calcs";
import { cn } from "@/lib/utils";

// Switching worksheets without going back to the list: the open worksheet's name, which opens
// the worksheets opened lately and a search of them all (Ctrl+O). What's open is saved first.

type Item = { id: string; name: string; project: string | null; updated: string };

const RECENT = "calcs.recent";
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? "[]") as string[];
  } catch {
    return [];
  }
};

export function CalcSwitcher({ calc, projectId, system, beforeLeave, onGo }: { calc: { id: string; name: string }; projectId: string | null; system: string; beforeLeave: () => Promise<void>; onGo: (href: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // This worksheet goes to the top of the ones opened lately.
  useEffect(() => {
    try {
      localStorage.setItem(RECENT, JSON.stringify([calc.id, ...readRecent().filter((id) => id !== calc.id)].slice(0, 8)));
    } catch {
      // Just not remembered.
    }
  }, [calc.id]);

  const show = () => {
    setOpen(true);
    setQuery("");
    void listCalcsForSwitcher()
      .then(setItems)
      .catch(() => setItems([]));
  };

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        show();
      } else if (e.key === "Escape") setOpen(false);
    };
    const away = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("pointerdown", away);
    };
  });
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const { recent, all } = useMemo(() => {
    const others = (items ?? []).filter((c) => c.id !== calc.id);
    const q = query.trim().toLowerCase();
    if (q) return { recent: [], all: others.filter((c) => c.name.toLowerCase().includes(q) || c.project?.toLowerCase().includes(q)) };
    const ids = open ? readRecent() : [];
    const byId = new Map(others.map((c) => [c.id, c]));
    const recent = ids.map((id) => byId.get(id)).filter((c): c is Item => !!c).slice(0, 5);
    return { recent, all: others.filter((c) => !recent.includes(c)) };
  }, [items, query, calc.id, open]);

  const go = async (id: string, href: string) => {
    setBusy(id);
    try {
      await beforeLeave(); // saved first
      onGo(href);
    } catch {
      setBusy(null);
    }
  };
  const fresh = async () => {
    setBusy("new");
    try {
      await beforeLeave();
      const { id } = await createBlankCalc(projectId);
      onGo(`/calcs/${id}?system=${system}`);
    } catch {
      setBusy(null);
    }
  };

  const row = (c: Item) => (
    <button key={c.id} type="button" onClick={() => void go(c.id, `/calcs/${c.id}`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent">
      {busy === c.id ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{c.name}</span>
      {c.project && <span className="max-w-28 shrink-0 truncate text-[11px] text-muted-foreground">{c.project}</span>}
    </button>
  );

  return (
    <div ref={panel} className="relative">
      <button type="button" onClick={() => (open ? setOpen(false) : show())} title="Switch worksheets (Ctrl+O)" className={cn("flex max-w-52 items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent", open && "bg-accent")}>
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{calc.name}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 flex w-80 flex-col rounded-lg border bg-popover text-xs text-popover-foreground shadow-lg">
          <div className="flex items-center gap-2 border-b px-2.5 py-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = [...recent, ...all][0];
                if (e.key === "Enter" && first) void go(first.id, `/calcs/${first.id}`);
              }}
              placeholder="Search worksheets"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {!items && (
              <div className="flex items-center gap-2 px-2 py-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            )}
            {recent.length > 0 && <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Recent</div>}
            {recent.map(row)}
            {all.length > 0 && <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{query ? "Found" : "All worksheets"}</div>}
            {all.map(row)}
            {items && !recent.length && !all.length && <div className="px-2 py-2 text-muted-foreground">{query ? "No worksheets match" : "No other worksheets yet"}</div>}
          </div>
          <div className="flex border-t p-1">
            <button type="button" onClick={() => void fresh()} className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
              {busy === "new" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} New worksheet
            </button>
            <button type="button" onClick={() => void go("list", "/calcs")} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
              <List className="size-3.5" /> All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
