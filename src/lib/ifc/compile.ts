import { createHash } from "node:crypto";
import { anchorOffset, elementQuantities, openingDeductions, openingPlacement, polygonArea, segments, sub, sweepFrame, type Vec3 } from "./geometry";
import { METERS_PER_UNIT, type ModelElement, type ModelSpec, type Profile } from "./spec";

// Compiles a model spec to an IFC4X3 file (STEP text). Geometry is swept solids
// (IfcExtrudedAreaSolid), each element gets its material, a property set with its mark and
// source sheet, base quantities, and a colour by material for viewers.

const SCHEMA = "IFC4X3_ADD2";

// --- STEP values -------------------------------------------------------------------

const real = (n: number) => {
  if (!Number.isFinite(n)) throw new Error("Non-finite number in model");
  const r = Math.abs(n) < 1e-12 ? 0 : n;
  const s = String(Number(r.toPrecision(12)));
  if (/e/i.test(s)) {
    const [m, e] = s.split(/e/i);
    return `${m.includes(".") ? m : `${m}.`}E${e}`;
  }
  return s.includes(".") ? s : `${s}.`;
};
/** STEP string: quotes doubled, non-ASCII as \X2\ hex. */
export const str = (s: string | null | undefined) => {
  if (s == null || s === "") return "$";
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (code >= 32 && code < 127) out += ch;
    else if (code <= 0xffff) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    else out += "?";
  }
  return `'${out}'`;
};
const ref = (id: number) => `#${id}`;
const list = (items: string[]) => `(${items.join(",")})`;
const enumv = (v: string) => `.${v}.`;

// IFC GlobalId: 128 bits in IFC's base64 alphabet, 22 characters. Derived from the model and
// element ids, so an element keeps its GlobalId across revisions.
const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
export function ifcGuid(seed: string) {
  const [mask, shift] = [BigInt(63), BigInt(6)];
  let n = BigInt(`0x${createHash("sha256").update(seed).digest("hex").slice(0, 32)}`);
  let out = "";
  for (let i = 0; i < 22; i++) {
    out = IFC64[Number(n & mask)] + out;
    n >>= shift;
  }
  // The first character only carries 2 bits.
  return IFC64[IFC64.indexOf(out[0]) & 3] + out.slice(1);
}

// --- element mapping -------------------------------------------------------------------

type EntityInfo = { entity: string; predefined?: string; objectType?: string };
const ENTITY: Record<ModelElement["type"], EntityInfo> = {
  wall: { entity: "IFCWALL", predefined: "NOTDEFINED" },
  abutment: { entity: "IFCWALL", predefined: "USERDEFINED", objectType: "Abutment" },
  wingwall: { entity: "IFCWALL", predefined: "USERDEFINED", objectType: "Wingwall" },
  slab: { entity: "IFCSLAB", predefined: "FLOOR" },
  deck: { entity: "IFCSLAB", predefined: "USERDEFINED", objectType: "Deck" },
  beam: { entity: "IFCBEAM", predefined: "BEAM" },
  girder: { entity: "IFCBEAM", predefined: "GIRDER_SEGMENT" },
  column: { entity: "IFCCOLUMN", predefined: "COLUMN" },
  pier: { entity: "IFCCOLUMN", predefined: "PIERSTEM" },
  footing: { entity: "IFCFOOTING", predefined: "NOTDEFINED" },
  pile_cap: { entity: "IFCFOOTING", predefined: "PILE_CAP" },
  pile: { entity: "IFCPILE", predefined: "NOTDEFINED" },
  plate: { entity: "IFCPLATE", predefined: "NOTDEFINED" },
  member: { entity: "IFCMEMBER", predefined: "NOTDEFINED" },
  brace: { entity: "IFCMEMBER", predefined: "BRACE" },
  railing: { entity: "IFCRAILING", predefined: "NOTDEFINED" },
  barrier: { entity: "IFCRAILING", predefined: "GUARDRAIL" },
  stair: { entity: "IFCSTAIRFLIGHT", predefined: "NOTDEFINED" },
  bearing: { entity: "IFCBEARING", predefined: "NOTDEFINED" },
  roof: { entity: "IFCSLAB", predefined: "ROOF" },
  ceiling: { entity: "IFCCOVERING", predefined: "CEILING" },
  covering: { entity: "IFCCOVERING", predefined: "NOTDEFINED" },
  curtain_panel: { entity: "IFCPLATE", predefined: "CURTAIN_PANEL" },
  mullion: { entity: "IFCMEMBER", predefined: "MULLION" },
  furniture: { entity: "IFCFURNITURE", predefined: "NOTDEFINED" },
  other: { entity: "IFCBUILDINGELEMENTPROXY", predefined: "NOTDEFINED" },
};

