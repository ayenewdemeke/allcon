"""
IfcOpenShell worker for allcon's 3D models.

allcon's Next.js server calls this function (never browsers or AI apps directly). An AI app
edits a model through allcon's connector as lists of ifcopenshell.api calls from a whitelist;
no code sent to this worker is ever executed. Each request carries signed links: one to read
the model from file storage and, for changes, one to write the result, so models of any size
pass straight between storage and the worker, which keeps no state.

It also converts drafting drawings to and from DXF (api/_dxf.py, with ezdxf), the same way:
read from and written to file storage through signed links.

Deployed as a Vercel Python function at /api/ifc. Locally: python api/ifc.py (port 5328).
"""

import collections
import gzip
import hashlib
import hmac
import importlib
import inspect
import json
import math
import os
import re
import ssl
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.aggregate
import ifcopenshell.api.attribute
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.georeference
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.unit
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.geolocation
import ifcopenshell.util.placement
import ifcopenshell.util.selector
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import numpy
from pyproj import CRS, Geod, Transformer

try:  # trusted certificates for file storage links, the same on every machine
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

# Modules an AI app may call. Left out: anything that reads or writes files or other
# documents (project, library, document, drawing) and admin-style modules.
ALLOWED_MODULES = {
    "aggregate", "alignment", "attribute", "classification", "context", "cost", "feature",
    "geometry", "georeference", "grid", "group", "layer", "material", "nest", "profile",
    "pset", "root", "sequence", "spatial", "style", "system", "type", "unit",
}
MAX_OPERATIONS = 500
MAX_RESULTS = 300


def expected_token():
    secret = os.environ.get("BETTER_AUTH_SECRET", "")
    return hmac.new(secret.encode(), b"conkit-ifc-worker", hashlib.sha256).hexdigest() if secret else None


# --- model in and out -------------------------------------------------------------------


def load(payload):
    """The model to work on, read from file storage through the signed link allcon sends."""
    with urllib.request.urlopen(payload["ifc_url"], timeout=60, context=SSL_CONTEXT) as res:
        data = res.read()
    if data[:2] == b"\x1f\x8b":  # stored gzipped
        data = gzip.decompress(data)
    return ifcopenshell.file.from_string(data.decode("utf-8"))


def dump(model, payload):
    """Writes the changed model to file storage (gzipped) through the signed link allcon sends."""
    data = gzip.compress(model.to_string().encode("utf-8"))
    target = payload.get("put") or {}
    request = urllib.request.Request(target["url"], data=data, method="PUT", headers=target.get("headers") or {})
    with urllib.request.urlopen(request, timeout=60, context=SSL_CONTEXT) as res:
        if res.status >= 300:
            raise RuntimeError(f"Could not save the model (HTTP {res.status})")
    return len(data)


def fetch(url):
    """A file from storage through a signed link, unzipped if stored gzipped."""
    with urllib.request.urlopen(url, timeout=60, context=SSL_CONTEXT) as res:
        data = res.read()
    return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data


def store(payload, data):
    """Writes bytes to file storage through the signed link allcon sends."""
    target = payload.get("put") or {}
    request = urllib.request.Request(target["url"], data=data, method="PUT", headers=target.get("headers") or {})
    with urllib.request.urlopen(request, timeout=60, context=SSL_CONTEXT) as res:
        if res.status >= 300:
            raise RuntimeError(f"Could not save the file (HTTP {res.status})")
    return len(data)


def dxf_module():
    # Next to this file; loaded only for DXF work, so 3D model requests don't pay for it.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import _dxf

    return _dxf


def dxf_export(payload, params):
    drawing = json.loads(fetch(payload["drawing_url"]))
    data, skipped = dxf_module().export_dxf(drawing, params.get("fileName") or "")
    return {"size": store(payload, data), "skipped": skipped}


def dxf_import(payload, params):
    drawing, skipped = dxf_module().import_dxf(fetch(payload["dxf_url"]), params.get("units"))
    size = store(payload, gzip.compress(json.dumps(drawing, separators=(",", ":")).encode("utf-8")))
    return {"size": size, "units": drawing["units"], "count": len(drawing["entities"]), "skipped": skipped}


def describe(entity):
    info = {"id": entity.id(), "type": entity.is_a()}
    name = getattr(entity, "Name", None) if entity.is_entity() else None
    if name:
        info["name"] = name
    return info


def to_json(value):
    if isinstance(value, ifcopenshell.entity_instance):
        return describe(value)
    if isinstance(value, numpy.ndarray):
        return numpy.round(value, 6).tolist()
    if isinstance(value, (list, tuple, set)):
        return [to_json(v) for v in value]
    if isinstance(value, dict):
        return {str(k): to_json(v) for k, v in value.items()}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


# --- operations -------------------------------------------------------------------------


def resolve(model, value, named, key=None):
    """'#123' is an entity by id; '$name' is a result named earlier in the same request."""
    if isinstance(value, str):
        if value.startswith("#") and value[1:].isdigit():
            return model.by_id(int(value[1:]))
        if value.startswith("$") and value[1:] in named:
            return named[value[1:]]
        return value
    if isinstance(value, list):
        items = [resolve(model, v, named) for v in value]
        if key == "matrix":
            return numpy.array(items, dtype=float)
        return items
    if isinstance(value, dict):
        return {k: resolve(model, v, named, k) for k, v in value.items()}
    return value


