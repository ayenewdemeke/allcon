"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DesignRowActions } from "./design-list-actions";

// The designs made, newest first, narrowed by category, project or name.

export type DesignRow = { id: string; name: string; kindName: string; category: string; project: { id: string; name: string } | null; updatedAt: string };

export function DesignList({ designs, categories }: { designs: DesignRow[]; categories: { id: string; name: string }[] }) {
  const [category, setCategory] = useState("all");
  const [project, setProject] = useState("all");
  const [query, setQuery] = useState("");
  const present = categories.filter((c) => designs.some((d) => d.category === c.id));
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of designs) if (d.project) seen.set(d.project.id, d.project.name);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [designs]);
  const q = query.trim().toLowerCase();
  const shown = designs.filter(
    (d) =>
      (category === "all" || d.category === category) &&
      (project === "all" || (project === "none" ? !d.project : d.project?.id === project)) &&
      (!q || d.name.toLowerCase().includes(q) || d.kindName.toLowerCase().includes(q)),
  );
  const chip = (id: string, label: string, count: number) => (
    <button key={id} type="button" onClick={() => setCategory(id)} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", category === id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
      {label} <span className="opacity-70">{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {present.length > 1 && [chip("all", "All", designs.length), ...present.map((c) => chip(c.id, c.name, designs.filter((d) => d.category === c.id).length))]}
        <div className="ml-auto flex items-center gap-2">
          {projects.length > 0 && (
            <select value={project} onChange={(e) => setProject(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs" aria-label="Project">
              <option value="all">All projects</option>
              <option value="none">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <label className="flex h-8 items-center gap-1.5 rounded-lg border border-input px-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a design" className="w-36 bg-transparent text-xs outline-none" />
          </label>
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Design</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Link href={`/design/${d.id}`} className="font-medium hover:text-primary hover:underline">
                    {d.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{d.kindName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {d.project ? (
                    <Link href={`/projects/${d.project.id}`} className="hover:text-primary hover:underline">
                      {d.project.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <LocalTime date={d.updatedAt} />
                </TableCell>
                <TableCell>
                  <DesignRowActions id={d.id} name={d.name} />
                </TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  No designs match.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
