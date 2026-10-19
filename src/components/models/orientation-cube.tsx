"use client";

import { useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import type { Orientation } from "@/components/models/model-canvas";
import { cn } from "@/lib/utils";

// A view cube with a compass: click a face or a compass point to look from that side, or
// turn the view 90°. Adapted from Live Jobsite's viewer.

const CUBE = 38;
const HALF = CUBE / 2;
const SIZE = 74;
const CENTER = SIZE / 2;
const RADIUS = 33;

// CSS rotation that shows each face head-on
const FACE_ROTATIONS: Record<Orientation, { x: number; y: number }> = {
  front: { x: 0, y: 0 },
  back: { x: 0, y: 180 },
  right: { x: 0, y: -90 },
  left: { x: 0, y: 90 },
  top: { x: -90, y: 0 },
  bottom: { x: 90, y: 0 },
};

const FACES: { dir: Orientation; label: string; transform: string }[] = [
  { dir: "front", label: "FRONT", transform: `translateZ(${HALF}px)` },
  { dir: "back", label: "BACK", transform: `rotateY(180deg) translateZ(${HALF}px)` },
  { dir: "right", label: "RIGHT", transform: `rotateY(90deg) translateZ(${HALF}px)` },
  { dir: "left", label: "LEFT", transform: `rotateY(-90deg) translateZ(${HALF}px)` },
  { dir: "top", label: "TOP", transform: `rotateX(90deg) translateZ(${HALF}px)` },
  { dir: "bottom", label: "BOT", transform: `rotateX(-90deg) translateZ(${HALF}px)` },
];

const COMPASS: { label: string; title: string; dir: Orientation; style: React.CSSProperties }[] = [
  { label: "N", title: "North", dir: "back", style: { top: 0, left: "50%", transform: "translateX(-50%)" } },
  { label: "S", title: "South", dir: "front", style: { bottom: 0, left: "50%", transform: "translateX(-50%)" } },
  { label: "E", title: "East", dir: "right", style: { right: 1, top: "50%", transform: "translateY(-50%)" } },
  { label: "W", title: "West", dir: "left", style: { left: 1, top: "50%", transform: "translateY(-50%)" } },
];

export function OrientationCube({ onOrient, onRotate }: { onOrient: (dir: Orientation) => void; onRotate: (degrees: number) => void }) {
  const [rotation, setRotation] = useState({ x: -20, y: -30 });
  const orient = (dir: Orientation) => {
    setRotation(FACE_ROTATIONS[dir]);
    onOrient(dir);
  };
  const turn = (clockwise: boolean) => {
    setRotation((r) => ({ ...r, y: r.y + (clockwise ? -90 : 90) }));
    onRotate(clockwise ? 90 : -90);
  };

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg className="pointer-events-none absolute inset-0 text-muted-foreground" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.5} />
          {[0, 90, 180, 270].map((angle) => {
            const rad = ((angle - 90) * Math.PI) / 180;
            return (
              <line
                key={angle}
                x1={CENTER + (RADIUS - 3) * Math.cos(rad)}
                y1={CENTER + (RADIUS - 3) * Math.sin(rad)}
                x2={CENTER + RADIUS * Math.cos(rad)}
                y2={CENTER + RADIUS * Math.sin(rad)}
                stroke="currentColor"
                strokeOpacity={0.45}
              />
            );
          })}
        </svg>
        {COMPASS.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => orient(c.dir)}
            title={c.title}
            className={cn(
              "absolute z-20 text-[9px] leading-none font-bold",
              c.label === "N" ? "text-red-500 hover:text-red-600" : "text-muted-foreground hover:text-foreground",
            )}
            style={c.style}
          >
            {c.label}
          </button>
        ))}
        <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={{ perspective: "180px" }}>
          <div
            className="relative transition-transform duration-400 ease-out"
            style={{ width: CUBE, height: CUBE, transformStyle: "preserve-3d", transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)` }}
          >
            {FACES.map((f) => (
              <button
                key={f.dir}
                type="button"
                onClick={() => orient(f.dir)}
                title={`View from ${f.dir}`}
                className="absolute flex items-center justify-center border border-border bg-card/90 text-[6.5px] font-semibold tracking-[0.5px] text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
                style={{ width: CUBE, height: CUBE, transform: f.transform, backfaceVisibility: "hidden" }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => turn(false)} className="text-muted-foreground transition-colors hover:text-foreground" title="Turn left 90°">
          <RotateCcw className="size-3" />
        </button>
        <button type="button" onClick={() => turn(true)} className="text-muted-foreground transition-colors hover:text-foreground" title="Turn right 90°">
          <RotateCw className="size-3" />
        </button>
      </div>
    </div>
  );
}