def matrix(location=(0, 0, 0), x_axis=(1, 0, 0), z_axis=(0, 0, 1), rotation_z=None):
    """4x4 placement matrix from a location and axes (or a rotation about z, in degrees)."""
    if rotation_z is not None:
        a = numpy.radians(rotation_z)
        x_axis, z_axis = (numpy.cos(a), numpy.sin(a), 0), (0, 0, 1)
    z = numpy.array(z_axis, dtype=float)
    z /= numpy.linalg.norm(z)
    x = numpy.array(x_axis, dtype=float)
    x -= z * numpy.dot(x, z)
    x /= numpy.linalg.norm(x)
    y = numpy.cross(z, x)
    m = numpy.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, location
    return m


def run_operations(model, operations):
    if len(operations) > MAX_OPERATIONS:
        raise ValueError(f"At most {MAX_OPERATIONS} operations per request")
    named, results = {}, []
    for index, op in enumerate(operations):
        name = op.get("op", "")
        try:
            args = resolve(model, op.get("args", {}) or {}, named)
            if name == "conkit.matrix":
                result = matrix(**args)
            else:
                module_name, _, fn_name = name.partition(".")
                if module_name not in ALLOWED_MODULES or not fn_name or fn_name.startswith("_"):
                    raise ValueError(f"'{name}' isn't an allowed operation")
                module = importlib.import_module(f"ifcopenshell.api.{module_name}")
                fn = getattr(module, fn_name, None)
                if not inspect.isfunction(fn) or fn_name == "wrap_usecases":
                    raise ValueError(f"'{name}' isn't an ifcopenshell.api function")
                result = fn(model, **args)
        except Exception as error:  # report which operation failed; nothing is saved
            raise ValueError(f"Operation {index} ({name}) failed: {type(error).__name__}: {error}") from error
        if op.get("as"):
            named[op["as"]] = result
        results.append({"op": name, "as": op.get("as"), "result": to_json(result)})
    return results


# --- reading ----------------------------------------------------------------------------


LOD_LEVELS = ("100", "200", "300", "350")
# Classes whose many same-named pieces are usually parts of something bigger.
GROUPABLE = {"IfcMember", "IfcPlate", "IfcSlab", "IfcCovering", "IfcFurniture", "IfcFurnishingElement", "IfcBuildingElementPart", "IfcBuildingElementProxy"}
CEILING_NAME = re.compile(r"ceiling|soffit|bulkhead", re.IGNORECASE)
MAX_LOD_FOR_BASIS = {"dimensioned": "350", "scaled": "200", "assumed": "200"}
# Classes IFC4 and later deprecate, with what to use instead.
DEPRECATED = {
    "IfcFurnishingElement": "IfcFurniture (or another specific class)",
    "IfcWallStandardCase": "IfcWall",
    "IfcSlabStandardCase": "IfcSlab",
    "IfcBeamStandardCase": "IfcBeam",
    "IfcColumnStandardCase": "IfcColumn",
    "IfcMemberStandardCase": "IfcMember",
    "IfcPlateStandardCase": "IfcPlate",
    "IfcDoorStandardCase": "IfcDoor",
    "IfcWindowStandardCase": "IfcWindow",
    "IfcOpeningStandardCase": "IfcOpeningElement",
}


def plural(n, one, many=None):
    return f"{n} {one if n == 1 else (many or one + 's')}"


