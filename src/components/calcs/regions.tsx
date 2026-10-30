"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { uprightUnits, type Result } from "@/lib/calcs/evaluate";
import type { ImageRegion, MathRegion, TextRegion } from "@/lib/calcs/types";
import { cn } from "@/lib/utils";
import { loadMathLive, makeField, type MathfieldElement } from "./mathlive";

// A worksheet's regions: math (typed in a MathLive field, shown as rendered math with its
// result), text and pictures. Results show after "=" as Mathcad does, with an optional unit to show
// them in; errors mark the region red.

type MathLive = Awaited<ReturnType<typeof loadMathLive>>;

/** Mathcad's keys in a math field: ":" defines and "=" evaluates the whole expression (so they
 * go at the end, even from inside a subscript or a fraction), "*" is the multiplication dot,
 * " starts a string (another " ends it), and ";" is the range operator (..). Returns whether
 * it handled the key. */
export function mathcadKey(mf: MathfieldElement, key: string, previous: string) {
  const insert = (latex: string, atEnd: boolean) => {
    if (atEnd) mf.executeCommand("moveToMathfieldEnd");
    mf.executeCommand(["insert", latex]);
    return true;
  };
  if (key === '"') return mf.executeCommand(["switchMode", mf.mode === "text" ? "math" : "text"]), true;
  if (mf.mode === "text") return false;
  if (key === ":") return insert("\\coloneq", true);
  if (key === "=" && !["<", ">", "!"].includes(previous)) return insert("=", true);
  if (key === "*") return insert("\\cdot", false);
  if (key === ";") return insert("..", false); // the range operator
  return false;
}

/** Rendered math (when it isn't being edited). */
/** Rendered math, kept by its LaTeX: re-rendering a large worksheet doesn't set it all again. */
const markup = new Map<string, string>();
function markupOf(ml: MathLive, latex: string) {
  let html = markup.get(latex);
  if (html === undefined) {
    html = ml.convertLatexToMarkup(latex);
    markup.set(latex, html);
    if (markup.size > 5000) markup.delete(markup.keys().next().value!);
  }
  return html;
}

export function StaticMath({ ml, latex, className }: { ml: MathLive | null; latex: string; className?: string }) {
  if (!ml) return <span className={cn("font-mono text-sm", className)}>{latex}</span>;
  return <span className={className} dangerouslySetInnerHTML={{ __html: markupOf(ml, latex) }} />;
}

