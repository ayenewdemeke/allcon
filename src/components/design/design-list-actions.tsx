"use client";

import { useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createDesign, deleteDesign, renameDesign, setAgencyRules } from "@/app/actions/design";
import { AGENCY_RULES, type AgencyRules } from "@/lib/design/agency";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Kind = { id: string; name: string; short: string; available: boolean };
type Category = { id: string; name: string; kinds: Kind[] };

function useCreate() {
  const [pending, start] = useTransition();
  const create = (kind: string) =>
    start(async () => {
      try {
        await createDesign(kind, null); // opens it; filed under a project from the editor
      } catch (err) {
        unstable_rethrow(err); // the redirect to the new design isn't a failure
        toast.error(err instanceof Error ? err.message : "Could not start the design");
      }
    });
  return { pending, create };
}

/** Agency rules: AASHTO only, or an agency's criteria, standards, pay items and tools as well. */
export function AgencyRulesSelect({ value }: { value: AgencyRules }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="CDOT shows CDOT's criteria (Bridge Design Manual), standard rails, pay items and its own tools in the designs">
      Agency rules
      <select
        value={value}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            try {
              await setAgencyRules(e.target.value);
              router.refresh();
            } catch {
              toast.error("Could not save the agency rules");
            }
          })
        }
        className="h-8 rounded-md border border-input bg-transparent px-1.5 text-xs text-foreground"
      >
        {AGENCY_RULES.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "New design": the design types by category, in a menu. */
export function NewDesignMenu({ categories }: { categories: Category[] }) {
  const { pending, create } = useCreate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button disabled={pending} />}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        New design
        <ChevronDown className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {categories.map((c, k) => (
          <DropdownMenuGroup key={c.id}>
            {k > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{c.name}</DropdownMenuLabel>
            {c.kinds.map((kind) => (
              <DropdownMenuItem key={kind.id} disabled={!kind.available} onClick={() => create(kind.id)} className="flex-col items-start gap-0">
                <span className="font-medium">{kind.name}</span>
                <span className="text-xs text-muted-foreground">{kind.available ? kind.short : "Coming next"}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The design types as small tiles, by category: a click starts one. */
export function DesignCatalog({ categories }: { categories: Category[] }) {
  const { pending, create } = useCreate();
  return (
    <div className="space-y-3">
      {categories.map((c) => (
        <div key={c.id} className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-start">
          <p className="pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{c.name}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {c.kinds.map((k) => (
              <button
                key={k.id}
                type="button"
                disabled={!k.available || pending}
                onClick={() => create(k.id)}
                className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{k.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{k.available ? k.short : "Coming next"}</span>
                </span>
                <Plus className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DesignRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const rename = () => {
    const next = window.prompt("Rename design", name)?.trim();
    if (!next || next === name) return;
    start(async () => {
      try {
        await renameDesign(id, next);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not rename the design");
      }
    });
  };
  const remove = () => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    start(async () => {
      try {
        await deleteDesign(id);
        toast.success("Design deleted");
      } catch {
        toast.error("Could not delete the design");
      }
    });
  };
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon-sm" onClick={rename} disabled={pending} title="Rename" aria-label={`Rename ${name}`}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={remove} disabled={pending} title="Delete" aria-label={`Delete ${name}`}>
        {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>
    </div>
  );
}
