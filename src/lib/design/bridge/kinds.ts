import { GIRDER_RAIL_DEFAULT } from "../girders/bridge-deck";
import { BRIDGE_DEFAULTS, PIER_DEFAULTS, type BridgeInputs, type Support } from "./bridge";

// The Bridge in the Design list, and its saved inputs filled in from the defaults (each nested part
// merged, the lists kept as saved).

export const BRIDGE_INFO = {
  name: "Bridge Description and Load Path",
  short: "Alignment, spans and girders once: the girder check and the loads down to the foundations",
  description:
    "A girder bridge described once: the alignment, profile and roadway section, the abutments and piers at their stations with their skews and connections, the girders and deck. It works out the layout (each girder's span, the bearing seat elevations), runs the girder check with it, and passes the reactions down the load path to the abutments, pier caps, columns and foundations it's linked to.",
};

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = <T,>(v: unknown, d: T[]) => (Array.isArray(v) ? (v as T[]) : d);

export function bridgeInputs(saved: unknown): BridgeInputs {
  const s = obj(saved);
  const d = BRIDGE_DEFAULTS;
  const al = obj(s.alignment);
  const pr = obj(s.profile);
  return {
    ...d,
    ...(s as Partial<BridgeInputs>),
    alignment: { ...d.alignment, ...(al as Partial<BridgeInputs["alignment"]>), curves: arr(al.curves, d.alignment.curves) },
    profile: { ...d.profile, ...(pr as Partial<BridgeInputs["profile"]>), curves: arr(pr.curves, d.profile.curves) },
    roadway: { ...d.roadway, ...(obj(s.roadway) as Partial<BridgeInputs["roadway"]>) },
    rail: { ...GIRDER_RAIL_DEFAULT, ...(obj(s.rail) as Partial<NonNullable<BridgeInputs["rail"]>>) },
    supports: arr<Support>(s.supports, d.supports).map((x) => (x.pier ? { ...x, pier: { ...PIER_DEFAULTS, ...x.pier } } : x)),
    girderDesignIds: arr(s.girderDesignIds, d.girderDesignIds),
    components: arr(s.components, d.components),
  };
}
