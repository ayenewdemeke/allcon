"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Home } from "lucide-react";

// A view cube like Autodesk's: it turns with the camera, and clicking a face, an edge or a
// corner looks at the model from there (26 directions). The compass ring lies on the ground
// under it, and Home goes back to the starting 3D view.
//
// The cube is built in CSS 3D. Each face is a 3×3 grid: the centre is the face, the strips are
// edges, the small squares are corners. Directions are in the scene's axes: x east, y up,
// z south (north is -z).

export type ViewDirection = [number, number, number];
export type OrientationCubeHandle = { setCamera: (viewMatrix: ArrayLike<number>) => void };

const SIZE = 64; // cube edge, px
const HALF = SIZE / 2;
const RING = 116; // compass ring diameter, px
const BOX = 144; // widget size, px

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec]; // rows

// CSS rotations as row matrices (CSS axes: x right, y down, z toward the viewer).
const rotX = (deg: number): Mat => {
  const c = Math.round(Math.cos((deg * Math.PI) / 180)), s = Math.round(Math.sin((deg * Math.PI) / 180));
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const rotY = (deg: number): Mat => {
  const c = Math.round(Math.cos((deg * Math.PI) / 180)), s = Math.round(Math.sin((deg * Math.PI) / 180));
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const apply = (m: Mat, v: Vec): Vec => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec;
const toScene = (v: Vec): Vec => [v[0], -v[1], v[2]]; // CSS y is down, the scene's is up

const FACES: { label: string; css: string; rotation: Mat }[] = [
  { label: "FRONT", css: "", rotation: rotY(0) },
  { label: "BACK", css: "rotateY(180deg)", rotation: rotY(180) },
  { label: "RIGHT", css: "rotateY(90deg)", rotation: rotY(90) },
  { label: "LEFT", css: "rotateY(-90deg)", rotation: rotY(-90) },
  { label: "TOP", css: "rotateX(90deg)", rotation: rotX(90) },
  { label: "BOTTOM", css: "rotateX(-90deg)", rotation: rotX(-90) },
];

const CELLS = [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ row, col })));

/** The view direction for a cell of a face: the face's normal plus the edges or corner it's on. */
function cellDirection(rotation: Mat, row: number, col: number): ViewDirection {
  const n = toScene(apply(rotation, [0, 0, 1]));
  const u = toScene(apply(rotation, [1, 0, 0]));
  const v = toScene(apply(rotation, [0, 1, 0]));
  return [0, 1, 2].map((i) => n[i] + col * u[i] + row * v[i]) as ViewDirection;
}

const cellName = (row: number, col: number, face: string) =>
  row === 0 && col === 0 ? `View ${face.toLowerCase()}` : row !== 0 && col !== 0 ? "View from this corner" : "View from this edge";

const COMPASS: { label: string; dir: ViewDirection; style: React.CSSProperties }[] = [
  { label: "N", dir: [0, 0, -1], style: { top: 2, left: "50%", transform: "translateX(-50%)" } },
  { label: "S", dir: [0, 0, 1], style: { bottom: 2, left: "50%", transform: "translateX(-50%)" } },
  { label: "E", dir: [1, 0, 0], style: { right: 4, top: "50%", transform: "translateY(-50%)" } },
  { label: "W", dir: [-1, 0, 0], style: { left: 4, top: "50%", transform: "translateY(-50%)" } },
];

export const OrientationCube = forwardRef<OrientationCubeHandle, { onOrient: (dir: ViewDirection) => void; onHome: () => void }>(function OrientationCube(
  { onOrient, onHome },
  ref,
) {
  const cube = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    // The camera's rotation (from its view matrix), turned into CSS axes, so the cube shows the
    // model's sides as the camera sees them. Set straight on the element: it runs every frame.
    setCamera: (e) => {
      if (!cube.current) return;
      const m = [e[0], -e[1], e[2], 0, -e[4], e[5], -e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
      cube.current.style.transform = `translateZ(-${SIZE * 2}px) matrix3d(${m.map((x) => (Math.abs(x) < 1e-10 ? 0 : x)).join(",")})`;
    },
  }));

  return (
    <div className="relative select-none" style={{ width: BOX, height: BOX }}>
      <button
        type="button"
        onClick={onHome}
        title="Home view"
        aria-label="Home view"
        className="absolute top-0 left-0 z-20 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Home className="size-4" />
      </button>
      <div className="absolute inset-0" style={{ perspective: "520px" }}>
        <div
          ref={cube}
          className="absolute top-1/2 left-1/2"
          style={{ width: 0, height: 0, transformStyle: "preserve-3d", transform: `translateZ(-${SIZE * 2}px) rotateX(-25deg) rotateY(-35deg)` }}
        >
          {/* Compass ring, lying on the ground under the cube */}
          <div
            className="absolute rounded-full border-[7px] border-slate-400/45 dark:border-slate-500/50"
            style={{ width: RING, height: RING, left: -RING / 2, top: -RING / 2, transform: `rotateX(90deg) translateZ(-${HALF + 2}px)` }}
          >
            {COMPASS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onOrient(c.dir)}
                title={`View from the ${({ N: "north", S: "south", E: "east", W: "west" } as const)[c.label as "N"]}`}
                className={`absolute text-[11px] leading-none font-bold ${c.label === "N" ? "text-red-500" : "text-slate-500 dark:text-slate-400"} hover:text-primary`}
                style={c.style}
              >
                {c.label}
              </button>
            ))}
          </div>
          {FACES.map((f) => (
            <div
              key={f.label}
              className="absolute grid border border-slate-400/70 bg-slate-50/95 dark:border-slate-500 dark:bg-slate-700/95"
              style={{
                width: SIZE,
                height: SIZE,
                left: -HALF,
                top: -HALF,
                gridTemplateColumns: "1fr 2.2fr 1fr",
                gridTemplateRows: "1fr 2.2fr 1fr",
                transform: `${f.css} translateZ(${HALF}px)`,
                backfaceVisibility: "hidden",
              }}
            >
              {CELLS.map(({ row, col }) => (
                <button
                  key={`${row}${col}`}
                  type="button"
                  title={cellName(row, col, f.label)}
                  aria-label={cellName(row, col, f.label)}
                  onClick={() => onOrient(cellDirection(f.rotation, row, col))}
                  className="flex items-center justify-center overflow-hidden text-[9.5px] font-bold tracking-tight text-slate-500 hover:bg-sky-400/55 dark:text-slate-300"
                >
                  {row === 0 && col === 0 ? f.label : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
