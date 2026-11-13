"""
Checks the Bridge IFC writer's bars and quantities (src/lib/design/bridge/ifc-rebar.test.ts runs it).

    python -I scripts/ifc-rebar-check.py <api dir> <bridge description .json> <out .ifc>

Writes the description with api/_bridge.py (IFC 4.3), then the same bar-carrying elements into an IFC4
file with the same writer; reads each back with IfcOpenShell, checks it against its schema, tessellates
some bars, and prints one JSON line of counts per schema.
"""

import json
import logging
import sys

import numpy

sys.path.insert(0, sys.argv[1])
import _bridge  # noqa: E402
import ifcopenshell  # noqa: E402
import ifcopenshell.api  # noqa: E402
import ifcopenshell.geom  # noqa: E402
import ifcopenshell.util.element  # noqa: E402
import ifcopenshell.validate  # noqa: E402


def ifc4_model(params):
    """The description's bar-carrying extruded elements in an IFC4 file: project, site, building, each element and its bars."""
    api = ifcopenshell.api
    m = api.project.create_file(version="IFC4")
    project = api.root.create_entity(m, ifc_class="IfcProject", name="IFC4 check")
    units = [api.unit.add_conversion_based_unit(m, name="foot"), api.unit.add_si_unit(m, unit_type="AREAUNIT"), api.unit.add_si_unit(m, unit_type="VOLUMEUNIT"), api.unit.add_si_unit(m, unit_type="MASSUNIT", prefix="KILO")]
    api.unit.assign_unit(m, units=units)
    ctx = api.context.add_context(m, context_type="Model")
    body = api.context.add_context(m, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
    site = api.root.create_entity(m, ifc_class="IfcSite", name="Site")
    api.aggregate.assign_object(m, products=[site], relating_object=project)
    building = api.root.create_entity(m, ifc_class="IfcBuilding", name="Bridge")
    api.aggregate.assign_object(m, products=[building], relating_object=site)
    for p in (site, building):
        api.geometry.edit_object_placement(m, product=p, matrix=numpy.eye(4), is_si=False)
    writer = _bridge.RebarWriter(m, body, project)
    for e in params["elements"]:
        if not e.get("rebar") or e["profile"]["kind"] == "mesh":
            continue
        el = api.root.create_entity(m, ifc_class=e["cls"], name=e["name"])
        api.spatial.assign_container(m, products=[el], relating_structure=building)
        api.geometry.edit_object_placement(m, product=el, matrix=_bridge._placement(e["origin"], e["xdir"], e["zdir"]), is_si=False)
        solid = m.createIfcExtrudedAreaSolid(_bridge._profile(m, e["profile"]), m.createIfcAxis2Placement3D(m.createIfcCartesianPoint((0.0, 0.0, 0.0))), m.createIfcDirection((0.0, 0.0, 1.0)), e["depth"])
        api.geometry.assign_representation(m, product=el, representation=m.createIfcShapeRepresentation(body, "Body", "SweptSolid", [solid]))
        api.material.assign_material(m, products=[el], material=api.material.add_material(m, name=e["material"], category="concrete"))
        for q in _bridge.element_quantities(e):
            _bridge._add_qto(m, el, q[0], q[1])
        writer.write(el, e["rebar"])
    writer.finish()
    return m


def check(f):
    errors = []
    logger = logging.getLogger(f"validate-{f.schema}")
    logger.setLevel(logging.ERROR)
    handler = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(f, handler)
    errors += [str(s.get("message"))[:300] for s in handler.statements]
    bars = f.by_type("IfcReinforcingBar")
    psets = {b.id(): ifcopenshell.util.element.get_psets(b) for b in bars}
    hosts = {b.Decomposes[0].RelatingObject for b in bars if b.Decomposes}
    weight = sum(psets[b.id()].get("Qto_ReinforcingElementBaseQuantities", {}).get("Weight", 0) for b in bars)
    settings = ifcopenshell.geom.settings()
    one_per_type = {}
    for b in bars:
        one_per_type.setdefault(ifcopenshell.util.element.get_type(b), b)
    for b in one_per_type.values():
        try:
            shape = ifcopenshell.geom.create_shape(settings, b)
            if not len(shape.geometry.verts):
                errors.append(f"bar {b.Tag} has no geometry")
        except Exception as ex:  # noqa: BLE001
            errors.append(f"bar {b.Tag} can't be tessellated: {ex}")
    def material(e):
        mat = ifcopenshell.util.element.get_material(e)
        return (getattr(mat, "Name", None) or "") if mat else ""

    concrete = [e for e in f.by_type("IfcElement") if not e.is_a("IfcReinforcingBar") and "oncrete" in material(e)]
    without = [e.Name for e in concrete if not any(k.startswith("Qto_") for k in ifcopenshell.util.element.get_psets(e, qtos_only=True))]
    extruded = 0.0
    for e in concrete:
        reps = e.Representation.Representations if e.Representation else []
        if any(r.RepresentationType == "SweptSolid" for r in reps):
            q = next((v for k, v in ifcopenshell.util.element.get_psets(e, qtos_only=True).items() if k.startswith("Qto_")), {})
            extruded += q.get("NetVolume", 0)
    return {
        "errors": errors,
        "bars": len(bars),
        "types": len(f.by_type("IfcReinforcingBarType")),
        "unaggregated": sum(1 for b in bars if not b.Decomposes),
        "untyped": sum(1 for b in bars if not ifcopenshell.util.element.get_type(b)),
        "withoutQto": sum(1 for b in bars if "Qto_ReinforcingElementBaseQuantities" not in psets[b.id()]),
        "withoutSchedule": sum(1 for b in bars if "ALLCON_BarSchedule" not in psets[b.id()]),
        "withoutShape": sum(1 for b in bars if not b.Representation),
        "hosts": len(hosts),
        "hostsWithoutReinforcementQto": sum(1 for h in hosts if "ALLCON_Reinforcement" not in ifcopenshell.util.element.get_psets(h, qtos_only=True)),
        "weightKg": weight,
        "concreteWithoutQto": without,
        "extrudedConcreteM3": extruded,
    }


def main():
    params = json.load(open(sys.argv[2], encoding="utf-8"))
    model, _ = _bridge.build(params)
    model.write(sys.argv[3])
    out = {"IFC4X3": check(ifcopenshell.open(sys.argv[3]))}
    path4 = sys.argv[3].replace(".ifc", "-ifc4.ifc")
    ifc4_model(params).write(path4)
    out["IFC4"] = check(ifcopenshell.open(path4))
    print(json.dumps(out))


if __name__ == "__main__":
    main()
