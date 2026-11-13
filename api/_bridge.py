"""
A Bridge as an IFC 4.3 model, from allcon's Bridge record (src/lib/design/bridge/ifc.ts builds the
description; this writes it with IfcOpenShell).

The model: the project in feet; the site with the first abutment's northing and easting; IfcBridge
with SUPERSTRUCTURE and SUBSTRUCTURE parts and an ABUTMENT or PIER part for each support; the
alignment (IfcAlignment by the PI method, its horizontal and vertical layouts and a STATION referent)
on the site; and each element as an extruded profile at its placement, with an ALLCON_Design property
set and a material. The description is data: numbers, names and a fixed set of classes; nothing in it
is run.
"""

import math

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.aggregate
import ifcopenshell.guid
import ifcopenshell.api.alignment
import ifcopenshell.api.context
import ifcopenshell.api.project
import ifcopenshell.api.unit
import ifcopenshell.api.geometry
import ifcopenshell.api.material
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.style
import ifcopenshell.api.spatial
import ifcopenshell.util.alignment
import numpy

CLASSES = {"IfcBeam", "IfcBearing", "IfcColumn", "IfcFooting", "IfcPile", "IfcSlab", "IfcWall", "IfcMember", "IfcPlate", "IfcRailing"}
PART_TYPES = {"SUPERSTRUCTURE", "SUBSTRUCTURE", "ABUTMENT", "PIER", "FOUNDATION", "DECK"}
MAX_ELEMENTS = 5000


def _num(v, what):
    if not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError(f"{what} must be a number")
    return float(v)


def _vec(v, what):
    if not isinstance(v, (list, tuple)) or len(v) != 3:
        raise ValueError(f"{what} must be three numbers")
    return [_num(x, what) for x in v]


def _placement(origin, xdir, zdir):
    z = numpy.array(zdir, dtype=float)
    z /= numpy.linalg.norm(z)
    x = numpy.array(xdir, dtype=float)
    x -= z * x.dot(z)  # square to the sweep
    n = numpy.linalg.norm(x)
    if n < 1e-9:
        raise ValueError("an element's x direction runs along its sweep")
    x /= n
    y = numpy.cross(z, x)
    m = numpy.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, origin
    return m


def _profile(model, p):
    kind = p.get("kind")
    if kind == "rect":
        return model.createIfcRectangleProfileDef("AREA", None, None, _num(p["x"], "a width"), _num(p["y"], "a depth"))
    if kind == "circle":
        return model.createIfcCircleProfileDef("AREA", None, None, _num(p["r"], "a radius"))
    if kind == "ishape":
        return model.createIfcIShapeProfileDef(
            "AREA", None, None, _num(p["width"], "a flange width"), _num(p["depth"], "a depth"), _num(p["web"], "a web"), _num(p["flange"], "a flange")
        )
    if kind == "poly":
        pts = [(_num(a, "a point"), _num(b, "a point")) for a, b in p["pts"]]
        if len(pts) < 3:
            raise ValueError("an outline needs three points")
        points = model.createIfcCartesianPointList2D([list(q) for q in pts])
        curve = model.createIfcIndexedPolyCurve(points, None, False)
        # Closed: the last point back to the first.
        curve.Segments = [model.createIfcLineIndex(list(range(1, len(pts) + 1)) + [1])]
        return model.createIfcArbitraryClosedProfileDef("AREA", None, curve)
    raise ValueError(f"unknown profile '{kind}'")


def _mesh(model, p):
    pts = [_vec(v, "a point") for v in p.get("pts") or []]
    tris = p.get("tris") or []
    if len(pts) < 4 or len(tris) < 4:
        raise ValueError("a solid needs four points and four faces")
    index = []
    for t in tris:
        if len(t) != 3 or not all(isinstance(i, int) and 0 <= i < len(pts) for i in t):
            raise ValueError("a face must name three of the points")
        index.append([i + 1 for i in t])
    return model.createIfcTriangulatedFaceSet(model.createIfcCartesianPointList3D(pts), None, True, index, None)