def organization_warnings(model, elements):
    """How well the model is organized: what makes it hard to browse or to use in other tools."""
    warnings = []
    scale = ifcopenshell.util.unit.calculate_unit_scale(model)  # model length unit -> metres
    storeys = sorted(
        (s for s in model.by_type("IfcBuildingStorey") if s.Elevation is not None), key=lambda s: s.Elevation
    )
    for storey in model.by_type("IfcBuildingStorey"):
        if CEILING_NAME.search(storey.Name or ""):
            warnings.append(
                f"Storey '{storey.Name}' looks like a ceiling, not a floor: storeys are floors people stand on; "
                "contain ceilings in the floor below, at their height"
            )
    for low, high in zip(storeys, storeys[1:]):
        gap = (high.Elevation - low.Elevation) * scale
        if 0 < gap < 2 and not (CEILING_NAME.search(low.Name or "") or CEILING_NAME.search(high.Name or "")):
            warnings.append(
                f"Storeys '{low.Name}' and '{high.Name}' are only {round(high.Elevation - low.Elevation, 2)} apart: "
                "storeys are floors people stand on; contain ceilings and similar in the floor below"
            )
    proxies = [e for e in elements if e.is_a("IfcBuildingElementProxy")]
    if proxies:
        warnings.append(f"{plural(len(proxies), 'generic proxy element')} (IfcBuildingElementProxy): use a specific class where one fits")
    for cls, instead in DEPRECATED.items():
        n = len([e for e in elements if e.is_a() == cls])
        if n:
            warnings.append(f"{plural(n, cls)} {'uses' if n == 1 else 'use'} a class IFC deprecates: use {instead}")
    unnamed = [s for s in model.by_type("IfcSpace") if not getattr(s, "LongName", None)]
    if unnamed:
        warnings.append(f"{plural(len(unnamed), 'room')} without a LongName: put the room number in Name and the room name in LongName")
    loose = [
        e for e in elements
        if not ifcopenshell.util.element.get_container(e) and not ifcopenshell.util.element.get_aggregate(e)
        and not (e.is_a("IfcFeatureElement") or getattr(e, "FillsVoids", None))
    ]
    if loose:
        warnings.append(f"{plural(len(loose), 'element')} not placed in a storey (or part of an assembly): use spatial.assign_container")
    in_facility = [e for e in elements if (c := ifcopenshell.util.element.get_container(e)) and not c.is_a("IfcBuildingStorey") and not c.is_a("IfcSpace")]
    if in_facility and storeys:
        warnings.append(f"{plural(len(in_facility), 'element')} contained in the building or site rather than a storey: put each in its storey")
    for storey in storeys:
        if not CEILING_NAME.search(storey.Name or "") and not ifcopenshell.util.element.get_decomposition(storey):
            warnings.append(f"Storey '{storey.Name}' is empty: remove it, or it's probably a height rather than a floor")
    # Many loose parts with the same name are usually one assembly in pieces (rack shelves,
    # roof strips, ladder rungs): grouped under their assembly, the model reads far better.
    loose_parts = collections.Counter(
        (e.is_a(), re.sub(r"\d+", "#", e.Name or ""))
        for e in elements
        if not ifcopenshell.util.element.get_aggregate(e) and e.is_a() in GROUPABLE
    )
    repeated = [(cls, name, n) for (cls, name), n in loose_parts.most_common() if n >= 10]
    for cls, name, n in repeated[:6]:
        warnings.append(f"{n} separate {cls} named like '{name}': if they're parts of assemblies, group them under each assembly (aggregate.assign_object)")
    if len(repeated) > 6:
        warnings.append(f"{len(repeated) - 6} more groups of 10 or more same-named parts are listed separately")
    return warnings


def lod_summary(model, elements):
    project = model.by_type("IfcProject")
    target = None
    if project:
        target = (ifcopenshell.util.element.get_psets(project[0]).get("Pset_Conkit") or {}).get("TargetLOD")
    target = target if target in LOD_LEVELS else None
    by_level, unset, below, overclaimed = {}, 0, 0, 0
    for e in elements:
        pset = ifcopenshell.util.element.get_psets(e).get("Pset_Conkit") or {}
        lod, basis = str(pset.get("LOD") or ""), pset.get("Basis")
        if lod not in LOD_LEVELS:
            unset += 1
            continue
        by_level[lod] = by_level.get(lod, 0) + 1
        if target and int(lod) < int(target):
            below += 1
        if basis in MAX_LOD_FOR_BASIS and int(lod) > int(MAX_LOD_FOR_BASIS[basis]):
            overclaimed += 1
    warnings = []
    if target and unset:
        warnings.append(f"{plural(unset, 'element')} without an LOD (Pset_Conkit.LOD)")
    if below:
        warnings.append(f"{plural(below, 'element')} below the target LOD {target}")
    if overclaimed:
        verb = "claims a higher LOD than its" if overclaimed == 1 else "claim a higher LOD than their"
        warnings.append(f"{plural(overclaimed, 'element')} {verb} basis allows (scaled or assumed geometry is at most LOD 200)")
    return {"target": target, "byLevel": by_level, "unset": unset}, warnings


def summary(model):
    counts = {}
    elements = []
    for product in model.by_type("IfcProduct"):
        if product.is_a("IfcOpeningElement") or product.is_a("IfcSpatialStructureElement") or product.is_a("IfcSpatialElement"):
            continue
        if product.is_a("IfcElement"):
            elements.append(product)
        counts[product.is_a()] = counts.get(product.is_a(), 0) + 1
    spatial = [
        {"id": s.id(), "type": s.is_a(), "name": s.Name, "longName": getattr(s, "LongName", None), "elevation": getattr(s, "Elevation", None)}
        for s in model.by_type("IfcSpatialElement")
    ][:200]
    contexts = [{"id": c.id(), "identifier": c.ContextIdentifier, "type": c.ContextType} for c in model.by_type("IfcGeometricRepresentationContext")]
    lod, lod_warnings = lod_summary(model, elements)
    return {
        "schema": model.schema_identifier,
        "elements": sum(counts.values()),
        "byClass": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "spatial": spatial,
        "contexts": contexts,
        "openings": len(model.by_type("IfcOpeningElement")),
        "lod": lod,
        "warnings": (organization_warnings(model, elements) + lod_warnings)[:30],
        "georef": georef(model),
    }


# --- where the model sits on Earth ---------------------------------------------------------

WGS84 = Geod(ellps="WGS84")


def epsg_code(name):
    match = re.fullmatch(r"\s*(?:EPSG\s*:?\s*)?(\d{4,6})\s*", str(name or ""), re.IGNORECASE)
    return int(match.group(1)) if match else None


def georef(model):
    """Where the model sits on Earth: the latitude and longitude of a point on it (its anchor),
    and which way its Y axis (project north) points there. From its map conversion, else its
    site's latitude and longitude. None when it doesn't say."""
    try:
        return map_georef(model) or site_georef(model)
    except Exception:  # odd georeferencing never stops the summary
        return None


