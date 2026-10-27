"use client";

import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

// Who else is in the drawing: people with it open, and AI apps editing it through the
// connector, as small avatars by the save status. Their cursors show on the drawing.

export type Person = { id: string; name: string; app: boolean; space: string | null; cursor: [number, number] | null; activity: string | null };

const COLORS = ["#e11d48", "#7c3aed", "#0891b2", "#16a34a", "#ea580c", "#db2777", "#2563eb", "#ca8a04"];

/** A steady colour per person. */
export function personColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function People({ people }: { people: Person[] }) {
  if (!people.length) return null;
  return (
    <span className="flex items-center -space-x-1">
      {people.slice(0, 6).map((p) => (
        <span
          key={p.id}
          title={p.app ? `${p.name} is editing through the connector${p.activity ? `: ${p.activity}` : ""}` : `${p.name} has this drawing open`}
          className={cn("flex size-5 items-center justify-center rounded-full border-2 border-background text-[9px] font-semibold text-white", p.app && "animate-pulse")}
          style={{ background: personColor(p.id) }}
        >
          {p.app ? <Bot className="size-3" /> : initials(p.name)}
        </span>
      ))}
      {people.length > 6 && <span className="pl-2 text-[10px] text-muted-foreground">+{people.length - 6}</span>}
    </span>
  );
}