def build(params):
    """The IFC model for a Bridge description (see ifc.ts BridgeIfc). Returns (model, handles)."""
    api = ifcopenshell.api
    elements = params.get("elements") or []
    if len(elements) > MAX_ELEMENTS:
        raise ValueError(f"at most {MAX_ELEMENTS} elements")
    model = api.project.create_file(version="IFC4X3")
    project = api.root.create_entity(model, ifc_class="IfcProject", name=params.get("project") or "Project")
    length = api.unit.add_conversion_based_unit(model, name="foot")
    area = api.unit.add_si_unit(model, unit_type="AREAUNIT")
    volume = api.unit.add_si_unit(model, unit_type="VOLUMEUNIT")
    mass = api.unit.add_si_unit(model, unit_type="MASSUNIT", prefix="KILO")
    api.unit.assign_unit(model, units=[length, area, volume, mass])
    model3d = api.context.add_context(model, context_type="Model")
    body = api.context.add_context(model, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model3d)
    api.context.add_context(model, context_type="Model", context_identifier="Axis", target_view="GRAPH_VIEW", parent=model3d)

    site = api.root.create_entity(model, ifc_class="IfcSite", name="Site")
    api.aggregate.assign_object(model, products=[site], relating_object=project)
    origin = params.get("origin") or {}
    pset = api.pset.add_pset(model, product=site, name="ALLCON_Origin")
    api.pset.edit_pset(
        model,
        pset=pset,
        properties={
            "Northing": _num(origin.get("northing", 0), "the northing"),
            "Easting": _num(origin.get("easting", 0), "the easting"),
            "Note": "The model's (0, 0) is this point in the project's coordinates; z is the elevation.",
        },
    )
    bridge = api.root.create_entity(model, ifc_class="IfcBridge", name=params.get("name") or "Bridge")
    api.aggregate.assign_object(model, products=[bridge], relating_object=site)
    for product in (site, bridge):
        api.geometry.edit_object_placement(model, product=product, matrix=numpy.eye(4), is_si=False)

    # The alignment: the horizontal layout segment by segment (lines, circular arcs, clothoids), the
    # vertical by its PVIs, the start station as a STATION referent.
    al = params.get("alignment") or {}
    segments = al.get("segments") or []
    alignment = None
    if segments:
        vp = [(_num(d, "a PVI"), _num(z, "a PVI")) for d, z in al.get("vpoints") or []]
        lengths = [_num(v, "a curve length") for v in al.get("lengths") or []]
        vertical = len(vp) >= 2
        name = al.get("name") or "Alignment"
        alignment = ifcopenshell.api.alignment.create(model, name, include_vertical=vertical)
        layout = ifcopenshell.api.alignment.get_horizontal_layout(alignment)
        for g in segments:
            if g.get("type") not in ("LINE", "CIRCULARARC", "CLOTHOID"):
                raise ValueError(f"unknown alignment segment '{g.get('type')}'")
            x, y = g["start"]
            params_ = model.createIfcAlignmentHorizontalSegment(
                StartTag=None,
                EndTag=None,
                StartPoint=model.createIfcCartesianPoint((_num(x, "a point"), _num(y, "a point"))),
                StartDirection=_num(g["dir"], "a direction"),
                StartRadiusOfCurvature=_num(g["r0"], "a radius"),
                EndRadiusOfCurvature=_num(g["r1"], "a radius"),
                SegmentLength=_num(g["length"], "a length"),
                GravityCenterLineHeight=None,
                PredefinedType=g["type"],
            )
            ifcopenshell.api.alignment.create_layout_segment(model, layout, params_)
        if vertical:
            ifcopenshell.api.alignment.layout_vertical_alignment_by_pi_method(model, ifcopenshell.api.alignment.get_vertical_layout(alignment), vp, lengths)
        start = _num(al.get("startStation", 0), "the start station")
        ifcopenshell.api.alignment.add_stationing_referent(model, f"{name} {ifcopenshell.util.alignment.station_as_string(model, start)}", alignment, 0.0, start)
        # The alignment belongs to the site; IfcOpenShell may have put it under the project.
        for rel in list(alignment.Decomposes or []):
            if rel.RelatingObject != site:
                api.aggregate.unassign_object(model, products=[alignment])
        if not alignment.Decomposes:
            api.aggregate.assign_object(model, products=[alignment], relating_object=site)

    # The spatial parts.
    parts = {}
    for p in params.get("parts") or []:
        if p.get("type") not in PART_TYPES:
            raise ValueError(f"unknown bridge part '{p.get('type')}'")
        part = api.root.create_entity(model, ifc_class="IfcBridgePart", name=p.get("name"), predefined_type=p["type"])
        parent = parts.get(p.get("parent")) or bridge
        api.aggregate.assign_object(model, products=[part], relating_object=parent)
        api.geometry.edit_object_placement(model, product=part, matrix=numpy.eye(4), is_si=False)
        part.UsageType = "LATERAL" if p["type"] in ("ABUTMENT", "PIER") else "LONGITUDINAL"
        parts[p.get("key")] = part

    materials = {}
    styles = {}
    counts = {}
    rebar = RebarWriter(model, body, project)
    rebar_weight = 0.0
    for e in elements:
        cls = e.get("cls")
        if cls not in CLASSES:
            raise ValueError(f"unknown element class '{cls}'")
        try:
            element = api.root.create_entity(model, ifc_class=cls, name=e.get("name"), predefined_type=e.get("type") or None)
        except Exception:
            # A predefined type the schema doesn't have for this class: USERDEFINED with its name.
            element = api.root.create_entity(model, ifc_class=cls, name=e.get("name"), predefined_type="USERDEFINED")
            if hasattr(element, "ObjectType"):
                element.ObjectType = e.get("type")
        container = parts.get(e.get("part")) or bridge
        api.spatial.assign_container(model, products=[element], relating_structure=container)
        m = _placement(_vec(e["origin"], "an origin"), _vec(e["xdir"], "an x direction"), _vec(e["zdir"], "a direction"))
        api.geometry.edit_object_placement(model, product=element, matrix=m, is_si=False)
        profile = e.get("profile") or {}
        if profile.get("kind") == "mesh":
            rep = model.createIfcShapeRepresentation(body, "Body", "Tessellation", [_mesh(model, profile)])
        else:
            solid = model.createIfcExtrudedAreaSolid(
                _profile(model, profile),
                model.createIfcAxis2Placement3D(model.createIfcCartesianPoint((0.0, 0.0, 0.0))),
                model.createIfcDirection((0.0, 0.0, 1.0)),
                max(1e-3, _num(e.get("depth"), "a depth")),
            )
            rep = model.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])
        api.geometry.assign_representation(model, product=element, representation=rep)
        color = e.get("color")
        if isinstance(color, (list, tuple)) and len(color) == 3:
            key = tuple(round(min(1.0, max(0.0, _num(v, "a colour"))), 3) for v in color)
            if key not in styles:
                style = api.style.add_style(model, name=f"ALLCON {key[0]:.2f} {key[1]:.2f} {key[2]:.2f}")
                api.style.add_surface_style(model, style=style, ifc_class="IfcSurfaceStyleShading", attributes={"SurfaceColour": {"Name": None, "Red": key[0], "Green": key[1], "Blue": key[2]}, "Transparency": 0.0})
                styles[key] = style
            api.style.assign_representation_styles(model, shape_representation=rep, styles=[styles[key]])
        name = str(e.get("material") or "")
        if name:
            if name not in materials:
                materials[name] = api.material.add_material(model, name=name, category="concrete" if "oncrete" in name else "steel" if "Steel" in name else None)
            api.material.assign_material(model, products=[element], material=materials[name])
        for pset_name, props in (e.get("psets") or {}).items():
            if not isinstance(props, dict):
                continue
            ps = api.pset.add_pset(model, product=element, name=str(pset_name)[:60])
            api.pset.edit_pset(model, pset=ps, properties={str(k)[:60]: v for k, v in props.items() if isinstance(v, (str, int, float, bool))})
        for qto in element_quantities(e):
            _add_qto(model, element, qto[0], qto[1])
        if e.get("rebar"):
            totals = rebar.write(element, e["rebar"])
            counts["IfcReinforcingBar"] = counts.get("IfcReinforcingBar", 0) + len(e["rebar"].get("bars") or [])
            rebar_weight += totals[2]
        counts[cls] = counts.get(cls, 0) + 1
    rebar.finish()

    handles = {
        "project": project.id(),
        "site": site.id(),
        "facility": bridge.id(),
        "alignment": alignment.id() if alignment else None,
        "parts": {k: v.id() for k, v in parts.items()},
        "body_context": body.id(),
        "counts": counts,
        "rebar_lb": round(rebar_weight, 1),
    }
    return model, handles


