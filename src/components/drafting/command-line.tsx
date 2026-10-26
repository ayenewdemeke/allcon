"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, Terminal } from "lucide-react";
import type { Editor, Snapshot } from "@/lib/drafting/editor";
import { cn } from "@/lib/utils";

// The command line, floating over the bottom of the drawing as in modern AutoCAD: the last few
// lines of history above, the prompt with clickable options, what's typed, and AutoComplete.
// Typing anywhere over the drawing lands here; F2 (or the arrow) shows more history.

export function CommandLine({ editor, state }: { editor: Editor; state: Snapshot }) {
  const [expanded, setExpanded] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  const lines = expanded ? state.history.slice(-40) : state.history.slice(-3);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        setExpanded((x) => !x);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [state.history.length, expanded]);

  // The prompt with its options ([Close/Undo]) as links, as in AutoCAD.
  const prompt = state.prompt.split("\n").at(-1) ?? "";
  const promptParts = prompt.split(/(\[[^\]]*\])/);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div className="pointer-events-auto relative w-full max-w-3xl">
        {state.suggestions.length > 0 && (
          <div className="absolute bottom-full left-8 mb-1 w-72 overflow-hidden rounded-md border bg-popover text-xs shadow-lg">
            {state.suggestions.map((s, i) => (
              <button
                key={s.name}
                type="button"
                className={cn("flex w-full items-baseline gap-2 px-2 py-1 text-left hover:bg-muted", i === 0 && "bg-muted/60")}
                onClick={() => editor.runCommand(s.name)}
              >
                <span className="font-mono font-semibold">{s.name}</span>
                {s.aliases[0] && <span className="font-mono text-muted-foreground">({s.aliases.join(", ")})</span>}
                <span className="ml-auto truncate text-muted-foreground">{s.description}</span>
              </button>
            ))}
          </div>
        )}
        {lines.length > 0 && (
          <div ref={history} className={cn("mb-0.5 overflow-y-auto rounded-t-md bg-background/85 px-3 py-1 font-mono text-[11px] leading-[1.35rem] shadow-sm backdrop-blur-sm", expanded ? "max-h-64" : "max-h-24")}>
            {lines.map((l, i) => (
              <div key={i} className={cn("truncate", l.kind === "error" ? "text-destructive" : l.kind === "command" ? "text-foreground" : "text-muted-foreground")}>
                {l.text}
              </div>
            ))}
          </div>
        )}
        <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 font-mono text-xs shadow-md">
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground" title="Command history (F2)" aria-label="Command history">
            <ChevronUp className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </button>
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <span className={cn("truncate", state.command ? "text-foreground" : "text-muted-foreground")}>
              {state.command && <span className="mr-1 font-semibold">{state.command}</span>}
              {promptParts.map((part, i) =>
                part.startsWith("[") ? (
                  <span key={i}>
                    [
                    {part
                      .slice(1, -1)
                      .split("/")
                      .map((label, j, all) => {
                        const keyword = state.keywords.find((k) => k.label === label);
                        return (
                          <span key={label}>
                            <button
                              type="button"
                              className="rounded bg-primary/10 px-0.5 text-primary hover:bg-primary/20"
                              onClick={() => keyword && editor.answer(keyword.key)}
                            >
                              {label}
                            </button>
                            {j < all.length - 1 && "/"}
                          </span>
                        );
                      })}
                    ]
                  </span>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
            </span>
            <span className="text-foreground">
              {state.buffer}
              <span className="animate-pulse">▏</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
