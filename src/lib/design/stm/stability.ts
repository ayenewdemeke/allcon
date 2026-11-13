import { topology, type Pt } from "./geometry";
import { rank } from "./linalg";

// First-order axial mechanism screen: the rank of the members' compatibility matrix over the free
// degrees of freedom of every node in use. Members act as bilateral axial bars and supports stay
// active; this is not a buckling, cracked-concrete or contact stability check.

export function screen(nodesIn: Pt[], members: [number, number][], supports: [number, number][], required: number[] = []) {
  const { nodes, edges, restraints } = topology(nodesIn, members, supports);
  const used = new Set<number>([...required, ...edges.flat(), ...restraints.map((s) => s[0])]);
  const fixed = new Set(restraints.map(([i, a]) => `${i}:${a}`));
  const free: [number, number][] = [];
  for (const i of [...used].sort((a, b) => a - b)) for (const axis of [0, 1]) if (!fixed.has(`${i}:${axis}`)) free.push([i, axis]);
  const col = new Map(free.map(([i, a], k) => [`${i}:${a}`, k]));
  const matrix = edges.map(([i, j]) => {
    const row = new Array(free.length).fill(0);
    const d: Pt = [nodes[j][0] - nodes[i][0], nodes[j][1] - nodes[i][1]];
    const len = Math.hypot(d[0], d[1]);
    for (const [node, sign] of [[i, -1], [j, 1]] as const)
      for (const axis of [0, 1]) {
        const k = col.get(`${node}:${axis}`);
        if (k !== undefined) row[k] = (sign * d[axis]) / len;
      }
    return row;
  });
  const r = matrix.length && free.length ? rank(matrix).rank : 0;
  const mechanisms = free.length - r;
  return { stable: mechanisms === 0, mechanisms, freeDofs: free.length, rank: r, unused: nodes.map((_, i) => i).filter((i) => !used.has(i)) };
}