# --- quantities and reinforcing bars ----------------------------------------------------------------------------------
# Every element gets its base quantities (Qto_<Class>BaseQuantities where IFC has one, from its own geometry), and
# an element with bars (ifc-rebar.ts) gets them as IfcReinforcingBar sets aggregated into it: one set per mark, typed
# by an IfcReinforcingBarType that holds the bending shape (a disk swept along its centreline), with
# Qto_ReinforcingElementBaseQuantities and the schedule's row (ALLCON_BarSchedule). Only entities and quantity sets
# that IFC4 and IFC 4.3 both have are used, so the same code writes either.
#
# Units: lengths in the model's length unit (ft), areas in m², volumes in m³, weights in kg (the model's units).

FT = 0.3048
FT2 = FT * FT
FT3 = FT * FT * FT
LB = 0.45359237
IN2 = 0.0254 * 0.0254
STEEL_KG_M3 = 7850.0
BAR_ROLES = {"MAIN", "SHEAR", "LIGATURE", "RING", "ANCHORING"}
MAX_DRAWN = 400
QTO = {
    "IfcBeam": "Qto_BeamBaseQuantities",
    "IfcColumn": "Qto_ColumnBaseQuantities",
    "IfcSlab": "Qto_SlabBaseQuantities",
    "IfcFooting": "Qto_FootingBaseQuantities",
    "IfcPile": "Qto_PileBaseQuantities",
    "IfcWall": "Qto_WallBaseQuantities",
}


