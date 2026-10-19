"""
IfcOpenShell worker for conkit's detailed 3D models.

conkit's Next.js server calls this function (never browsers or AI apps directly). An AI app
edits a model through conkit's connector as lists of ifcopenshell.api calls from a whitelist;
no code sent to this worker is ever executed. Each request carries the model as gzipped IFC
and gets the changed model back, so the worker keeps no state.

Deployed as a Vercel Python function at /api/ifc. Locally: python api/ifc.py (port 5328).
"""

import base64
import collections
import gzip
import hashlib
import hmac
import importlib
import inspect
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.api.aggregate
import ifcopenshell.api.attribute
import ifcopenshell.api.context
import ifcopenshell.api.geometry
import ifcopenshell.api.project
import ifcopenshell.api.pset
import ifcopenshell.api.root
import ifcopenshell.api.unit
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.selector
import ifcopenshell.util.unit
import numpy

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
    text = gzip.decompress(base64.b64decode(payload["ifc"])).decode("utf-8")
    return ifcopenshell.file.from_string(text)


def dump(model):
    return base64.b64encode(gzip.compress(model.to_string().encode("utf-8"))).decode("ascii")


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
    }


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
    handles = {
        "project": project.id(),
        "site": site.id(),
        "facility": facility.id() if facility else None,
        "storeys": storeys,
        "body_context": body.id(),
        "axis_context": axis.id(),
    }
    return model, handles


# --- HTTP ---------------------------------------------------------------------------------


def handle(payload):
    action = payload.get("action")
    params = payload.get("params") or {}
    if action == "help":
        return {"result": help_for(params)}
    if action == "create":
        model, handles = create(params)
        return {"ifc": dump(model), "handles": handles, "summary": summary(model)}
    model = load(payload)
    if action == "edit":
        results = run_operations(model, params.get("operations") or [])
        return {"ifc": dump(model), "results": results, "summary": summary(model)}
    if action == "query":
        return {"result": query(model, params)}
    if action == "summary":
        return {"summary": summary(model)}
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
    print(f"conkit IFC worker on http://127.0.0.1:{port}/api/ifc (ifcopenshell {ifcopenshell.version})")
    HTTPServer(("127.0.0.1", port), handler).serve_forever()
