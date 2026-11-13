import { intersects, type Pt } from "./geometry";

// Model-level checks on a solved strut-and-tie model: the strut-tie angle limit (Article 5.8.2.2,
// "shall be limited to angles greater than 25 degrees"), unconnected crossings and the axial
// mechanism screen. They don't verify member, node, anchorage or service design.

export type AngleFlag = { case: number; node: number; members: [number, number]; angle: number };

/** Each strut-tie pair meeting at a node, per case: the acute angle between their axes. */
export function angleScreen(nodes: Pt[], members: [number, number][], forces: number[][], minimum = 25) {
  const flags: AngleFlag[] = [];
  let smallest = Infinity;
  forces.forEach((f, c) => {
    nodes.forEach((p, node) => {
      const adj: { k: number; u: Pt; f: number }[] = [];
      members.forEach(([i, j], k) => {
        if ((node !== i && node !== j) || Math.abs(f[k]) <= 1e-7) return;
        const o = nodes[node === i ? j : i];
        const v: Pt = [o[0] - p[0], o[1] - p[1]];
        const len = Math.hypot(v[0], v[1]);
        adj.push({ k, u: [v[0] / len, v[1] / len], f: f[k] });
      });
      for (let a = 0; a < adj.length; a++)
        for (let b = a + 1; b < adj.length; b++) {
          if (adj[a].f * adj[b].f >= 0) continue; // only strut against tie
          const signed = adj[a].u[0] * adj[b].u[0] + adj[a].u[1] * adj[b].u[1];
          // A chord running straight through the node, a tie on one side and a strut on the other (a
          // point of contraflexure), isn't a strut meeting a tie at an angle: within 5° of straight, skip.
          if (signed < -Math.cos((5 * Math.PI) / 180)) continue;
          const dot = Math.min(1, Math.abs(signed));
          const angle = (Math.acos(dot) * 180) / Math.PI;
          smallest = Math.min(smallest, angle);
          if (angle <= minimum + 1e-8) flags.push({ case: c, node, members: [adj[a].k, adj[b].k], angle });
        }
    });
  });
  return { minimum, flags, smallest: Number.isFinite(smallest) ? smallest : null, ok: flags.length === 0 };
}

/** Active members whose centerlines cross without a shared node. */
export function crossings(nodes: Pt[], members: [number, number][]) {
  const out: [number, number][] = [];
  members.forEach(([i, j], a) => {
    members.slice(a + 1).forEach(([u, v], d) => {
      if (new Set([i, j, u, v]).size === 4 && intersects(nodes[i], nodes[j], nodes[u], nodes[v])) out.push([a, a + 1 + d]);
    });
  });
  return out;
}