export function MathRegionView({
  ml,
  region,
  result,
  editing,
  selected,
  onDraft,
  onCommit,
  onEnter,
  onUnit,
  fieldRef,
  typerRef,
  takePending,
  takeInsert,
  returnPending,
}: {
  ml: MathLive | null;
  region: MathRegion;
  result: Result | undefined;
  editing: boolean;
  selected: boolean;
  onDraft: (latex: string) => void;
  onCommit: (latex: string) => void;
  onEnter: (latex: string) => void;
  onUnit: (unit: string) => void;
  fieldRef: React.RefObject<MathfieldElement | null>;
  /** Types keys into the field being edited (for keys that reached the page instead). */
  typerRef: React.RefObject<((keys: string) => void) | null>;
  takePending?: () => string;
  /** Math from the ribbon that started the region (a template: its first slot gets the caret). */
  takeInsert?: () => string;
  /** Keys typed after an Enter, before the field was ready: for the next region. */
  returnPending?: (keys: string) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const handlers = useRef({ onDraft, onCommit, onEnter, takePending, takeInsert, returnPending });
  useEffect(() => {
    handlers.current = { onDraft, onCommit, onEnter, takePending, takeInsert, returnPending };
  });

  // Editing: a MathLive field in place of the rendered math.
  useEffect(() => {
    if (!editing || !ml || !host.current) return;
    const mf = makeField(ml, region.latex);
    let done = false;
    const finish = (how: "commit" | "enter") => {
      if (done) return;
      done = true;
      if (fieldRef.current === mf) fieldRef.current = null; // keys from now on aren't for this field
      if (typerRef.current === typeKeys) typerRef.current = null;
      if (how === "enter") handlers.current.onEnter(mf.value);
      else handlers.current.onCommit(mf.value);
    };
    mf.addEventListener("input", () => handlers.current.onDraft(mf.value));
    let lastKey = "";
    mf.addEventListener(
      "keydown",
      (e) => {
        const previous = lastKey;
        lastKey = e.key;
        if ((e.ctrlKey || e.metaKey) && e.key === ".") {
          // Ctrl+. : symbolic evaluation (→), at the end, as in Mathcad.
          e.preventDefault();
          e.stopPropagation();
          mf.executeCommand("moveToMathfieldEnd");
          mf.executeCommand(["insert", "\\to"]);
          handlers.current.onDraft(mf.value);
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          finish("enter");
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish("commit");
        } else if (mathcadKey(mf, e.key, previous)) {
          e.preventDefault();
          e.stopPropagation();
          handlers.current.onDraft(mf.value);
        }
      },
      { capture: true },
    );
    mf.addEventListener("focusout", (e) => {
      // A ribbon list (units, matrix size) takes the focus for a moment: still editing.
      if (e.relatedTarget instanceof HTMLSelectElement && e.relatedTarget.closest("[data-ribbon]")) return;
      setTimeout(() => !done && !mf.hasFocus() && finish("commit"), 0);
    });
    /** Types keys into the field ("\n" is Enter): what was typed while it was being made, or
     * keys that reached the page before it had the focus. After an Enter, the rest is the next
     * region's. */
    let previous = "";
    const typeKeys = (keys: string) => {
      if (done || !keys) return;
      const enter = keys.indexOf("\n");
      for (const key of enter < 0 ? keys : keys.slice(0, enter)) {
        if (!mathcadKey(mf, key, previous)) mf.executeCommand(["typedText", key, { simulateKeystroke: true }]);
        previous = key;
      }
      handlers.current.onDraft(mf.value);
      if (enter >= 0) {
        handlers.current.returnPending?.(keys.slice(enter + 1));
        finish("enter");
      }
    };
    // Listen before it's in the page: it mounts as it's added.
    mf.addEventListener(
      "mount",
      () => {
        fieldRef.current = mf;
        typerRef.current = typeKeys;
        mf.focus();
        mf.executeCommand("moveToMathfieldEnd");
        const template = handlers.current.takeInsert?.();
        if (template) {
          mf.executeCommand(["insert", template]);
          handlers.current.onDraft(mf.value);
        }
        requestAnimationFrame(() => !done && !mf.hasFocus() && mf.focus());
        typeKeys(handlers.current.takePending?.() ?? "");
      },
      { once: true },
    );
    host.current.appendChild(mf);
    return () => {
      if (fieldRef.current === mf) fieldRef.current = null;
      if (typerRef.current === typeKeys) typerRef.current = null;
      mf.remove();
    };
    // The field is made once per editing session; region.latex is its starting value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, ml]);

  const error = result?.kind === "error" && !(editing && result.incomplete) ? result : null;
  const shown = result?.kind === "ok" ? result.result : undefined;
  return (
    <span className={cn("inline-flex items-baseline gap-1 rounded-sm px-1 py-0.5 text-[16px] leading-tight", error && "bg-red-50 ring-1 ring-red-500", selected && !editing && "ring-1 ring-primary")}>
      {editing ? (
        <span ref={host} className="calc-field inline-block min-w-8" />
      ) : (
        <StaticMath ml={ml} latex={region.latex ? uprightUnits(region.latex, result?.kind === "ok" ? (result.units ?? []) : []) : "\\placeholder{}"} />
      )}
      {shown && <StaticMath ml={ml} latex={shown} />}
      {shown && (selected || editing || region.displayUnit) && shown.includes("\\mathrm") && (
        <UnitBox value={region.displayUnit ?? ""} onCommit={onUnit} visible={selected || editing} />
      )}
      {error && (selected || editing) && <span className="no-print absolute top-full left-0 mt-1 rounded bg-red-600 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white shadow">{error.message}</span>}
    </span>
  );
}

/** The unit to show a result in (Mathcad's unit placeholder): blank shows it automatically. */
function UnitBox({ value, onCommit, visible }: { value: string; onCommit: (unit: string) => void; visible: boolean }) {
  const [text, setText] = useState(value);
  if (!visible) return null;
  return (
    <input
      value={text}
      placeholder="unit"
      title="Show the result in a unit (kip*ft, ksi, kN*m); blank shows it automatically"
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(value);
      }}
      className="no-print ml-1 h-5 w-16 rounded border border-dashed border-primary/60 bg-white px-1 font-mono text-[11px] text-foreground outline-none focus:border-solid"
    />
  );
}

const TEXT_STYLES: Record<TextRegion["style"], string> = {
  normal: "text-[14px]",
  heading: "text-[20px] font-bold",
  subheading: "text-[16px] font-semibold",
  note: "text-[12px] italic text-neutral-600",
};

let measurer: CanvasRenderingContext2D | null = null;

export function TextRegionView({
  region,
  editing,
  selected,
  maxWidth,
  onCommit,
}: {
  region: TextRegion;
  editing: boolean;
  selected: boolean;
  maxWidth: number;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(region.text);
  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  useLayoutEffect(() => {
    // Grow with the text, as Mathcad's text regions do: as wide as its longest line (so a click
    // beside it is on the page, not in it), wrapping at the page's margin; then as tall as it needs.
    const el = ref.current;
    if (!el) return;
    const css = getComputedStyle(el);
    measurer ??= document.createElement("canvas").getContext("2d");
    let longest = 0;
    if (measurer) {
      measurer.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      for (const line of text.split("\n")) longest = Math.max(longest, measurer.measureText(line).width);
    }
    el.style.width = `${Math.min(maxWidth, Math.max(24, Math.ceil(longest) + 14))}px`;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, editing, maxWidth]);
  const style = TEXT_STYLES[region.style];
  if (editing)
    return (
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        rows={1}
        className={cn("block resize-none overflow-hidden rounded-sm bg-white px-1 py-0.5 leading-snug outline-none ring-1 ring-primary", style)}
      />
    );
  return (
    <div style={{ maxWidth }} className={cn("rounded-sm px-1 py-0.5 leading-snug whitespace-pre-wrap", style, selected && "ring-1 ring-primary", !region.text && "text-neutral-400")}>
      {region.text || "Text"}
    </div>
  );
}

/** A picture, drawn as an image (so its markup can't run anything). */
export function ImageRegionView({ region, selected }: { region: ImageRegion; selected: boolean }) {
  return (
    <div className={cn("rounded-sm p-1", selected && "ring-1 ring-primary")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a drawing held in the worksheet */}
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(region.svg)}`} width={region.width} height={region.height} alt="" draggable={false} className="block bg-white select-none" />
    </div>
  );
}
