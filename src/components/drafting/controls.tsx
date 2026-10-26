"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { ACI, colorName, displayColor } from "@/lib/drafting/aci";
import { LINEWEIGHTS, LW_BYBLOCK, LW_BYLAYER, LW_DEFAULT, type ColorValue } from "@/lib/drafting/types";
import { cn } from "@/lib/utils";

// Small pieces the drafting editor is built from: ribbon buttons, pop-overs that stay inside the
// editor (so they follow its theme), colour and lineweight pickers, and CAD tool icons.

export function Popover({
  trigger,
  children,
  className,
  align = "left",
  side = "bottom",
}: {
  trigger: (open: boolean, toggle: (e: React.MouseEvent<HTMLElement>) => void) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  className?: string;
  align?: "left" | "right";
  side?: "bottom" | "top";
}) {
  // Rendered at the editor's root (so it isn't clipped by a scrolling palette, and keeps the
  // editor's theme), placed against its trigger.
  const [open, setOpen] = useState<{ rect: DOMRect; root: Element } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(null);
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    const host = e.currentTarget.closest("[data-popover-anchor]");
    if (open || !host) return setOpen(null);
    setOpen({ rect: host.getBoundingClientRect(), root: host.closest("[data-drafting-root]") ?? document.body });
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(null);
      }
    };
    const dismiss = () => setOpen(null);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismiss);
    // Keep the panel on screen.
    const el = panel.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.left < 8) el.style.transform = `translateX(${8 - r.left}px)`;
      else if (r.right > window.innerWidth - 8) el.style.transform = `translateX(${window.innerWidth - 8 - r.right}px)`;
    }
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  const style: React.CSSProperties | undefined = open
    ? {
        top: side === "bottom" ? open.rect.bottom + 4 : undefined,
        bottom: side === "top" ? window.innerHeight - open.rect.top + 4 : undefined,
        left: align === "left" ? open.rect.left : undefined,
        right: align === "right" ? window.innerWidth - open.rect.right : undefined,
      }
    : undefined;
  return (
    <div ref={anchor} data-popover-anchor>
      {trigger(!!open, toggle)}
      {open &&
        createPortal(
          <div ref={panel} style={style} className={cn("fixed z-50 max-h-[70vh] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg", className)}>
            {children(close)}
          </div>,
          open.root,
        )}
    </div>
  );
}

export function Swatch({ color, dark, className }: { color: number | string; dark: boolean; className?: string }) {
  return <span className={cn("inline-block size-3 shrink-0 rounded-[2px] border border-foreground/30", className)} style={{ background: displayColor(color, dark) }} />;
}

/** AutoCAD's Select Color: the index colours, the greys, and ByLayer. */
export function ColorPicker({ value, onChange, byLayer = true, dark }: { value: ColorValue; onChange: (c: ColorValue) => void; byLayer?: boolean; dark: boolean }) {
  const cell = (i: number) => (
    <button
      key={i}
      type="button"
      title={colorName(i)}
      onClick={() => onChange(i)}
      className={cn("size-3.5 border border-black/10 hover:z-10 hover:scale-150 hover:ring-1 hover:ring-foreground", value === i && "ring-2 ring-primary")}
      style={{ background: i === 7 ? displayColor(7, dark) : ACI[i] }}
    />
  );
  return (
    <div className="w-[22rem] space-y-2 p-1">
      {byLayer && (
        <button type="button" onClick={() => onChange(null)} className={cn("w-full rounded px-2 py-1 text-left text-xs hover:bg-muted", value === null && "bg-muted font-medium")}>
          ByLayer
        </button>
      )}
      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))]">{Array.from({ length: 240 }, (_, k) => cell(10 + (k % 24) * 10 + Math.floor(k / 24)))}</div>
      <div className="flex gap-1">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(cell)}</div>
      <div className="flex gap-1">{[250, 251, 252, 253, 254, 255].map(cell)}</div>
    </div>
  );
}