const COLORS: Record<string, [number, number, number]> = {
  concrete: [0.72, 0.72, 0.7],
  steel: [0.42, 0.5, 0.6],
  timber: [0.66, 0.5, 0.32],
  masonry: [0.7, 0.42, 0.33],
  aluminum: [0.78, 0.8, 0.83],
  glass: [0.55, 0.75, 0.85],
  earth: [0.55, 0.45, 0.33],
  other: [0.6, 0.62, 0.66],
};

// --- writer --------------------------------------------------------------------------

export function compileIfc(spec: ModelSpec, opts: { modelId: string; name: string; author?: string }) {
  const lines: string[] = [];
  let next = 1;
  const add = (entity: string, ...args: string[]) => {
    const id = next++;
    lines.push(`#${id}=${entity}(${args.join(",")});`);
    return id;
  };
  const guid = (part: string) => str(ifcGuid(`${opts.modelId}:${part}`));
  const point = (p: number[]) => add("IFCCARTESIANPOINT", list(p.map(real)));
  const direction = (d: number[]) => add("IFCDIRECTION", list(d.map(real)));

  // Units, context and spatial structure
  const dims = add("IFCDIMENSIONALEXPONENTS", "1", "0", "0", "0", "0", "0", "0");
  const metre = add("IFCSIUNIT", "*", enumv("LENGTHUNIT"), "$", enumv("METRE"));
  let lengthUnit = metre;
  if (spec.units === "mm") lengthUnit = add("IFCSIUNIT", "*", enumv("LENGTHUNIT"), enumv("MILLI"), enumv("METRE"));
  if (spec.units === "ft" || spec.units === "in") {
    const factor = spec.units === "ft" ? 0.3048 : 0.0254;
    const measure = add("IFCMEASUREWITHUNIT", `IFCLENGTHMEASURE(${real(factor)})`, ref(metre));
    lengthUnit = add("IFCCONVERSIONBASEDUNIT", ref(dims), enumv("LENGTHUNIT"), str(spec.units === "ft" ? "FOOT" : "INCH"), ref(measure));
  }
  const area = add("IFCSIUNIT", "*", enumv("AREAUNIT"), "$", enumv("SQUARE_METRE"));
  const volume = add("IFCSIUNIT", "*", enumv("VOLUMEUNIT"), "$", enumv("CUBIC_METRE"));
  const angle = add("IFCSIUNIT", "*", enumv("PLANEANGLEUNIT"), "$", enumv("RADIAN"));
  const units = add("IFCUNITASSIGNMENT", list([lengthUnit, area, volume, angle].map(ref)));

  const origin = point([0, 0, 0]);
  const zAxis = direction([0, 0, 1]);
  const xAxis = direction([1, 0, 0]);
  const world = add("IFCAXIS2PLACEMENT3D", ref(origin), ref(zAxis), ref(xAxis));
  const context = add("IFCGEOMETRICREPRESENTATIONCONTEXT", "$", str("Model"), "3", real(1e-5), ref(world), "$");
  const body = add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", str("Body"), str("Model"), "*", "*", "*", "*", ref(context), "$", enumv("MODEL_VIEW"), "$");
  const project = add("IFCPROJECT", guid("project"), "$", str(opts.name), str("Created with conkit"), "$", "$", "$", list([ref(context)]), ref(units));
  const placement = add("IFCLOCALPLACEMENT", "$", ref(world));
  if (spec.lod) {
    // The model's target LOD, where IFC tools (and conkit's detailed models) can read it.
    const target = add("IFCPROPERTYSINGLEVALUE", str("TargetLOD"), "$", `IFCLABEL(${str(spec.lod)})`, "$");
    const pset = add("IFCPROPERTYSET", guid("pset:project"), "$", str("Pset_Conkit"), "$", list([ref(target)]));
    add("IFCRELDEFINESBYPROPERTIES", guid("relp:project"), "$", "$", "$", list([ref(project)]), ref(pset));
  }

  const site = add("IFCSITE", guid("site"), "$", str("Site"), "$", "$", ref(placement), "$", "$", enumv("ELEMENT"), "$", "$", "$", "$", "$");
  const facility =
    spec.facility === "bridge"
      ? add("IFCBRIDGE", guid("facility"), "$", str(opts.name), "$", "$", ref(placement), "$", "$", enumv("ELEMENT"), enumv("NOTDEFINED"))
      : spec.facility === "building"
        ? add("IFCBUILDING", guid("facility"), "$", str(opts.name), "$", "$", ref(placement), "$", "$", enumv("ELEMENT"), "$", "$", "$")
        : null;
  add("IFCRELAGGREGATES", guid("rel:project"), "$", "$", "$", ref(project), list([ref(site)]));
  if (facility) add("IFCRELAGGREGATES", guid("rel:site"), "$", "$", "$", ref(site), list([ref(facility)]));
  const container = facility ?? site;

  // Building storeys (levels); bridge and site elements stay in the facility or site.
  const storeys = new Map<string, number>();
  if (spec.facility === "building" && spec.levels.length) {
    for (const level of spec.levels) {
      storeys.set(
        level.id,
        add("IFCBUILDINGSTOREY", guid(`level:${level.id}`), "$", str(level.name), "$", "$", ref(placement), "$", "$", enumv("ELEMENT"), real(level.elevation)),
      );
    }
    add("IFCRELAGGREGATES", guid("rel:levels"), "$", "$", "$", ref(container), list([...storeys.values()].map(ref)));
  }

  // Materials and their colours
  const materials = new Map<string, { id: number; style: number }>();
  const styleFor = (category: string, transparency = category === "glass" ? 0.6 : 0) => {
    const [r, g, b] = COLORS[category] ?? COLORS.other;
    const colour = add("IFCCOLOURRGB", str(category), real(r), real(g), real(b));
    const shading = add("IFCSURFACESTYLESHADING", ref(colour), real(transparency));
    return add("IFCSURFACESTYLE", str(category), enumv("BOTH"), list([ref(shading)]));
  };
  const defaultStyle = styleFor("other");
  for (const m of spec.materials) {
    materials.set(m.id, { id: add("IFCMATERIAL", str(m.grade ? `${m.name} (${m.grade})` : m.name), "$", str(m.category)), style: styleFor(m.category) });
  }

  // Elements
  const elementIds = new Map<string, { id: number; where: number }>();
  const contained = new Map<number, number[]>();
  const byMaterial = new Map<number, number[]>();
  const skipped: string[] = [];
  const deductions = openingDeductions(spec); // net volumes leave out doors, windows and openings
  spec.elements.forEach((e) => {
    const segs = segments(e);
    if (!segs.length) {
      skipped.push(e.id);
      return;
    }
    const material = e.material ? materials.get(e.material) : undefined;
    const solids = segs.map((seg) => {
      // A vertical segment is always extruded upwards, so plan outlines aren't mirrored.
      const down = seg.end[2] < seg.start[2] && Math.abs(seg.end[2] - seg.start[2]) > 0.999 * seg.length;
      const s = down ? { ...seg, start: seg.end, end: seg.start } : seg;
      const frame = sweepFrame(sub(s.end as Vec3, s.start as Vec3), e.rotation);
      const profile = writeProfile(e.profile, anchorOffset(e, frame.vertical), add, point, direction);
      const position = add("IFCAXIS2PLACEMENT3D", ref(point(s.start)), ref(direction(frame.z)), ref(direction(frame.x)));
      const solid = add("IFCEXTRUDEDAREASOLID", ref(profile), ref(position), ref(zAxis), real(s.length));
      add("IFCSTYLEDITEM", ref(solid), list([ref(material?.style ?? defaultStyle)]), "$");
      return solid;
    });
    const shape = add("IFCSHAPEREPRESENTATION", ref(body), str("Body"), str("SweptSolid"), list(solids.map(ref)));
    const productShape = add("IFCPRODUCTDEFINITIONSHAPE", "$", "$", list([ref(shape)]));

    const info = ENTITY[e.type];
    const head = [guid(`el:${e.id}`), "$", str(e.name ?? e.mark ?? e.id), "$", str(info.objectType), ref(placement), ref(productShape), str(e.mark ?? e.id)];
    const tail =
      info.entity === "IFCPILE"
        ? [enumv(info.predefined!), "$"] // PredefinedType, ConstructionType
        : info.entity === "IFCSTAIRFLIGHT"
          ? ["$", "$", "$", "$", enumv(info.predefined!)] // risers, treads, riser height, tread length
          : [enumv(info.predefined!)];
    const element = add(info.entity, ...head, ...tail);

    const where = (e.level && storeys.get(e.level)) || container;
    contained.set(where, [...(contained.get(where) ?? []), element]);
    elementIds.set(e.id, { id: element, where });
    if (material) byMaterial.set(material.id, [...(byMaterial.get(material.id) ?? []), element]);

    // Mark, source sheet and assumptions
    const props = [
      ["Mark", e.mark],
      ["ConkitId", e.id],
      ["SourceSheet", e.sheet],
      ["Notes", e.notes],
      ["LOD", e.lod],
      ["Basis", e.basis],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => add("IFCPROPERTYSINGLEVALUE", str(k), "$", `IFCLABEL(${str(v)})`, "$"));
    const pset = add("IFCPROPERTYSET", guid(`pset:${e.id}`), "$", str("Pset_Conkit"), "$", list(props.map(ref)));
    add("IFCRELDEFINESBYPROPERTIES", guid(`relp:${e.id}`), "$", "$", "$", list([ref(element)]), ref(pset));

    // Base quantities (volume in m³, length in model units)
    const q = elementQuantities(e, spec);
    const qLength = add("IFCQUANTITYLENGTH", str("Length"), "$", "$", real(q.length), "$");
    const cut = (deductions.get(e.id)?.volume ?? 0) * METERS_PER_UNIT[spec.units] ** 3;
    const qVolume = add("IFCQUANTITYVOLUME", str("NetVolume"), "$", "$", real(Math.max(0, q.volumeM3 - cut)), "$");
    const qGross = add("IFCQUANTITYVOLUME", str("GrossVolume"), "$", "$", real(q.volumeM3), "$");
    const qto = add("IFCELEMENTQUANTITY", guid(`qto:${e.id}`), "$", str("Qto_ConkitBaseQuantities"), "$", "$", list([ref(qLength), ref(qVolume), ref(qGross)]));
    add("IFCRELDEFINESBYPROPERTIES", guid(`relq:${e.id}`), "$", "$", "$", list([ref(element)]), ref(qto));
  });

  // Doors, windows and openings: an opening voids its host wall, and a door or window fills it.
  const unit = METERS_PER_UNIT[spec.units];
  const panel = 0.05 / unit; // door/window leaf thickness, 50 mm
  const glass = styleFor("glass");
  const doorStyle = styleFor("timber");
  const box = (center: Vec3, along: Vec3, across: Vec3, width: number, height: number, depth: number, style: number) => {
    const position = add(
      "IFCAXIS2PLACEMENT3D",
      ref(point(center.map((c, i) => c - across[i] * (depth / 2)))),
      ref(direction(across)),
      ref(direction(along)),
    );
    const profile = add("IFCRECTANGLEPROFILEDEF", enumv("AREA"), "$", ref(add("IFCAXIS2PLACEMENT2D", ref(point([0, 0])), ref(direction([1, 0])))), real(width), real(height));
    const solid = add("IFCEXTRUDEDAREASOLID", ref(profile), ref(position), ref(zAxis), real(depth));
    add("IFCSTYLEDITEM", ref(solid), list([ref(style)]), "$");
    const rep = add("IFCSHAPEREPRESENTATION", ref(body), str("Body"), str("SweptSolid"), list([ref(solid)]));
    return add("IFCPRODUCTDEFINITIONSHAPE", "$", "$", list([ref(rep)]));
  };
  for (const o of spec.openings) {
    const host = spec.elements.find((e) => e.id === o.host);
    const hostIds = elementIds.get(o.host);
    const at = host && hostIds ? openingPlacement(host, o) : null;
    if (!at || !hostIds) {
      skipped.push(o.id);
      continue;
    }
    const voidShape = box(at.center, at.along, at.across, o.width, o.height, at.thickness + 2 * panel, defaultStyle);
    const opening = add("IFCOPENINGELEMENT", guid(`op:${o.id}`), "$", str(`Opening ${o.mark ?? o.id}`), "$", "$", ref(placement), ref(voidShape), str(o.id), enumv("OPENING"));
    add("IFCRELVOIDSELEMENT", guid(`relv:${o.id}`), "$", "$", "$", ref(hostIds.id), ref(opening));
    if (o.kind === "opening") continue;
    const material = o.material ? materials.get(o.material) : undefined;
    const leaf = box(at.center, at.along, at.across, o.width, o.height, Math.min(panel, at.thickness), material?.style ?? (o.kind === "window" ? glass : doorStyle));
    const head = [guid(`fill:${o.id}`), "$", str(o.name ?? o.mark ?? o.id), "$", "$", ref(placement), ref(leaf), str(o.mark ?? o.id), real(o.height), real(o.width)];
    const filler =
      o.kind === "door"
        ? add("IFCDOOR", ...head, enumv("DOOR"), enumv("NOTDEFINED"), "$")
        : add("IFCWINDOW", ...head, enumv("WINDOW"), enumv("NOTDEFINED"), "$");
    add("IFCRELFILLSELEMENT", guid(`relf:${o.id}`), "$", "$", "$", ref(opening), ref(filler));
    contained.set(hostIds.where, [...(contained.get(hostIds.where) ?? []), filler]);
    if (material) byMaterial.set(material.id, [...(byMaterial.get(material.id) ?? []), filler]);
    const props = [["Mark", o.mark], ["ConkitId", o.id], ["SourceSheet", o.sheet], ["Notes", o.notes], ["LOD", o.lod], ["Basis", o.basis]]
      .filter(([, v]) => v)
      .map(([k, v]) => add("IFCPROPERTYSINGLEVALUE", str(k), "$", `IFCLABEL(${str(v)})`, "$"));
    const pset = add("IFCPROPERTYSET", guid(`pset:op:${o.id}`), "$", str("Pset_Conkit"), "$", list(props.map(ref)));
    add("IFCRELDEFINESBYPROPERTIES", guid(`relp:op:${o.id}`), "$", "$", "$", list([ref(filler)]), ref(pset));
  }

  // Rooms: the floor outline extruded to the ceiling, with floor area and height.
  const spaceStyle = (() => {
    const colour = add("IFCCOLOURRGB", str("space"), real(0.45), real(0.65), real(0.95));
    const shading = add("IFCSURFACESTYLESHADING", ref(colour), real(0.8));
    return add("IFCSURFACESTYLE", str("space"), enumv("BOTH"), list([ref(shading)]));
  })();
  const spacesBy = new Map<number, number[]>();
  for (const sp of spec.spaces) {
    const pts = sp.outline.map((q) => point([q[0], q[1]]));
    const curve = add("IFCPOLYLINE", list([...pts, pts[0]].map(ref)));
    const profile = add("IFCARBITRARYCLOSEDPROFILEDEF", enumv("AREA"), "$", ref(curve));
    const position = add("IFCAXIS2PLACEMENT3D", ref(point([0, 0, sp.base])), ref(zAxis), ref(xAxis));
    const solid = add("IFCEXTRUDEDAREASOLID", ref(profile), ref(position), ref(zAxis), real(sp.height));
    add("IFCSTYLEDITEM", ref(solid), list([ref(spaceStyle)]), "$");
    const rep = add("IFCSHAPEREPRESENTATION", ref(body), str("Body"), str("SweptSolid"), list([ref(solid)]));
    const shape = add("IFCPRODUCTDEFINITIONSHAPE", "$", "$", list([ref(rep)]));
    const space = add("IFCSPACE", guid(`sp:${sp.id}`), "$", str(sp.number ?? sp.name), "$", "$", ref(placement), ref(shape), str(sp.name), enumv("ELEMENT"), enumv("SPACE"), "$");
    const parent = (sp.level && storeys.get(sp.level)) || facility || site;
    spacesBy.set(parent, [...(spacesBy.get(parent) ?? []), space]);
    const areaM2 = polygonArea(sp.outline) * unit ** 2;
    const qArea = add("IFCQUANTITYAREA", str("NetFloorArea"), "$", "$", real(areaM2), "$");
    const qHeight = add("IFCQUANTITYLENGTH", str("Height"), "$", "$", real(sp.height), "$");
    const qto = add("IFCELEMENTQUANTITY", guid(`qto:sp:${sp.id}`), "$", str("Qto_SpaceBaseQuantities"), "$", "$", list([ref(qArea), ref(qHeight)]));
    add("IFCRELDEFINESBYPROPERTIES", guid(`relq:sp:${sp.id}`), "$", "$", "$", list([ref(space)]), ref(qto));
    const spProps = [["ConkitId", sp.id], ["SourceSheet", sp.sheet], ["Notes", sp.notes], ["LOD", sp.lod], ["Basis", sp.basis]]
      .filter(([, v]) => v)
      .map(([k, v]) => add("IFCPROPERTYSINGLEVALUE", str(k), "$", `IFCLABEL(${str(v)})`, "$"));
    const spPset = add("IFCPROPERTYSET", guid(`pset:sp:${sp.id}`), "$", str("Pset_Conkit"), "$", list(spProps.map(ref)));
    add("IFCRELDEFINESBYPROPERTIES", guid(`relp:sp:${sp.id}`), "$", "$", "$", list([ref(space)]), ref(spPset));
  }
  for (const [parent, spaces] of spacesBy) {
    add("IFCRELAGGREGATES", guid(`rela:sp:${parent}`), "$", "$", "$", ref(parent), list(spaces.map(ref)));
  }

  for (const [structure, elements] of contained) {
    add("IFCRELCONTAINEDINSPATIALSTRUCTURE", guid(`relc:${structure}`), "$", "$", "$", list(elements.map(ref)), ref(structure));
  }
  for (const [materialId, elements] of byMaterial) {
    add("IFCRELASSOCIATESMATERIAL", guid(`relm:${materialId}`), "$", "$", "$", list(elements.map(ref)), ref(materialId));
  }

  const now = new Date().toISOString().slice(0, 19);
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');`,
    `FILE_NAME(${str(`${opts.name}.ifc`)},'${now}',(${str(opts.author ?? "")}),(''),'conkit','conkit','');`,
    `FILE_SCHEMA(('${SCHEMA}'));`,
    "ENDSEC;",
    "DATA;",
  ];
  return { text: [...header, ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n"), skipped };
}

function writeProfile(
  p: Profile,
  offsetY: number,
  add: (entity: string, ...args: string[]) => number,
  point: (p: number[]) => number,
  direction: (d: number[]) => number,
) {
  const position = add("IFCAXIS2PLACEMENT2D", ref(point([0, offsetY])), ref(direction([1, 0])));
  const area = enumv("AREA");
  switch (p.kind) {
    case "rect":
      return add("IFCRECTANGLEPROFILEDEF", area, "$", ref(position), real(p.width), real(p.depth));
    case "circle":
      return add("IFCCIRCLEPROFILEDEF", area, "$", ref(position), real(p.radius));
    case "tube":
      return add("IFCCIRCLEHOLLOWPROFILEDEF", area, "$", ref(position), real(p.radius), real(Math.min(p.wall, p.radius * 0.999)));
    case "i":
      return add("IFCISHAPEPROFILEDEF", area, "$", ref(position), real(p.flange_width), real(p.depth), real(p.web_thickness), real(p.flange_thickness), "$", "$", "$");
    case "tee":
      return add("IFCTSHAPEPROFILEDEF", area, "$", ref(position), real(p.depth), real(p.flange_width), real(p.web_thickness), real(p.flange_thickness), "$", "$", "$", "$", "$");
    case "angle":
      return add("IFCLSHAPEPROFILEDEF", area, "$", ref(position), real(p.depth), real(p.width), real(p.thickness), "$", "$", "$");
    case "channel":
      return add("IFCUSHAPEPROFILEDEF", area, "$", ref(position), real(p.depth), real(p.flange_width), real(p.web_thickness), real(p.flange_thickness), "$", "$", "$");
    case "polygon": {
      const pts = p.points.map((q) => point([q[0], q[1]]));
      const curve = add("IFCPOLYLINE", list([...pts, pts[0]].map(ref)));
      return add("IFCARBITRARYCLOSEDPROFILEDEF", area, "$", ref(curve));
    }
  }
}