def _section(p):
    """A profile's area (ft²), perimeter (ft) and extents (ft)."""
    kind = p.get("kind")
    if kind == "rect":
        x, y = _num(p["x"], "a width"), _num(p["y"], "a depth")
        return x * y, 2 * (x + y), (x, y)
    if kind == "circle":
        r = _num(p["r"], "a radius")
        return math.pi * r * r, 2 * math.pi * r, (2 * r, 2 * r)
    if kind == "ishape":
        w, d, tw, tf = (_num(p[k], "an I shape") for k in ("width", "depth", "web", "flange"))
        return 2 * w * tf + (d - 2 * tf) * tw, 4 * w + 2 * d - 2 * tw, (w, d)
    if kind == "poly":
        pts = [(_num(a, "a point"), _num(b, "a point")) for a, b in p["pts"]]
        n = len(pts)
        area = abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2
        per = sum(math.dist(pts[i], pts[(i + 1) % n]) for i in range(n))
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        return area, per, (max(xs) - min(xs), max(ys) - min(ys))
    return None


def _mesh_measures(p):
    """A closed mesh's volume (ft³) and surface area (ft²)."""
    pts = numpy.array(p["pts"], dtype=float)
    tri = numpy.array(p["tris"], dtype=int)
    a, b, c = pts[tri[:, 0]], pts[tri[:, 1]], pts[tri[:, 2]]
    vol = float(numpy.einsum("ij,ij->i", a, numpy.cross(b, c)).sum() / 6)
    surf = float(numpy.linalg.norm(numpy.cross(b - a, c - a), axis=1).sum() / 2)
    return abs(vol), surf


