"use client";

import { useMemo, useState, useTransition } from "react";
import { Box, Check, Loader2, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { mapGroups, removeRule } from "@/app/actions/mapping";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import { Progress } from "@/components/ui/progress";
import { unitDimension } from "@/lib/line-items/units";
import type { ElementGroup } from "@/lib/mapping/server";
import { HIGH_CONFIDENCE, quantityKeyFor, type QuantityKey, type Suggestion } from "@/lib/mapping/suggest";
import { formatMeasure, type UnitSystem } from "@/lib/takeoff";
import { cn } from "@/lib/utils";
import { BOQ } from "@/lib/line-items/terms";

export type GroupRow = ElementGroup & {
  key: string;
  /** Where to see the group's elements: the uploaded model (with them highlighted) or the AI-built model. */
  viewHref: string | null;
  /** The models it comes from, by name. */
  modelLabel: string;
  rules: { id: string; lineItemId: string; quantityKey: string; isAuto: boolean }[];
  suggestion: Suggestion | null;
};
export type LineItemOption = { id: string; code: string | null; description: string; unit: string | null; section: string };

type Filter = "all" | "unmapped" | "suggested" | "mapped";

const KEY_LABELS: Record<string, string> = { volume: "volume", area: "area", length: "length", perimeter: "perimeter", count: "count" };
const selectClass = "h-8 w-full rounded-lg border border-input bg-card px-2 text-sm";

function groupName(g: Pick<GroupRow, "category" | "typeName">) {
  return { title: g.typeName ?? "(no type)", category: g.category ?? "Uncategorised" };
}

export function MappingWorkspace({
  projectId,
  unitSystem,
  groups,
  lineItems,
}: {
  projectId: string;
  unitSystem: UnitSystem;
  groups: GroupRow[];
  lineItems: LineItemOption[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(groups.find((g) => !g.rules.length)?.key ?? groups[0]?.key ?? null);
  const [pending, startTransition] = useTransition();
  const itemById = useMemo(() => new Map(lineItems.map((i) => [i.id, i])), [lineItems]);

  const totalElements = groups.reduce((s, g) => s + g.count, 0);
  const mappedElements = groups.reduce((s, g) => s + g.mappedElements, 0);
  const mappedGroups = groups.filter((g) => g.rules.length).length;
  const confident = groups.filter((g) => !g.rules.length && g.suggestion && g.suggestion.score >= HIGH_CONFIDENCE);

  const visible = groups.filter((g) => {
    if (filter === "unmapped" && g.rules.length) return false;
    if (filter === "mapped" && !g.rules.length) return false;
    if (filter === "suggested" && (g.rules.length || !g.suggestion)) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [g.category, g.typeName, g.assemblyDescription, g.assemblyCode].some((t) => t?.toLowerCase().includes(q));
  });
  const selected = groups.find((g) => g.key === selectedKey) ?? null;

  const run = (fn: () => Promise<void>, success: string) =>
    startTransition(async () => {
      try {
        await fn();
        toast.success(success);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });

  const mapOne = (g: GroupRow, lineItemId: string, quantityKey: QuantityKey, fromSuggestion = false) =>
    run(
      () => mapGroups(projectId, { mappings: [{ category: g.category, typeName: g.typeName, lineItemId, quantityKey }], fromSuggestions: fromSuggestion }),
      `Mapped ${g.count} element${g.count === 1 ? "" : "s"}`,
    );

  const acceptConfident = () =>
    run(
      () =>
        mapGroups(projectId, {
          fromSuggestions: true,
          mappings: confident.map((g) => ({ category: g.category, typeName: g.typeName, lineItemId: g.suggestion!.lineItemId, quantityKey: g.suggestion!.quantityKey })),
        }),
      `Accepted ${confident.length} suggestions`,
    );

  const quantitiesText = (g: GroupRow) =>
    (["volume", "area", "length"] as const)
      .filter((k) => g.quantities[k])
      .map((k) => formatMeasure(g.quantities[k]!, k, unitSystem))
      .join(" · ");

  const itemLabel = (id: string) => {
    const i = itemById.get(id);
    return i ? `${i.code ? `${i.code} · ` : ""}${i.description}` : `Deleted ${BOQ.item}`;
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Elements mapped</span>
              <span className="font-medium tabular-nums">
                {mappedElements.toLocaleString()} of {totalElements.toLocaleString()} ({totalElements ? Math.round((mappedElements / totalElements) * 100) : 0}%)
              </span>
            </div>
            <Progress value={totalElements ? (mappedElements / totalElements) * 100 : 0} />
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Groups mapped</p>
            <p className="font-medium tabular-nums">
              {mappedGroups} of {groups.length}
            </p>
          </div>
          <Button onClick={acceptConfident} disabled={pending || !confident.length}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Accept {confident.length} confident suggestion{confident.length === 1 ? "" : "s"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        {/* Group list */}
        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <div className="flex rounded-md border p-0.5 text-xs">
              {(["all", "unmapped", "suggested", "mapped"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn("rounded px-2.5 py-1 capitalize", f === filter ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search groups" className="pl-8" />
            </div>
          </div>
          <ul className="max-h-[calc(100vh-18rem)] divide-y overflow-y-auto">
            {visible.map((g) => {
              const { title, category } = groupName(g);
              return (
                <li
                  key={g.key}
                  onClick={() => setSelectedKey(g.key)}
                  className={cn("cursor-pointer px-4 py-3 hover:bg-muted/50", g.key === selectedKey && "bg-accent/60 hover:bg-accent/60")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {category} · {g.count.toLocaleString()} element{g.count === 1 ? "" : "s"}
                        {quantitiesText(g) && ` · ${quantitiesText(g)}`}
                        {g.modelLabel && ` · ${g.modelLabel}`}
                      </p>
                    </div>
                    {g.rules.length > 0 ? (
                      <Badge variant="success" className="shrink-0">
                        <Check /> Mapped
                      </Badge>
                    ) : g.suggestion ? (
                      <Badge variant={g.suggestion.score >= HIGH_CONFIDENCE ? "info" : "secondary"} className="shrink-0">
                        <Sparkles /> Suggested {Math.round(g.suggestion.score * 100)}%
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-muted-foreground">
                        Unmapped
                      </Badge>
                    )}
                  </div>
                  {g.rules.map((r) => (
                    <p key={r.id} className="mt-1 truncate text-xs text-[hsl(142_70%_28%)]">
                      → {itemLabel(r.lineItemId)} <span className="text-muted-foreground">by {KEY_LABELS[r.quantityKey] ?? r.quantityKey}</span>
                    </p>
                  ))}
                  {!g.rules.length && g.suggestion && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">→ {itemLabel(g.suggestion.lineItemId)}</p>
                  )}
                </li>
              );
            })}
            {!visible.length && <li className="p-8 text-center text-sm text-muted-foreground">No groups match.</li>}
          </ul>
        </Card>

        {/* Selected group */}
        {selected ? (
          <GroupPanel
            key={selected.key}
            group={selected}
            unitSystem={unitSystem}
            lineItems={lineItems}
            itemLabel={itemLabel}
            pending={pending}
            onMap={(lineItemId, key, fromSuggestion) => mapOne(selected, lineItemId, key, fromSuggestion)}
            onRemove={(ruleId) => run(() => removeRule(ruleId), "Mapping removed")}
          />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">Select a group to map it.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function GroupPanel({
  group,
  unitSystem,
  lineItems,
  itemLabel,
  pending,
  onMap,
  onRemove,
}: {
  group: GroupRow;
  unitSystem: UnitSystem;
  lineItems: LineItemOption[];
  itemLabel: (id: string) => string;
  pending: boolean;
  onMap: (lineItemId: string, key: QuantityKey, fromSuggestion?: boolean) => void;
  onRemove: (ruleId: string) => void;
}) {
  const [lineItemId, setLineItemId] = useState(group.suggestion?.lineItemId ?? "");
  const item = lineItems.find((i) => i.id === lineItemId);
  const defaultKey = item ? quantityKeyFor(item.unit, group.quantities) : null;
  const [keyOverride, setKeyOverride] = useState<QuantityKey | null>(null);
  const quantityKey = keyOverride ?? defaultKey;

  // Quantities this group can offer for the chosen line item's unit
  const dim = item ? unitDimension(item.unit) : null;
  const keyOptions: QuantityKey[] =
    dim === "count" || dim === "lump"
      ? ["count"]
      : dim === "volume" || dim === "area"
        ? group.quantities[dim]
          ? [dim]
          : []
        : dim === "length"
          ? (["length", "perimeter"] as const).filter((k) => group.quantities[k])
          : [];

  const sections = [...new Set(lineItems.map((i) => i.section))];
  const { title, category } = groupName(group);
  const focus = encodeURIComponent(JSON.stringify({ category: group.category, typeName: group.typeName }));

  return (
    <Card className="h-fit lg:sticky lg:top-18">
      <CardHeader>
        <CardTitle className="leading-snug">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {category} · {group.count.toLocaleString()} elements
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {(["volume", "area", "length"] as const)
            .filter((k) => group.quantities[k])
            .map((k) => (
              <div key={k} className="rounded-md bg-muted/60 px-3 py-2">
                <dt className="text-xs text-muted-foreground capitalize">{k}</dt>
                <dd className="font-medium tabular-nums">{formatMeasure(group.quantities[k]!, k, unitSystem)}</dd>
              </div>
            ))}
          {group.assemblyCode && (
            <div className="col-span-2 rounded-md bg-muted/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Assembly code (UNIFORMAT)</dt>
              <dd className="font-medium">
                {group.assemblyCode} {group.assemblyDescription && <span className="font-normal">· {group.assemblyDescription}</span>}
              </dd>
            </div>
          )}
          {group.missing > 0 && (
            <p className="col-span-2 text-xs text-[hsl(32_95%_35%)]">{group.missing} element(s) have no usable quantity in the model.</p>
          )}
        </dl>

        {group.rules.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Mapped to</Label>
            {group.rules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{itemLabel(r.lineItemId)}</span>
                <span className="text-xs text-muted-foreground">by {r.quantityKey}</span>
                <Button variant="ghost" size="icon-xs" disabled={pending} onClick={() => onRemove(r.id)} aria-label="Remove mapping">
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}

        {group.suggestion && !group.rules.length && (
          <div className="space-y-2 rounded-md border border-info/40 bg-info/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[hsl(199_89%_32%)]">
              <Sparkles className="size-3.5" /> Suggested ({Math.round(group.suggestion.score * 100)}% match)
            </p>
            <p className="text-sm">{itemLabel(group.suggestion.lineItemId)}</p>
            <Button size="sm" disabled={pending} onClick={() => onMap(group.suggestion!.lineItemId, group.suggestion!.quantityKey, true)}>
              <Check /> Accept, by {group.suggestion.quantityKey}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="map-item" className="text-xs">
            {group.rules.length ? "Also map to" : `Map to ${BOQ.anItem}`}
          </Label>
          <select
            id="map-item"
            className={selectClass}
            value={lineItemId}
            onChange={(e) => {
              setLineItemId(e.target.value);
              setKeyOverride(null);
            }}
          >
            <option value="">{`Choose ${BOQ.anItem}…`}</option>
            {sections.map((s) => (
              <optgroup key={s} label={s}>
                {lineItems
                  .filter((i) => i.section === s)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code ? `${i.code} · ` : ""}
                      {i.description} ({i.unit ?? "no unit"})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {item && (
            keyOptions.length ? (
              <select
                aria-label="Quantity to use"
                className={selectClass}
                value={quantityKey ?? ""}
                onChange={(e) => setKeyOverride(e.target.value as QuantityKey)}
              >
                {keyOptions.map((k) => (
                  <option key={k} value={k}>
                    Use each element&apos;s {k}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-destructive">
                These elements have no quantity in {item.unit ?? "this unit"}, so they can&apos;t price this line.
              </p>
            )
          )}
          <Button
            className="w-full"
            disabled={pending || !item || !quantityKey || !keyOptions.includes(quantityKey)}
            onClick={() => item && quantityKey && onMap(item.id, quantityKey)}
          >
            Map {group.count.toLocaleString()} element{group.count === 1 ? "" : "s"}
          </Button>
        </div>

        {group.viewHref && (
          <LinkButton variant="outline" size="sm" className="w-full" href={group.viewHref.includes("?") ? `${group.viewHref}${focus}` : group.viewHref}>
            <Box /> Show in model
          </LinkButton>
        )}
      </CardContent>
    </Card>
  );
}
