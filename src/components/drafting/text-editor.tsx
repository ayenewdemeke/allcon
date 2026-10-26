"use client";

import { useState } from "react";
import type { Editor, TextEditRequest } from "@/lib/drafting/editor";
import { capRatio } from "@/lib/drafting/graphics";

// Typing text in place over the drawing, as AutoCAD's in-place text editor: at the text's
// position, size and angle. Single-line text: each line becomes a text object, and Enter on an
// empty line finishes. Multiline: Ctrl+Enter finishes. Esc or clicking away also finishes.

export function TextEditor({ editor, request, color }: { editor: Editor; request: TextEditRequest; color: string }) {
  const [value, setValue] = useState(request.value);
  const font = editor.doc.textStyles.get(request.style)?.font ?? "Arial";
  const scale = editor.view.scale;
  const px = Math.max((request.height * scale) / capRatio(font), 10);
  const s = editor.toScreen(request.at);
  // Single-line text sits on its baseline; multiline hangs from its top.
  const top = request.multiline ? s.y : s.y - px * 0.95;
  const lines = value.split("\n");
  const width = request.width > 0 ? request.width * scale : Math.max(160, ...lines.map((l) => (l.length + 2) * px * 0.55));
  const done = (text: string) => editor.closeTextEditor(text);

  return (
    <textarea
      autoFocus
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          done(value);
        } else if (e.key === "Enter" && !request.multiline && !lines[lines.length - 1].trim()) {
          // Enter on an empty line ends single-line text, as in AutoCAD.
          e.preventDefault();
          done(value);
        }
      }}
      className="absolute z-30 resize-none overflow-hidden border border-dashed border-primary/70 bg-background/10 p-0 leading-[1.4] outline-none"
      style={{
        left: s.x,
        top,
        width,
        height: Math.max(lines.length, 1) * px * (request.multiline ? 5 / 3 : 1.4) * capRatio(font) * 1.45 + 8,
        fontFamily: `"${font}", sans-serif`,
        fontSize: px,
        lineHeight: request.multiline ? `${request.height * scale * (5 / 3)}px` : `${px * 1.4}px`,
        color,
        transform: request.rotation ? `rotate(${-request.rotation}rad)` : undefined,
        transformOrigin: "top left",
      }}
    />
  );
}