def _add_qto(model, product, name, quantities, method="BaseQuantities"):
    """An IfcElementQuantity of (kind, name, value) on a product; kind: length, area, volume, count or weight."""
    make = {
        "length": model.createIfcQuantityLength,
        "area": model.createIfcQuantityArea,
        "volume": model.createIfcQuantityVolume,
        "count": model.createIfcQuantityCount,
        "weight": model.createIfcQuantityWeight,
    }
    items = [make[k](n, None, None, int(round(v)) if k == "count" else float(v)) for k, n, v in quantities if v is not None and math.isfinite(v) and v >= 0]
    if not items:
        return None
    qto = ifcopenshell.api.pset.add_qto(model, product=product, name=name)
    qto.MethodOfMeasurement = method
    qto.Quantities = items
    return qto


def element_quantities(e):
    """An element's base quantity sets from its description: [(set name, [(kind, name, value)])]; ft lengths, SI areas, volumes and weights."""
    sets = _base_quantities(e)
    if e.get("cls") == "IfcRailing" and isinstance(e.get("length"), (int, float)):
        # IFC's railing set has only its length; its volume and the rest stay in ALLCON's set.
        return [("Qto_RailingBaseQuantities", [("length", "Length", _num(e["length"], "a length"))])] + sets
    return sets


def _base_quantities(e):
    out = _measures(e)
    return [out] if out else []


def _measures(e):
    cls = e.get("cls")
    p = e.get("profile") or {}
    L = _num(e.get("depth"), "a depth")
    steel = "steel" in str(e.get("material") or "").lower()
    name = QTO.get(cls) or "ALLCON_BaseQuantities"
    if p.get("kind") == "mesh":
        vol, surf = _mesh_measures(p)
        q = [("volume", "GrossVolume", vol * FT3), ("volume", "NetVolume", vol * FT3)]
        if cls == "IfcSlab":
            q = [("length", "Width", L), ("area", "GrossArea", vol / L * FT2), ("area", "NetArea", vol / L * FT2)] + q
        elif cls in ("IfcBeam", "IfcColumn", "IfcFooting", "IfcPile"):
            q = [("area", "GrossSurfaceArea", surf * FT2)] + q
        if steel:
            q.append(("weight", "NetWeight", vol * FT3 * STEEL_KG_M3))
        return name, q
    s = _section(p)
    if not s:
        return None
    A, P, (bx, by) = s
    vol = A * L * FT3
    common = [("volume", "GrossVolume", vol), ("volume", "NetVolume", vol)]
    weight = [("weight", "GrossWeight", vol * STEEL_KG_M3), ("weight", "NetWeight", vol * STEEL_KG_M3)] if steel else []
    if cls == "IfcSlab":
        q = [("length", "Width", L), ("length", "Length", bx), ("length", "Depth", by), ("length", "Perimeter", P), ("area", "GrossArea", A * FT2), ("area", "NetArea", A * FT2)] + common
    elif cls == "IfcFooting":
        q = [("length", "Length", bx), ("length", "Width", by), ("length", "Height", L), ("area", "CrossSectionArea", A * FT2), ("area", "OuterSurfaceArea", P * L * FT2), ("area", "GrossSurfaceArea", (P * L + 2 * A) * FT2)] + common
    elif cls == "IfcWall":
        q = [("length", "Length", bx), ("length", "Width", by), ("length", "Height", L), ("area", "GrossSideArea", bx * L * FT2), ("area", "NetSideArea", bx * L * FT2)] + common
    elif cls in ("IfcBeam", "IfcColumn", "IfcPile"):
        q = [("length", "Length", L), ("area", "CrossSectionArea", A * FT2), ("area", "OuterSurfaceArea", P * L * FT2), ("area", "GrossSurfaceArea", (P * L + 2 * A) * FT2)]
        if cls != "IfcPile":
            q.append(("area", "NetSurfaceArea", (P * L + 2 * A) * FT2))
        q += common + weight
    else:
        q = [("length", "Length", L), ("area", "CrossSectionArea", A * FT2)] + common + weight
    return name, q


