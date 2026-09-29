"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Section = { id: string; number: string | null; title: string; page: number; preview: string };

/** The manual's sections with a quick filter; each opens the PDF at its page. */
export function ReferenceSections({ referenceId, sections }: { referenceId: string; sections: Section[] }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => `${s.number ?? ""} ${s.title} ${s.preview}`.toLowerCase().includes(q));
  }, [query, sections]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter sections, e.g. clear cover" className="pl-8" />
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {shown.map((s) => (
          <li key={s.id}>
            <a
              href={`/api/references/${referenceId}/pdf#page=${s.page}`}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-muted/50"
            >
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{s.number ?? ""}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium group-hover:text-primary">{s.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.preview}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                p. {s.page} <ExternalLink className="size-3" />
              </span>
            </a>
          </li>
        ))}
        {!shown.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No sections match.</li>}
      </ul>
    </div>
  );
}