def site_origin(model):
    """The site's origin in the model's coordinates (project units), if it has one."""
    for site in model.by_type("IfcSite"):
        if site.ObjectPlacement:
            return ifcopenshell.util.placement.get_local_placement(site.ObjectPlacement)[:3, 3]
    return None


def anchor_point(model):
    """A point on the model (project units) to read its georeferencing at. Usually the origin,
    but models exported in shared coordinates (Revit) sit far from it, at their survey
    coordinates: then the site's origin (the base point) when the model is around it, else the
    middle of its elements."""
    scale = ifcopenshell.util.unit.calculate_unit_scale(model)
    elements = model.by_type("IfcElement")
    step = max(1, len(elements) // 500)
    points = [ifcopenshell.util.placement.get_local_placement(e.ObjectPlacement)[:3, 3] for e in elements[::step] if e.ObjectPlacement]
    if not points:
        return numpy.zeros(3)
    middle = numpy.median(numpy.array(points), axis=0)
    if math.hypot(middle[0], middle[1]) * scale < 1000:
        return numpy.zeros(3)
    site = site_origin(model)
    if site is not None and math.hypot(*(site[:2] - middle[:2])) * scale < 2000:
        return site
    storeys = [ifcopenshell.util.placement.get_local_placement(s.ObjectPlacement)[2, 3] for s in model.by_type("IfcBuildingStorey") if s.ObjectPlacement]
    return numpy.array([middle[0], middle[1], min(storeys) if storeys else 0.0])


def map_georef(model):
    params = ifcopenshell.util.geolocation.get_helmert_transformation_parameters(model)
    code = epsg_code((ifcopenshell.util.geolocation.get_crs(model) or {}).get("Name"))
    if not params or not code:
        return None
    crs = CRS.from_epsg(code)
    to_wgs84 = Transformer.from_crs(crs, 4326, always_xy=True)
    xaa, xao = (params.xaa, params.xao) if params.xaa or params.xao else (1.0, 0.0)
    length = math.hypot(xaa, xao)
    xaa, xao = xaa / length, xao / length

    def to_map(x, y):  # local coordinates (project units) to map coordinates (map units)
        return params.e + params.scale * (xaa * x - xao * y), params.n + params.scale * (xao * x + xaa * y)

    ax, ay, az = anchor_point(model)
    lon, lat = to_wgs84.transform(*to_map(ax, ay))
    lon_y, lat_y = to_wgs84.transform(*to_map(ax, ay + 100 / params.scale))
    heading = WGS84.inv(lon, lat, lon_y, lat_y)[0]
    map_unit = crs.axis_info[0].unit_conversion_factor if crs.axis_info else 1.0
    return {
        "lat": round(lat, 8),
        "lon": round(lon, 8),
        "heading": round(heading, 3) % 360,
        "height": round(float(params.h + params.scale * az) * map_unit, 3),
        "crs": f"EPSG:{code}",
        "source": "map",
        "anchor": anchor_metres(model, (ax, ay, az)),
    }


def anchor_metres(model, point):
    scale = ifcopenshell.util.unit.calculate_unit_scale(model)
    return [round(float(v) * scale, 4) for v in point]


def site_georef(model):
    def degrees(parts):
        parts = list(parts) + [0] * (4 - len(parts))
        return parts[0] + parts[1] / 60 + parts[2] / 3600 + parts[3] / 3.6e9

    for site in model.by_type("IfcSite"):
        if not site.RefLatitude or not site.RefLongitude:
            continue
        lat, lon = degrees(site.RefLatitude), degrees(site.RefLongitude)
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            continue
        # True north is given anticlockwise from the Y axis, so the Y axis is that far clockwise from it.
        heading = ifcopenshell.util.geolocation.get_true_north(model)
        elevation = (site.RefElevation or 0) * ifcopenshell.util.unit.calculate_unit_scale(model)
        # The latitude and longitude are the site's origin.
        origin = site_origin(model)
        return {
            "lat": round(lat, 8),
            "lon": round(lon, 8),
            "heading": round(heading, 3) % 360,
            "height": round(elevation, 3),
            "crs": None,
            "source": "site",
            "anchor": anchor_metres(model, origin if origin is not None else (0, 0, 0)),
        }
    return None


def set_location(model, site, lat, lon, heading=0.0):
    """Pins a new model's origin to a place, its Y axis `heading` degrees clockwise from true
    north: the site's latitude and longitude and, from IFC4, a map conversion to the place's
    UTM zone."""
    dms = lambda dd: list(ifcopenshell.util.geolocation.dd2dms(dd, use_us=True))
    ifcopenshell.api.attribute.edit_attributes(model, product=site, attributes={"RefLatitude": dms(lat), "RefLongitude": dms(lon)})
    if heading:
        ifcopenshell.api.georeference.edit_true_north(model, true_north=heading)
    if model.schema == "IFC2X3":
        return
    code = (32600 if lat >= 0 else 32700) + min(int((lon + 180) // 6) + 1, 60)
    to_utm = Transformer.from_crs(4326, code, always_xy=True)
    e, n = to_utm.transform(lon, lat)
    # Grid north and true north differ away from the zone's central meridian: the Y axis is
    # turned from grid north by both that and the heading.
    e_north, n_north = to_utm.transform(lon, lat + 0.001)
    angle = math.atan2(e_north - e, n_north - n) + math.radians(heading)
    ifcopenshell.api.georeference.add_georeferencing(model, name=f"EPSG:{code}")
    ifcopenshell.api.georeference.edit_georeferencing(
        model,
        projected_crs={"Name": f"EPSG:{code}", "Description": CRS.from_epsg(code).name},
        coordinate_operation={
            "Eastings": round(e, 4),
            "Northings": round(n, 4),
            "OrthogonalHeight": 0.0,
            "XAxisAbscissa": math.cos(angle),
            "XAxisOrdinate": -math.sin(angle),
            "Scale": ifcopenshell.util.unit.calculate_unit_scale(model),
        },
    )


# --- elements for mapping to the SOV / BoQ ---------------------------------------------

# Categories named as in Revit, so allcon's mapping suggestions apply to these elements too.
REVIT_CATEGORY = {
    "IfcWall": "Walls", "IfcWallStandardCase": "Walls", "IfcCurtainWall": "Curtain Walls",
    "IfcSlab": "Floors", "IfcRoof": "Roofs", "IfcBeam": "Structural Framing",
    "IfcColumn": "Structural Columns", "IfcFooting": "Structural Foundations", "IfcPile": "Structural Foundations",
    "IfcDoor": "Doors", "IfcWindow": "Windows", "IfcRailing": "Railings", "IfcStair": "Stairs",
    "IfcStairFlight": "Stairs", "IfcRamp": "Ramps", "IfcRampFlight": "Ramps", "IfcFurniture": "Furniture",
    "IfcFurnishingElement": "Furniture", "IfcSanitaryTerminal": "Plumbing Fixtures",
    "IfcLightFixture": "Lighting Fixtures", "IfcAirTerminal": "Air Terminals",
    "IfcBuildingElementProxy": "Generic Models", "IfcPlate": "Plates", "IfcMember": "Members",
}
BY_PREDEFINED = {
    ("IfcSlab", "ROOF"): "Roofs", ("IfcSlab", "LANDING"): "Stairs", ("IfcCovering", "CEILING"): "Ceilings",
    ("IfcCovering", "FLOORING"): "Floor Finishes", ("IfcCovering", "CLADDING"): "Wall Finishes",
    ("IfcCovering", "ROOFING"): "Roofs", ("IfcCovering", "MEMBRANE"): "Roofs", ("IfcCovering", "INSULATION"): "Insulation",
    ("IfcMember", "MULLION"): "Curtain Wall Mullions", ("IfcPlate", "CURTAIN_PANEL"): "Curtain Panels",
    ("IfcBeam", "LINTEL"): "Structural Framing", ("IfcMember", "BRACE"): "Structural Framing",
}
QTO_VOLUME = ("NetVolume", "GrossVolume", "Volume")
QTO_AREA = ("NetSideArea", "GrossSideArea", "NetArea", "GrossArea", "NetFootprintArea", "GrossFootprintArea", "NetSurfaceArea", "Area")
QTO_LENGTH = ("Length", "NetLength", "GrossLength", "Height", "Depth")
# Kinds measured by their face (walls) or their top (slabs, roofs, finishes) when computed from geometry.
FACE_AREA = {"Walls", "Curtain Walls", "Curtain Panels", "Wall Finishes", "Plates"}
TOP_AREA = {"Floors", "Roofs", "Ceilings", "Floor Finishes", "Insulation", "Structural Foundations"}


def category_of(e):
    predefined = getattr(e, "PredefinedType", None)
    if (e.is_a(), predefined) in BY_PREDEFINED:
        return BY_PREDEFINED[(e.is_a(), predefined)]
    if e.is_a() in REVIT_CATEGORY:
        return REVIT_CATEGORY[e.is_a()]
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", e.is_a()[3:]) + "s"


IDENTIFIER = re.compile(r"[A-Z0-9#()\-/.]*\d[A-Z0-9#()\-/.]*")


def type_of(e):
    """What groups like elements: their type, else their name without trailing ids ("Roof deck DK-N-12" -> "Roof deck")."""
    etype = ifcopenshell.util.element.get_type(e)
    if etype is not None and etype.Name:
        return etype.Name
    if getattr(e, "ObjectType", None):
        return e.ObjectType
    words = (e.Name or "").split()
    while len(words) > 1 and IDENTIFIER.fullmatch(words[-1]):
        words.pop()
    return " ".join(words) or e.is_a()[3:]


def quantities_from_qto(e, scales):
    q = {}
    for values in ifcopenshell.util.element.get_psets(e, qtos_only=True).values():
        for key, names in (("volume", QTO_VOLUME), ("area", QTO_AREA), ("length", QTO_LENGTH)):
            if key not in q:
                found = next((values[n] for n in names if isinstance(values.get(n), (int, float)) and values[n] > 0), None)
                if found is not None:
                    q[key] = found * scales[key]
    return q


def element_rows(model):
    scales = {
        "length": ifcopenshell.util.unit.calculate_unit_scale(model, "LENGTHUNIT"),
        "area": ifcopenshell.util.unit.calculate_unit_scale(model, "AREAUNIT"),
        "volume": ifcopenshell.util.unit.calculate_unit_scale(model, "VOLUMEUNIT"),
    }
    elements = [e for e in model.by_type("IfcElement") if not e.is_a("IfcFeatureElement") and getattr(e, "GlobalId", None)]
    category = {e.id(): category_of(e) for e in elements}
    quantities = {e.id(): quantities_from_qto(e, scales) for e in elements}
    from_qto = {i for i, q in quantities.items() if q}

    # Whatever the quantity sets don't give is measured from the geometry (in metres), in parallel.
    def needs(e):
        q = quantities[e.id()]
        return "volume" not in q or ("area" not in q and category[e.id()] in FACE_AREA | TOP_AREA)

    todo = [e for e in elements if needs(e)]
    if todo:
        settings = ifcopenshell.geom.settings()
        iterator = ifcopenshell.geom.iterator(settings, model, max(1, os.cpu_count() or 1), include=todo)
        if iterator.initialize():
            while True:
                shape = iterator.get()
                q, cat, g = quantities.get(shape.id), category.get(shape.id), shape.geometry
                if q is not None:
                    try:
                        q.setdefault("volume", ifcopenshell.util.shape.get_volume(g))
                        if "area" not in q and cat in FACE_AREA:
                            q["area"] = ifcopenshell.util.shape.get_max_side_area(g)
                        elif "area" not in q and cat in TOP_AREA:
                            q["area"] = ifcopenshell.util.shape.get_footprint_area(g)
                        q.setdefault("length", max(ifcopenshell.util.shape.get_x(g), ifcopenshell.util.shape.get_y(g), ifcopenshell.util.shape.get_z(g)))
                    except Exception:
                        pass
                if not iterator.next():
                    break

    # A name used once ("South exterior CMU wall") groups better by its material, with the
    # other elements of its kind made of the same thing.
    types = {e.id(): type_of(e) for e in elements}
    uses = collections.Counter((category[e.id()], types[e.id()]) for e in elements)
    materials = {}
    for e in elements:
        material = ifcopenshell.util.element.get_material(e, should_skip_usage=True)
        name = getattr(material, "Name", None) if material is not None else None
        if not name and material is not None and material.is_a("IfcMaterialLayerSet"):
            name = material.LayerSetName
        if name:
            materials[e.id()] = name
        if uses[(category[e.id()], types[e.id()])] == 1 and name and not ifcopenshell.util.element.get_type(e) and not getattr(e, "ObjectType", None):
            types[e.id()] = name

    rows = []
    for e in elements:
        q = {k: round(v, 6) for k, v in quantities[e.id()].items() if v and v > 0}
        container = ifcopenshell.util.element.get_container(e)
        if container is None and ifcopenshell.util.element.get_aggregate(e) is not None:
            container = ifcopenshell.util.element.get_container(ifcopenshell.util.element.get_aggregate(e))
        conkit = ifcopenshell.util.element.get_psets(e).get("Pset_Conkit") or {}
        properties = {k: str(conkit[k]) for k in ("Mark", "SourceSheet", "LOD") if conkit.get(k)}
        if getattr(e, "Tag", None) and "Mark" not in properties:
            properties["Mark"] = e.Tag
        if e.id() in materials:
            properties["Material"] = materials[e.id()]
        rows.append({
            "stableId": e.GlobalId,
            "category": category[e.id()],
            "typeName": types[e.id()],
            "level": container.Name if container is not None and container.is_a("IfcBuildingStorey") else None,
            "quantities": q,
            "quantitySource": ("qto_set" if e.id() in from_qto else "geometry") if q else "missing",
            "properties": properties,
        })
    return rows


def element_details(model, entity):
    info = {k: to_json(v) for k, v in entity.get_info(recursive=False).items()}
    out = {"entity": info}
    if entity.is_a("IfcProduct"):
        out["psets"] = to_json(ifcopenshell.util.element.get_psets(entity))
        container = ifcopenshell.util.element.get_container(entity)
        out["container"] = describe(container) if container else None
        etype = ifcopenshell.util.element.get_type(entity)
        out["type"] = describe(etype) if etype else None
        material = ifcopenshell.util.element.get_material(entity)
        out["material"] = describe(material) if material else None
        if entity.ObjectPlacement:
            out["placement"] = to_json(ifcopenshell.util.placement.get_local_placement(entity.ObjectPlacement))
    return out


def query(model, params):
    if params.get("id"):
        return element_details(model, model.by_id(int(params["id"])))
    found = ifcopenshell.util.selector.filter_elements(model, params.get("select") or "IfcProduct")
    found = sorted(found, key=lambda e: e.id())
    return {
        "count": len(found),
        "elements": [
            {**describe(e), "globalId": getattr(e, "GlobalId", None), "tag": getattr(e, "Tag", None)} for e in found[:MAX_RESULTS]
        ],
    }


def help_for(params):
    """Signature and documentation of an operation, or the operations in a module."""
    name = params.get("usecase", "")
    module_name, _, fn_name = name.partition(".")
    if module_name not in ALLOWED_MODULES:
        return {"modules": sorted(ALLOWED_MODULES), "note": "Ask for 'module' or 'module.function'."}
    module = importlib.import_module(f"ifcopenshell.api.{module_name}")
    if not fn_name:
        fns = [n for n in dir(module) if not n.startswith("_") and inspect.isfunction(getattr(module, n)) and n != "wrap_usecases"]
        return {
            "module": module_name,
            "functions": {n: (inspect.getdoc(getattr(module, n)) or "").split("\n")[0] for n in sorted(fns)},
        }
    fn = getattr(module, fn_name, None)
    if not inspect.isfunction(fn):
        raise ValueError(f"No function '{name}'")
    signature = str(inspect.signature(fn)).replace("ifcopenshell.ifcopenshell_wrapper.", "").replace("entity_instance", "entity")
    return {"usecase": name, "signature": f"{name}{signature}", "doc": (inspect.getdoc(fn) or "")[:4000]}


# --- creating a model ---------------------------------------------------------------------


def create(params):
    schema = params.get("schema", "IFC4X3")
    model = ifcopenshell.api.project.create_file(version=schema)
    api = ifcopenshell.api
    project = api.root.create_entity(model, ifc_class="IfcProject", name=params.get("name") or "Project")
    if params.get("lod") in LOD_LEVELS:
        pset = api.pset.add_pset(model, product=project, name="Pset_Conkit")
        api.pset.edit_pset(model, pset=pset, properties={"TargetLOD": params["lod"]})
    units = params.get("units", "m")
    if units in ("ft", "in"):
        length = api.unit.add_conversion_based_unit(model, name="foot" if units == "ft" else "inch")
    else:
        length = api.unit.add_si_unit(model, unit_type="LENGTHUNIT", prefix="MILLI" if units == "mm" else None)
    area = api.unit.add_si_unit(model, unit_type="AREAUNIT")
    volume = api.unit.add_si_unit(model, unit_type="VOLUMEUNIT")
    api.unit.assign_unit(model, units=[length, area, volume])
    model3d = api.context.add_context(model, context_type="Model")
    body = api.context.add_context(model, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=model3d)
    axis = api.context.add_context(model, context_type="Model", context_identifier="Axis", target_view="GRAPH_VIEW", parent=model3d)
    site = api.root.create_entity(model, ifc_class="IfcSite", name="Site")
    api.aggregate.assign_object(model, products=[site], relating_object=project)
    facility_kind = params.get("facility", "building")
    facility = None
    if facility_kind == "bridge" and schema == "IFC4X3":
        facility = api.root.create_entity(model, ifc_class="IfcBridge", name=params.get("name"))
    elif facility_kind in ("building", "bridge"):
        facility = api.root.create_entity(model, ifc_class="IfcBuilding", name=params.get("name"))
    if facility:
        api.aggregate.assign_object(model, products=[facility], relating_object=site)
    storeys = {}
    for level in params.get("levels", []) or []:
        storey = api.root.create_entity(model, ifc_class="IfcBuildingStorey", name=level["name"])
        api.attribute.edit_attributes(model, product=storey, attributes={"Elevation": float(level.get("elevation", 0))})
        api.aggregate.assign_object(model, products=[storey], relating_object=facility or site)
        api.geometry.edit_object_placement(model, product=storey, matrix=matrix((0, 0, float(level.get("elevation", 0)))), is_si=False)
        storeys[level["name"]] = storey.id()
    for product in (site, facility):
        if product:
            api.geometry.edit_object_placement(model, product=product, matrix=numpy.eye(4))
    location = params.get("location") or {}
    if isinstance(location.get("lat"), (int, float)) and isinstance(location.get("lon"), (int, float)):
        set_location(model, site, float(location["lat"]), float(location["lon"]), float(location.get("heading") or 0))
    handles = {
        "project": project.id(),
        "site": site.id(),
        "facility": facility.id() if facility else None,
        "storeys": storeys,
        "body_context": body.id(),
        "axis_context": axis.id(),
    }
    return model, handles


# --- a bridge from the Bridge section -------------------------------------------------------

# What each part of a bridge is in IFC 4.3 (class, predefined type), and its material.
BRIDGE_PARTS = {
    "girder": ("IfcBeam", "GIRDER_SEGMENT"),
    "diaphragm": ("IfcBeam", "DIAPHRAGM"),
    "cap": ("IfcBeam", "PIERCAP"),
    "column": ("IfcColumn", "PIERSTEM"),
    "deck": ("IfcSlab", None),
    "barrier": ("IfcRailing", "GUARDRAIL"),
    "bearing": ("IfcBearing", "ELASTOMERIC"),
}
MAX_BRIDGE_ELEMENTS = 5000


def bridge(params):
    """A bridge as an IFC model: each element an extrusion (its section along its length, or its
    plan outline up through its depth), placed, classed as a bridge part and given its material.
    Coordinates in feet, as the Bridge section's model."""
    elements = params.get("elements") or []
    if len(elements) > MAX_BRIDGE_ELEMENTS:
        raise ValueError(f"At most {MAX_BRIDGE_ELEMENTS} elements")
    model, handles = create({**params, "schema": "IFC4X3", "units": "ft", "facility": "bridge", "levels": []})
    api = ifcopenshell.api
    body = model.by_id(handles["body_context"])
    facility = model.by_id(handles["facility"])
    materials = {}
    origin = model.createIfcAxis2Placement3D(model.createIfcCartesianPoint((0.0, 0.0, 0.0)), None, None)
    up = model.createIfcDirection((0.0, 0.0, 1.0))
    made = []
    for spec in elements:
        kind = spec.get("kind")
        ifc_class, predefined = BRIDGE_PARTS.get(kind, ("IfcBuildingElementProxy", None))
        try:
            element = api.root.create_entity(model, ifc_class=ifc_class, name=str(spec.get("name") or kind), predefined_type=predefined)
        except Exception:
            element = api.root.create_entity(model, ifc_class=ifc_class, name=str(spec.get("name") or kind))
        if kind == "deck":
            api.attribute.edit_attributes(model, product=element, attributes={"PredefinedType": "USERDEFINED", "ObjectType": "DECK"})
        if "plan" in spec:
            # A slab: its outline in plan, extruded up from its underside.
            points = [(float(x), float(y)) for x, y in spec["plan"]]
            depth = float(spec["z1"]) - float(spec["z0"])
            placement = matrix((0.0, 0.0, float(spec["z0"])))
        else:
            # A member: its section in its own y (across) and z (up), extruded along its axis.
            a = numpy.array(spec["a"], dtype=float)
            b = numpy.array(spec["b"], dtype=float)
            depth = float(numpy.linalg.norm(b - a))
            if depth < 1e-6:
                continue
            ex = (b - a) / depth
            ey = numpy.array([0.0, 1.0, 0.0]) if numpy.hypot(ex[0], ex[1]) < 1e-6 else numpy.cross([0.0, 0.0, 1.0], ex)
            ey = ey / numpy.linalg.norm(ey)
            ez = numpy.cross(ex, ey)
            placement = numpy.eye(4)
            placement[:3, 0], placement[:3, 1], placement[:3, 2], placement[:3, 3] = ey, ez, ex, a
            points = [(float(y), float(z)) for y, z in spec.get("outline") or []]
        if spec.get("radius"):
            profile = model.createIfcCircleProfileDef("AREA", None, None, float(spec["radius"]))
        else:
            if len(points) < 3:
                continue
            loop = [model.createIfcCartesianPoint(p) for p in points]
            profile = model.createIfcArbitraryClosedProfileDef("AREA", None, model.createIfcPolyline(loop + [loop[0]]))
        solid = model.createIfcExtrudedAreaSolid(profile, origin, up, depth)
        shape = model.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid])
        api.geometry.assign_representation(model, product=element, representation=shape)
        api.geometry.edit_object_placement(model, product=element, matrix=placement, is_si=False)
        api.spatial.assign_container(model, products=[element], relating_structure=facility)
        name = spec.get("material")
        if name:
            if name not in materials:
                materials[name] = api.material.add_material(model, name=name, category="concrete")
            api.material.assign_material(model, products=[element], material=materials[name])
        properties = {k: v for k, v in (spec.get("properties") or {}).items() if isinstance(v, (str, int, float, bool))}
        if properties:
            pset = api.pset.add_pset(model, product=element, name="Pset_Conkit")
            api.pset.edit_pset(model, pset=pset, properties=properties)
        made.append(element.id())
    return model, {**handles, "elements": len(made)}


# --- HTTP ---------------------------------------------------------------------------------


def handle(payload):
    action = payload.get("action")
    params = payload.get("params") or {}
    if action == "help":
        return {"result": help_for(params)}
    if action == "dxf_export":
        return dxf_export(payload, params)
    if action == "dxf_import":
        return dxf_import(payload, params)
    if action == "create":
        model, handles = create(params)
        return {"size": dump(model, payload), "handles": handles, "summary": summary(model)}
    if action == "bridge":
        # The Bridge record's IFC 4.3 writer (alignment, parts, rebar), next to this file like _dxf.
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import _bridge

        model, handles = _bridge.build(params)
        return {"size": dump(model, payload), "handles": handles, "summary": summary(model)}
    if action == "bridge_solids":
        model, handles = bridge(params)
        return {"size": dump(model, payload), "handles": handles, "summary": summary(model)}
    model = load(payload)
    if action == "edit":
        results = run_operations(model, params.get("operations") or [])
        return {"size": dump(model, payload), "results": results, "summary": summary(model)}
    if action == "query":
        return {"result": query(model, params)}
    if action == "summary":
        return {"summary": summary(model)}
    if action == "elements":
        return {"elements": element_rows(model)}
    raise ValueError(f"Unknown action '{action}'")


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, {"ok": True, "ifcopenshell": ifcopenshell.version})

    def do_POST(self):
        token = expected_token()
        if not token or not hmac.compare_digest(self.headers.get("x-conkit-worker", ""), token):
            return self._send(401, {"ok": False, "error": "unauthorized"})
        started = time.time()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            body = handle(payload)
            body.update({"ok": True, "ms": round((time.time() - started) * 1000)})
            self._send(200, body)
        except ValueError as error:
            self._send(400, {"ok": False, "error": str(error)})
        except Exception as error:  # unexpected: keep the message, it helps the AI app fix its request
            self._send(500, {"ok": False, "error": f"{type(error).__name__}: {error}"})

    def log_message(self, *args):  # keep request logs quiet
        pass


if __name__ == "__main__":
    port = int(os.environ.get("IFC_WORKER_PORT", "5328"))
    print(f"allcon IFC worker on http://127.0.0.1:{port}/api/ifc (ifcopenshell {ifcopenshell.version})")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