export function lineweightName(lw: number) {
  if (lw === LW_BYLAYER) return "ByLayer";
  if (lw === LW_BYBLOCK) return "ByBlock";
  if (lw === LW_DEFAULT) return "Default";
  return `${(lw / 100).toFixed(2)} mm`;
}

export function LineweightPicker({ value, onChange, byLayer = true }: { value: number; onChange: (lw: number) => void; byLayer?: boolean }) {
  const options = [...(byLayer ? [LW_BYLAYER] : []), LW_DEFAULT, ...LINEWEIGHTS];
  return (
    <div className="max-h-72 w-44 overflow-y-auto">
      {options.map((lw) => (
        <button
          key={lw}
          type="button"
          onClick={() => onChange(lw)}
          className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted", value === lw && "bg-muted font-medium")}
        >
          <span className="w-8 border-foreground" style={{ borderTopWidth: lw > 0 ? Math.max(1, Math.min(lw / 25, 5)) : 1 }} />
          {lineweightName(lw)}
        </button>
      ))}
    </div>
  );
}

/** A compact dropdown-looking button. */
export function DropButton({ children, onClick, className, title }: { children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLElement>) => void; className?: string; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn("flex h-6 items-center gap-1.5 rounded border bg-background px-1.5 text-xs hover:border-primary/60", className)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{children}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </button>
  );
}

// --- CAD tool icons ------------------------------------------------------------------------

type IconProps = { className?: string };
const svg = (children: React.ReactNode) =>
  function Icon({ className }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className}>
        {children}
      </svg>
    );
  };

export const LineIcon = svg(
  <>
    <path d="M4 19 20 5" />
    <rect x="2.5" y="17.5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="18.5" y="3.5" width="3" height="3" fill="currentColor" stroke="none" />
  </>,
);
export const PolylineIcon = svg(
  <>
    <path d="M3 18 8 8l6 7 7-10" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    <circle cx="14" cy="15" r="1.3" fill="currentColor" />
  </>,
);
export const CircleIcon = svg(
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 12h8" strokeDasharray="2 2" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </>,
);
export const ArcIcon = svg(
  <>
    <path d="M4 18a10 10 0 0 1 16 0" />
    <circle cx="4" cy="18" r="1.3" fill="currentColor" />
    <circle cx="12" cy="8.5" r="1.3" fill="currentColor" />
    <circle cx="20" cy="18" r="1.3" fill="currentColor" />
  </>,
);
export const RectangleIcon = svg(
  <>
    <rect x="3.5" y="6" width="17" height="12" />
    <rect x="2" y="4.5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="19" y="16.5" width="3" height="3" fill="currentColor" stroke="none" />
  </>,
);
export const EllipseIcon = svg(
  <>
    <ellipse cx="12" cy="12" rx="9" ry="5.5" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
  </>,
);
export const XlineIcon = svg(
  <>
    <path d="M2 20 22 4" strokeDasharray="0" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
  </>,
);
export const RayIcon = svg(
  <>
    <path d="M5 18 22 4" />
    <circle cx="5" cy="18" r="1.6" fill="currentColor" />
  </>,
);
export const OffsetIcon = svg(
  <>
    <path d="M3 17c4-8 10-11 18-11" />
    <path d="M3 21c4-7 10-10 18-10" strokeDasharray="2.5 2" />
  </>,
);
export const FilletIcon = svg(
  <>
    <path d="M4 20V11a7 7 0 0 1 7-7h9" />
  </>,
);
export const ChamferIcon = svg(
  <>
    <path d="M4 20v-9l7-7h9" />
  </>,
);
export const MirrorIcon = svg(
  <>
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M9 7 4 17h5z" />
    <path d="M15 7l5 10h-5z" fill="currentColor" fillOpacity={0.15} />
  </>,
);
export const StretchIcon = svg(
  <>
    <path d="M3 7h9v10H3z" />
    <path d="M12 7l6 0M12 17h6M18 7v10" strokeDasharray="2 2" />
    <path d="m15 12h6m-2-2 2 2-2 2" />
  </>,
);