def _ft_in(inches):
    ft = int(inches // 12)
    return f"{ft}'-{round(inches - 12 * ft, 2):g}\""


class RebarWriter:
    """Writes bar sets into a model: a type for each distinct bar (size, shape, dimensions, role), one IfcRelDefinesByType per type."""

    def __init__(self, model, body, project=None):
        self.model = model
        self.body = body
        self.project = project
        self.types = {}  # signature -> (type, representation map)
        self.typed = {}  # type id -> (type, [bars])
        self.material = None

    def _dir(self, v):
        v = numpy.array(v, dtype=float)
        n = numpy.linalg.norm(v)
        if n < 1e-9:
            raise ValueError("a bar's direction is zero")
        return self.model.createIfcDirection([float(x) for x in v / n])

    def _type(self, b, path, role):
        m = self.model
        dims = tuple(round(_num(x, "a bar dimension"), 3) for x in (b.get("dims") or []))
        sig = (int(_num(b["size"], "a bar size")), str(b.get("shape") or ""), dims, role)
        if sig in self.types:
            return self.types[sig]
        d_ft = _num(b["diameter"], "a bar diameter") / 12
        name = f"#{sig[0]} {sig[1]} {' + '.join(_ft_in(x) for x in dims)}".strip()
        t = ifcopenshell.api.root.create_entity(m, ifc_class="IfcReinforcingBarType", name=name[:255], predefined_type=role)
        t.NominalDiameter = d_ft
        t.CrossSectionArea = _num(b["area"], "a bar area") * IN2
        t.BarLength = _num(b["length"], "a bar length") / 12
        t.BarSurface = "TEXTURED"
        t.BendingShapeCode = sig[1] or None
        if dims:
            t.BendingParameters = [m.create_entity("IfcLengthMeasure", x / 12) for x in dims]
        # Its shape: a disk the bar's diameter swept along its centreline, in the type's own x–y plane.
        line = m.createIfcPolyline([m.createIfcCartesianPoint((x, y, 0.0)) for x, y in path])
        solid = m.createIfcSweptDiskSolid(line, d_ft / 2, None, None, None)
        rep = m.createIfcShapeRepresentation(self.body, "Body", "AdvancedSweptSolid", [solid])
        rmap = m.createIfcRepresentationMap(m.createIfcAxis2Placement3D(m.createIfcCartesianPoint((0.0, 0.0, 0.0))), rep)
        t.RepresentationMaps = [rmap]
        if self.project is not None and not t.HasContext:
            ifcopenshell.api.project.assign_declaration(m, definitions=[t], relating_context=self.project)
        self.types[sig] = (t, rmap)
        return self.types[sig]

    def write(self, host, rebar):
        """The bar sets of `rebar` (ifc-rebar.ts IfcRebar) aggregated into `host`; returns their totals [count, ft, lb]."""
        m = self.model
        api = ifcopenshell.api
        made = []
        totals = [0, 0.0, 0.0]
        rows = {}
        if self.material is None:
            self.material = api.material.add_material(m, name="Reinforcing steel (ASTM A615)", category="steel")
        for b in rebar.get("bars") or []:
            role = b.get("role") if b.get("role") in BAR_ROLES else "MAIN"
            path = [(_num(x, "a bar point"), _num(y, "a bar point")) for x, y in (b.get("path") or [])][:50]
            if len(path) < 2:
                raise ValueError("a bar needs two points")
            count = int(_num(b["count"], "a bar count"))
            length = _num(b["length"], "a bar length")  # in, each bar
            weight = _num(b["weight"], "a bar weight")  # lb, the set
            t, rmap = self._type(b, path, role)
            mark = str(b.get("mark") or "")[:20]
            bar = api.root.create_entity(m, ifc_class="IfcReinforcingBar", name=f"{mark} {b.get('callout') or ''}".strip()[:255], predefined_type=role)
            bar.Tag = mark
            bar.ObjectType = str(b.get("use") or "")[:255] or None
            # IFC4 keeps these (optional) on the occurrence too; set for viewers that read them there.
            bar.NominalDiameter = t.NominalDiameter
            bar.CrossSectionArea = t.CrossSectionArea
            bar.BarLength = length / 12
            bar.BarSurface = "TEXTURED"
            self.typed.setdefault(t.id(), (t, []))[1].append(bar)
            at = b.get("at") or {}
            o, u, v, step = (numpy.array(_vec(at.get(k), "a bar frame")) for k in ("origin", "u", "v", "step"))
            drawn = max(1, min(int(_num(at.get("drawn", 1), "a bar count")), MAX_DRAWN, count))
            items = [
                m.createIfcMappedItem(rmap, m.createIfcCartesianTransformationOperator3D(self._dir(u), self._dir(v), m.createIfcCartesianPoint([float(x) for x in o + i * step]), 1.0, self._dir(numpy.cross(u, v))))
                for i in range(drawn)
            ]
            made.append((bar, m.createIfcShapeRepresentation(self.body, "Body", "MappedRepresentation", items)))
            _add_qto(m, bar, "Qto_ReinforcingElementBaseQuantities", [("count", "Count", count), ("length", "Length", count * length / 12), ("weight", "Weight", weight * LB)])
            dims = [_num(x, "a dimension") for x in (b.get("dims") or [])]
            shape = str(b.get("shape") or "")
            props = {
                "Mark": mark,
                "Size": f"#{int(_num(b['size'], 'a bar size'))}",
                "NominalDiameter_in": round(_num(b["diameter"], "a diameter"), 3),
                "Count": count,
                "LengthEach": _ft_in(length),
                "LengthEach_ft": round(length / 12, 3),
                "TotalLength_ft": round(count * length / 12, 2),
                "Weight_lb": round(weight, 1),
                "Shape": shape,
                "BendingDimensions": " + ".join(_ft_in(x) for x in dims),
                "Use": str(b.get("use") or "")[:255],
                "Callout": str(b.get("callout") or "")[:255],
                "Placement": ("Schematic: laid out inside its host; size, shape, count and length are the design's" + (f" ({drawn} of {count} drawn)" if drawn < count else ""))[:255],
            }
            ps = api.pset.add_pset(m, product=bar, name="ALLCON_BarSchedule")
            api.pset.edit_pset(m, pset=ps, properties=props)
            rows[f"Mark {mark}"] = f"{props['Size']} x {count}, {props['LengthEach']} each, {props['Weight_lb']} lb ({shape})"[:255]
            totals[0] += count
            totals[1] += count * length / 12
            totals[2] += weight
        if not made:
            return totals
        api.aggregate.assign_object(m, products=[bar for bar, _ in made], relating_object=host)
        for bar, rep in made:
            api.geometry.edit_object_placement(m, product=bar, matrix=numpy.eye(4), is_si=False)
            api.geometry.assign_representation(m, product=bar, representation=rep)
        api.material.assign_material(m, products=[bar for bar, _ in made], material=self.material)
        # The host: its bars' totals as quantities, and the schedule's rows where a viewer shows them.
        _add_qto(m, host, "ALLCON_Reinforcement", [("count", "BarCount", totals[0]), ("length", "BarLength", totals[1]), ("weight", "BarWeight", totals[2] * LB)], method="ALLCON bar schedule")
        ps = api.pset.add_pset(m, product=host, name="ALLCON_BarSchedule")
        api.pset.edit_pset(m, pset=ps, properties={"DesignKind": str(rebar.get("designKind") or ""), "DesignId": str(rebar.get("designId") or ""), "Marks": len(made), "BarCount": totals[0], "TotalLength_ft": round(totals[1], 1), "TotalWeight_lb": round(totals[2], 1), **rows})
        return totals

    def finish(self):
        for t, bars in self.typed.values():
            self.model.createIfcRelDefinesByType(ifcopenshell.guid.new(), None, None, None, bars, t)
        self.typed = {}
