"use client";

import { useMemo, useState } from "react";
import {
  AirVent,
  AppWindow,
  Armchair,
  Box,
  BrickWall,
  Building2,
  ChevronDown,
  ChevronRight,
  Columns3,
  Cylinder,
  DoorOpen,
  Droplet,
  Eye,
  EyeOff,
  Fan,
  Fence,
  FolderOpen,
  Footprints,
  Layers,
  Lightbulb,
  MapPin,
  PanelTop,
  Plug,
  RectangleHorizontal,
  Rows3,
  Search,
  Shapes,
  Signpost,
  Slash,
  Square,
  SquareDashed,
  Toilet,
  Wrench,
  X,
} from "lucide-react";
import type { TreeNode } from "@/components/models/model-canvas";
import { Input } from "@/components/ui/input";
import { SPATIAL_CATEGORIES, type ElementDetails, type Row } from "@/lib/ifc/element-properties";
import { cn } from "@/lib/utils";

// The 3D viewer's floating panels: the model browser (structure, show/hide), the selected
// element's properties, and the model's details. Styled after Live Jobsite's viewer.

export function FloatingPanel({ title, onClose, className, children }: { title: React.ReactNode; onClose: () => void; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("absolute z-10 flex max-h-[calc(100%-24px)] flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur-sm", className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/** A collapsible group with a count, for property sets and model details. */
export function Section({ name, count, defaultOpen = false, children }: { name: string; count?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-1">
      <button type="button" className="flex w-full items-center gap-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
        <span className="text-xs font-semibold text-muted-foreground">{name}</span>
        {count !== undefined && <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{count}</span>}
      </button>
      {open && <div className="ml-1.5 border-l pl-2">{children}</div>}
    </div>
  );
}

export function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="space-y-0.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 py-0.5 text-xs">
          <dt className="break-words text-muted-foreground">{r.label}</dt>
          <dd className={cn("text-right break-words whitespace-pre-line tabular-nums", r.mono && "font-mono text-[11px]")} title={r.value}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The selected element: what it is, where, what it's made of and how big, then its property sets and identifiers. */
export function PropertiesPanel({ element, pricedIn, onClose }: { element: ElementDetails | null; pricedIn?: Row[]; onClose: () => void }) {
  return (
    <FloatingPanel title="Properties" onClose={onClose} className="top-3 right-24 w-80 max-sm:right-3 max-sm:left-3 max-sm:w-auto">
      <div className="p-3">
        {!element ? (
          <div className="py-8 text-center text-muted-foreground">
            <Box className="mx-auto mb-2 size-8 opacity-50" />
            <p className="text-xs">Click an element to see its properties</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="border-b pb-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{element.category}</p>
              <p className="text-sm leading-snug font-semibold break-words">{element.title}</p>
            </div>
            {element.summary.length > 0 && <Rows rows={element.summary} />}
            {pricedIn && pricedIn.length > 0 && (
              <Section name="SOV / BoQ" count={pricedIn.length} defaultOpen>
                <Rows rows={pricedIn} />
              </Section>
            )}
            {element.quantities.length > 0 && (
              <Section name="Quantities" count={element.quantities.length} defaultOpen>
                <Rows rows={element.quantities} />
              </Section>
            )}
            {element.groups.map((g) => (
              <Section key={g.name} name={g.name} count={g.rows.length} defaultOpen={g.open}>
                <Rows rows={g.rows} />
              </Section>
            ))}
            <Section name="Identity" count={element.identity.length}>
              <Rows rows={element.identity} />
            </Section>
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  IFCPROJECT: FolderOpen,
  IFCSITE: MapPin,
  IFCBUILDING: Building2,
  IFCBRIDGE: Building2,
  IFCBUILDINGSTOREY: Layers,
  IFCBRIDGEPART: Layers,
  IFCSPACE: SquareDashed,
  IFCWALL: BrickWall,
  IFCWALLSTANDARDCASE: BrickWall,
  IFCSLAB: RectangleHorizontal,
  IFCROOF: PanelTop,
  IFCCOVERING: Rows3,
  IFCBEAM: Slash,
  IFCMEMBER: Slash,
  IFCCOLUMN: Cylinder,
  IFCPILE: Cylinder,
  IFCPLATE: Square,
  IFCCURTAINWALL: Columns3,
  IFCDOOR: DoorOpen,
  IFCWINDOW: AppWindow,
  IFCSTAIR: Footprints,
  IFCSTAIRFLIGHT: Footprints,
  IFCRAILING: Fence,
  IFCFURNITURE: Armchair,
  IFCFURNISHINGELEMENT: Armchair,
  IFCLIGHTFIXTURE: Lightbulb,
  IFCAIRTERMINAL: AirVent,
  IFCUNITARYEQUIPMENT: Fan,
  IFCSANITARYTERMINAL: Toilet,
  IFCWASTETERMINAL: Droplet,
  IFCOUTLET: Plug,
  IFCVALVE: Wrench,
  IFCSIGN: Signpost,
  IFCBUILDINGELEMENTPROXY: Shapes,
};

/** Element ids at and under a node. */
export function idsUnder(node: TreeNode, out: number[] = []): number[] {
  if (node.localId !== null) out.push(node.localId);
  for (const child of node.children) idsUnder(child, out);
  return out;
}

/** The model's structure: levels, then elements by kind. Click to select, eye to show or hide. */
export function ModelBrowser({
  tree,
  hidden,
  selected,
  onSelect,
  onToggle,
  onShowAll,
  onClose,
}: {
  tree: TreeNode[];
  hidden: Set<number>;
  selected: number | null;
  onSelect: (localId: number) => void;
  onToggle: (ids: number[], show: boolean) => void;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tree;
    // A match keeps everything under it (searching "room" shows the rooms in each Room group);
    // otherwise a node stays only as the way to matches below it.
    const filter = (nodes: TreeNode[]): TreeNode[] =>
      nodes.flatMap((n) => {
        if (n.name.toLowerCase().includes(term) || n.category.toLowerCase().includes(term)) return [n];
        const children = filter(n.children);
        return children.length ? [{ ...n, children }] : [];
      });
    return filter(tree);
  }, [tree, search]);

  return (
    <FloatingPanel
      title={
        <span className="flex items-center gap-2">
          Model browser
          {hidden.size > 0 && (
            <button type="button" onClick={onShowAll} className="text-xs font-normal text-primary hover:underline">
              Show all
            </button>
          )}
        </span>
      }
      onClose={onClose}
      className="top-3 left-3 w-80 max-sm:right-3 max-sm:w-auto"
    >
      <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search elements…" className="h-8 pl-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="p-2">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{tree.length === 0 ? "Model structure will appear here" : "No matching elements"}</p>
        ) : (
          filtered.map((node) => (
            // Keyed by the search too, so each search starts with its results opened
            <TreeItem key={`${node.key}|${search.trim()}`} node={node} depth={0} hidden={hidden} selected={selected} onSelect={onSelect} onToggle={onToggle} forceOpen={!!search.trim()} />
          ))
        )}
      </div>
    </FloatingPanel>
  );
}

function TreeItem({
  node,
  depth,
  hidden,
  selected,
  onSelect,
  onToggle,
  forceOpen,
}: {
  node: TreeNode;
  depth: number;
  hidden: Set<number>;
  selected: number | null;
  onSelect: (localId: number) => void;
  onToggle: (ids: number[], show: boolean) => void;
  forceOpen: boolean;
}) {
  // Open down to the levels; kinds of element start closed so a big model stays readable.
  const spatial = SPATIAL_CATEGORIES.has(node.category);
  // A search opens its results to begin with; they can still be collapsed.
  const [expanded, setExpanded] = useState(spatial || forceOpen);
  const open = expanded;
  const ids = useMemo(() => idsUnder(node), [node]);
  const isHidden = ids.length > 0 && ids.every((id) => hidden.has(id));
  const Icon = TYPE_ICONS[node.category] ?? Box;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "group flex cursor-pointer items-center rounded px-1 py-0.5 text-xs hover:bg-muted/60",
          isHidden && "opacity-40",
          selected !== null && selected === node.localId && "bg-primary/10 text-primary",
        )}
        style={{ paddingLeft: Math.min(depth * 14, 140) + 4 }}
        onClick={() => (node.localId !== null && !spatial ? onSelect(node.localId) : setExpanded(!expanded))}
      >
        {hasChildren ? (
          <button
            type="button"
            className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Icon className="ml-0.5 size-3 shrink-0 text-muted-foreground" />
        <span className="ml-1 min-w-0 flex-1 truncate" title={node.name}>
          {node.name}
        </span>
        <button
          type="button"
          className={cn("ml-1 shrink-0 text-muted-foreground transition-opacity hover:text-foreground", isHidden ? "opacity-100" : "opacity-0 group-hover:opacity-70")}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(ids, isHidden);
          }}
          title={isHidden ? "Show" : "Hide"}
        >
          {isHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
      </div>
      {open &&
        node.children.map((child) => (
          <TreeItem key={child.key} node={child} depth={depth + 1} hidden={hidden} selected={selected} onSelect={onSelect} onToggle={onToggle} forceOpen={forceOpen} />
        ))}
    </div>
  );
}
