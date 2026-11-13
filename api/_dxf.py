"""
DXF in and out for allcon's drafting editor, with ezdxf.

A allcon drawing (see src/lib/drafting/types.ts) is kept to DXF's meaning, so most objects map
one to one: layers, text and dimension styles, blocks with attributes, lines, polylines with
arc segments, circles, arcs, ellipses, splines, text, multiline text, dimensions, leaders and
hatches, and layouts with their paper size and viewports. Dimensions are written with their
geometry blocks, so AutoCAD and other programs show them as drawn. Pictures under the drawing
are left out (DXF can only point at image files).

Used by the worker (api/ifc.py): export_dxf(drawing) -> bytes, import_dxf(bytes, units) -> drawing.
"""

import datetime
import io
import math
import re
import secrets
from collections import Counter

import ezdxf
from ezdxf import colors, path, recover
from ezdxf.enums import TextEntityAlignment
from ezdxf.math import Vec3

# --- shared ----------------------------------------------------------------------------------

ALIGN = {
    ("left", "baseline"): TextEntityAlignment.LEFT,
    ("center", "baseline"): TextEntityAlignment.CENTER,
    ("right", "baseline"): TextEntityAlignment.RIGHT,
    ("left", "bottom"): TextEntityAlignment.BOTTOM_LEFT,
    ("center", "bottom"): TextEntityAlignment.BOTTOM_CENTER,
    ("right", "bottom"): TextEntityAlignment.BOTTOM_RIGHT,
    ("left", "middle"): TextEntityAlignment.MIDDLE_LEFT,
    ("center", "middle"): TextEntityAlignment.MIDDLE_CENTER,
    ("right", "middle"): TextEntityAlignment.MIDDLE_RIGHT,
    ("left", "top"): TextEntityAlignment.TOP_LEFT,
    ("center", "top"): TextEntityAlignment.TOP_CENTER,
    ("right", "top"): TextEntityAlignment.TOP_RIGHT,
}
ALIGN_BACK = {v: k for k, v in ALIGN.items()}
ALIGN_BACK[TextEntityAlignment.MIDDLE] = ("center", "middle")
ALIGN_BACK[TextEntityAlignment.ALIGNED] = ("left", "baseline")
ALIGN_BACK[TextEntityAlignment.FIT] = ("left", "baseline")

# Fonts the editor draws with, and the TrueType files AutoCAD knows them by.
FONT_FILES = {
    "Arial": "arial.ttf",
    "Helvetica": "arial.ttf",
    "Verdana": "verdana.ttf",
    "Tahoma": "tahoma.ttf",
    "Times New Roman": "times.ttf",
    "Georgia": "georgia.ttf",
    "Courier New": "cour.ttf",
    "Segoe UI": "segoeui.ttf",
}

ARROWS_OUT = {"closed": "", "tick": "ARCHTICK", "dot": "DOT", "open": "OPEN"}

DEG = 180 / math.pi


def new_id():
    return secrets.token_hex(8)


def hex_rgb(value):
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


# --- out ---------------------------------------------------------------------------------------


class Writer:
    def __init__(self, drawing):
        self.drawing = drawing
        self.units = drawing.get("units", "architectural")
        self.metric = self.units == "mm"
        self.doc = ezdxf.new("R2013", setup=["linetypes"], units=4 if self.metric else 1)
        self.skipped = Counter()
        self.dim_styles = {d["name"]: d for d in drawing.get("dimStyles") or []}
        self.block_names = {}

    def write(self):
        doc = self.doc
        header = doc.header
        header["$MEASUREMENT"] = 1 if self.metric else 0
        header["$LUNITS"] = 2 if self.metric else 4
        header["$AUNITS"] = 0
        header["$DIMSCALE"] = float(self.drawing.get("annoScale") or 1)
        self.layers()
        self.text_styles()
        self.dimension_styles()
        current = self.drawing.get("currentLayer")
        if current and current in doc.layers:
            header["$CLAYER"] = current
        # Blocks first (all names, then their objects, so nested references resolve).
        blocks = self.drawing.get("blocks") or []
        for block in blocks:
            name = block["name"]
            safe = name if not name.startswith("*") else "_" + name[1:]
            self.block_names[name] = safe
        for block in blocks:
            base = block.get("base") or {"x": 0, "y": 0}
            doc.blocks.new(name=self.block_names[block["name"]], base_point=(base["x"], base["y"]))
        for block in blocks:
            target = doc.blocks.get(self.block_names[block["name"]])
            for e in block.get("entities") or []:
                self.add(target, e)
        msp = doc.modelspace()
        for e in self.drawing.get("entities") or []:
            self.add(msp, e)
        self.layouts()
        out = io.StringIO()
        doc.write(out)
        return out.getvalue().encode("utf-8"), dict(self.skipped)

    def layouts(self):
        layouts = self.drawing.get("layouts") or []
        if not layouts:
            return
        # A new DXF comes with Layout1: ours replace it.
        self.doc.layouts.rename("Layout1", "__default__")
        for layout in layouts:
            paper = layout["paper"]
            target = self.doc.layouts.new(layout["name"])
            media = (paper.get("name") or "Custom").split(" (")[0].replace(" ", "_")
            target.page_setup(size=(paper["width"], paper["height"]), margins=(0, 0, 0, 0), units="mm" if self.metric else "inch", name=media)
            for e in layout.get("entities") or []:
                self.add(target, e)
        self.doc.layouts.delete("__default__")

    def add_viewport(self, t, e, a):
        center, view = self.xy(e["center"]), self.xy(e["view"])
        vp = t.add_viewport(center=center, size=(e["width"], e["height"]), view_center_point=view, view_height=e["height"] / e["scale"], dxfattribs=a)
        if e.get("locked"):
            vp.dxf.flags = vp.dxf.flags | 16384

    def layers(self):
        for layer in self.drawing.get("layers") or []:
            name = layer["name"]
            entry = self.doc.layers.get(name) if name in self.doc.layers else self.doc.layers.add(name)
            color = layer.get("color", 7)
            if isinstance(color, str):
                entry.rgb = hex_rgb(color)
                entry.color = 7
            else:
                entry.color = int(color) or 7
            entry.dxf.lineweight = int(layer.get("lineweight", -3))
            if not layer.get("on", True):
                entry.off()
            if layer.get("frozen"):
                entry.freeze()
            if layer.get("locked"):
                entry.lock()

    def text_styles(self):
        for style in self.drawing.get("textStyles") or []:
            name = style["name"]
            entry = self.doc.styles.get(name) if name in self.doc.styles else self.doc.styles.add(name)
            entry.dxf.font = FONT_FILES.get(style.get("font"), "arial.ttf")
            entry.dxf.width = float(style.get("widthFactor") or 1)

    def dimension_styles(self):
        for d in self.dim_styles.values():
            name = d["name"]
            ds = self.doc.dimstyles.get(name) if name in self.doc.dimstyles else self.doc.dimstyles.new(name)
            ds.dxf.dimtxt = d["textHeight"]
            ds.dxf.dimasz = d["arrowSize"]
            ds.dxf.dimexo = d["extOffset"]
            ds.dxf.dimexe = d["extBeyond"]
            ds.dxf.dimgap = d["textGap"]
            ds.dxf.dimdli = d["baselineSpacing"]
            ds.dxf.dimscale = d["scale"]
            if d.get("textStyle") in self.doc.styles:
                ds.dxf.dimtxsty = d["textStyle"]
            ds.set_arrows(blk=ARROWS_OUT.get(d.get("arrow"), ""))
            # Text above the dimension line, aligned with it (AutoCAD's architectural and ISO
            # styles), lengths as the editor shows them.
            ds.dxf.dimtad = 1
            ds.dxf.dimtih = 0
            ds.dxf.dimtoh = 0
            if self.metric:
                ds.dxf.dimlunit = 2
                ds.dxf.dimdec = 0
                ds.dxf.dimzin = 8
            else:
                ds.dxf.dimlunit = 4
                ds.dxf.dimdec = 4
                ds.dxf.dimzin = 3

    def attribs(self, e):
        a = {"layer": e.get("layer") or "0", "lineweight": int(e.get("lineweight", -1))}
        color = e.get("color")
        if color is None:
            a["color"] = 256
        elif isinstance(color, str):
            a["true_color"] = colors.rgb2int(hex_rgb(color))
        else:
            a["color"] = int(color)
        return a

    def add(self, target, e):
        kind = e.get("type")
        method = getattr(self, f"add_{kind}", None)
        if method is None:
            self.skipped[kind] += 1
            return
        try:
            method(target, e, self.attribs(e))
        except Exception:  # one odd object shouldn't lose the whole drawing
            self.skipped[kind] += 1

    @staticmethod
    def xy(p):
        return (p["x"], p["y"])

    def add_line(self, t, e, a):
        t.add_line(self.xy(e["a"]), self.xy(e["b"]), dxfattribs=a)

    def add_polyline(self, t, e, a):
        bulges = e.get("bulges") or []
        points = [(p["x"], p["y"], 0, 0, bulges[i] if i < len(bulges) else 0) for i, p in enumerate(e["points"])]
        t.add_lwpolyline(points, format="xyseb", close=bool(e.get("closed")), dxfattribs=a)

    def add_circle(self, t, e, a):
        t.add_circle(self.xy(e["center"]), e["radius"], dxfattribs=a)

    def add_arc(self, t, e, a):
        t.add_arc(self.xy(e["center"]), e["radius"], e["start"] * DEG, e["end"] * DEG, dxfattribs=a)

    def add_ellipse(self, t, e, a):
        major = (e["major"]["x"], e["major"]["y"], 0)
        t.add_ellipse(self.xy(e["center"]), major_axis=major, ratio=max(min(e["ratio"], 1), 1e-6), start_param=e["start"], end_param=e["end"], dxfattribs=a)

    def add_spline(self, t, e, a):
        fit = [self.xy(p) for p in e["fit"]]
        if e.get("closed") and fit:
            fit.append(fit[0])
        t.add_spline(fit, dxfattribs=a)

    def add_xline(self, t, e, a):
        t.add_xline(self.xy(e["base"]), self.xy(e["dir"]), dxfattribs=a)

    def add_ray(self, t, e, a):
        t.add_ray(self.xy(e["base"]), self.xy(e["dir"]), dxfattribs=a)

    def add_text(self, t, e, a):
        a["style"] = e.get("style") or "Standard"
        text = t.add_text(e["text"], height=e["height"], rotation=e["rotation"] * DEG, dxfattribs=a)
        text.set_placement(self.xy(e["at"]), align=ALIGN.get((e.get("halign"), e.get("valign")), TextEntityAlignment.LEFT))

    @staticmethod
    def mtext_content(text):
        return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\P")

    def add_mtext(self, t, e, a):
        a.update(
            style=e.get("style") or "Standard",
            char_height=e["height"],
            width=e.get("width") or 0,
            rotation=e["rotation"] * DEG,
            insert=self.xy(e["at"]),
            attachment_point=1,
        )
        t.add_mtext(self.mtext_content(e["text"]), dxfattribs=a)

    def add_dimension(self, t, e, a):
        kind = e["kind"]
        text = e.get("text") or "<>"
        style = e.get("style") if e.get("style") in self.doc.dimstyles else "Standard"
        # Dimensions on a layout's paper are 1:1, whatever the style's scale.
        override = {"dimscale": e["dimScale"]} if e.get("dimScale") else None
        p1, p2, loc, center = self.xy(e["p1"]), self.xy(e["p2"]), self.xy(e["loc"]), self.xy(e["center"])
        if kind == "linear":
            dim = t.add_linear_dim(base=loc, p1=p1, p2=p2, angle=e.get("angle", 0) * DEG, text=text, dimstyle=style, override=override, dxfattribs=a)
        elif kind == "aligned":
            ux, uy = p2[0] - p1[0], p2[1] - p1[1]
            length = math.hypot(ux, uy) or 1
            distance = (ux * (loc[1] - p1[1]) - uy * (loc[0] - p1[0])) / length
            dim = t.add_aligned_dim(p1=p1, p2=p2, distance=distance, text=text, dimstyle=style, override=override, dxfattribs=a)
        elif kind == "angular":
            dim = t.add_angular_dim_3p(base=loc, center=center, p1=p1, p2=p2, text=text, dimstyle=style, override=override, dxfattribs=a)
        elif kind in ("radius", "diameter"):
            radius = math.hypot(p1[0] - center[0], p1[1] - center[1])
            add = t.add_radius_dim if kind == "radius" else t.add_diameter_dim
            dim = add(center=center, radius=radius, location=loc, text=text, dimstyle=style, override=override, dxfattribs=a)
        else:
            raise ValueError(kind)
        dim.render()
        if kind == "aligned":  # ezdxf writes a rotated one; AutoCAD's aligned type stretches as aligned
            dim.dimension.dxf.dimtype = (dim.dimension.dxf.dimtype & ~7) | 1

    def add_leader(self, t, e, a):
        points = [self.xy(p) for p in e["points"]]
        if len(points) < 2:
            return
        d = self.dim_styles.get(e.get("dimStyle")) or {}
        arrow = d.get("arrowSize", 0.1) * (e.get("dimScale") or d.get("scale", 1))
        end, before = points[-1], points[-2]
        right = end[0] >= before[0]
        landing = (end[0] + (2 * arrow if right else -2 * arrow), end[1])
        style = e.get("dimStyle") if e.get("dimStyle") in self.doc.dimstyles else "Standard"
        override = {"dimscale": e["dimScale"]} if e.get("dimScale") else None
        leader = t.add_leader(points + [landing], dimstyle=style, override=override, dxfattribs=dict(a))
        if e.get("text"):
            gap = arrow / 2
            at = (landing[0] + (gap if right else -gap), landing[1])
            m = dict(a)
            m.update(style=e.get("style") or "Standard", char_height=e["height"], insert=at, attachment_point=4 if right else 6)
            note = t.add_mtext(self.mtext_content(e["text"]), dxfattribs=m)
            # The text belongs to the leader, as AutoCAD's QLEADER makes them.
            leader.dxf.annotation_type = 0
            leader.dxf.annotation_handle = note.dxf.handle

    def add_hatch(self, t, e, a):
        loops = [loop for loop in e.get("loops") or [] if len(loop) >= 3]
        if not loops:
            return
        hatch = t.add_hatch(dxfattribs=dict(a))
        name = e.get("pattern") or "SOLID"
        if name == "SOLID":
            hatch.set_solid_fill()
        else:
            hatch.set_pattern_fill(name, angle=e.get("angle", 0) * DEG, scale=e.get("scale", 1))
        # The fill calls set colour 7: put the object's own colour back.
        for key in ("color", "true_color"):
            if key in a:
                hatch.dxf.set(key, a[key])
        for i, loop in enumerate(loops):
            hatch.paths.add_polyline_path([self.xy(p) for p in loop], is_closed=True, flags=1 if i == 0 else 0)

    def add_insert(self, t, e, a):
        name = self.block_names.get(e["block"])
        if not name:
            raise ValueError("missing block")
        scale = e.get("scale") or {"x": 1, "y": 1}
        a.update(xscale=scale["x"], yscale=scale["y"], rotation=e.get("rotation", 0) * DEG)
        ref = t.add_blockref(name, self.xy(e["at"]), dxfattribs=a)
        values = e.get("attribs") or {}
        block = next((b for b in self.drawing.get("blocks") or [] if b["name"] == e["block"]), None)
        tags = {d["tag"]: d.get("value", "") for d in (block or {}).get("entities") or [] if d.get("type") == "attdef"}
        if tags:
            ref.add_auto_attribs({tag: values.get(tag, default) for tag, default in tags.items()})

    def add_attdef(self, t, e, a):
        a.update(prompt=e.get("prompt") or e["tag"], style=e.get("style") or "Standard")
        if e.get("invisible"):
            a["flags"] = 1
        attdef = t.add_attdef(e["tag"], insert=self.xy(e["at"]), text=e.get("value", ""), height=e["height"], rotation=e["rotation"] * DEG, dxfattribs=a)
        attdef.set_placement(self.xy(e["at"]), align=ALIGN.get((e.get("halign"), e.get("valign")), TextEntityAlignment.LEFT))


FIELD = re.compile(r'%<\\AcVar\s+([A-Za-z]+)(?:\s+\\f\s+"([^"]*)")?>%')
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def format_date(d, fmt):
    """A date in AutoCAD's field format codes (as src/lib/drafting/fields.ts)."""
    def code(m):
        t = m.group(0)
        return {
            "MMMM": MONTHS[d.month - 1], "MMM": MONTHS[d.month - 1][:3], "MM": f"{d.month:02d}", "M": str(d.month),
            "dd": f"{d.day:02d}", "d": str(d.day), "yyyy": str(d.year), "yy": str(d.year)[-2:],
        }[t]
    return re.sub(r"MMMM|MMM|MM|M|dd|d|yyyy|yy", code, fmt)


def evaluate_fields(drawing, file_name):
    """Fields (%<\\AcVar Filename>% and the like) written out as their values, as AutoCAD's DXF
    shows a field's last value: the file name, today's date, the layout's name."""
    today = datetime.date.today()

    def value(text, layout):
        if "%<\\AcVar" not in text:
            return text

        def one(m):
            name, fmt = m.group(1).lower(), m.group(2) or "M/d/yyyy"
            if name == "filename":
                return file_name
            if name in ("date", "savedate", "plotdate"):
                return format_date(today, fmt)
            if name == "ctab":
                return layout
            return "####"

        return FIELD.sub(one, text)

    def visit(entities, layout):
        for e in entities:
            if isinstance(e.get("text"), str):
                e["text"] = value(e["text"], layout)
            if isinstance(e.get("attribs"), dict):
                e["attribs"] = {k: value(v, layout) if isinstance(v, str) else v for k, v in e["attribs"].items()}

    visit(drawing.get("entities") or [], "Model")
    for layout in drawing.get("layouts") or []:
        visit(layout.get("entities") or [], layout.get("name", ""))
    # Attribute defaults in blocks show where a reference has no value of its own.
    for block in drawing.get("blocks") or []:
        for e in block.get("entities") or []:
            if e.get("type") == "attdef" and isinstance(e.get("value"), str):
                e["value"] = value(e["value"], "")
            elif isinstance(e.get("text"), str):
                e["text"] = value(e["text"], "")


def export_dxf(drawing, file_name=""):
    """A drawing as DXF (AutoCAD 2013 format) and the objects that couldn't go in, by type."""
    evaluate_fields(drawing, file_name)
    return Writer(drawing).write()


# --- in ----------------------------------------------------------------------------------------

# Each DXF unit in inches ($INSUNITS), for the units the drawing opens in.
UNIT_INCHES = {1: 1.0, 2: 12.0, 3: 63360.0, 4: 1 / 25.4, 5: 10 / 25.4, 6: 1000 / 25.4, 8: 1e-6, 9: 0.001, 10: 36.0, 14: 100 / 25.4}
ARROW_BLOCKS = {"ARCHTICK", "BOXBLANK", "BOXFILLED", "CLOSED", "CLOSEDBLANK", "CLOSEDFILLED", "DATUMBLANK", "DATUMFILLED", "DOT", "DOTBLANK", "DOTSMALL", "INTEGRAL", "NONE", "OBLIQUE", "OPEN", "OPEN30", "OPEN90", "ORIGIN", "ORIGIN2", "SMALL"}
ARROWS_IN = {"": "closed", "ARCHTICK": "tick", "OBLIQUE": "tick", "INTEGRAL": "tick", "DOT": "dot", "DOTSMALL": "dot", "DOTBLANK": "dot", "OPEN": "open", "OPEN30": "open", "OPEN90": "open"}


def font_name(file_name):
    f = (file_name or "").lower()
    for key, name in (("arial", "Arial"), ("verdana", "Verdana"), ("tahoma", "Tahoma"), ("times", "Times New Roman"), ("georgia", "Georgia"), ("cour", "Courier New"), ("segoe", "Segoe UI"), ("helvet", "Helvetica")):
        if key in f:
            return name
    return "Arial"


class Reader:
    def __init__(self, data, units):
        self.doc, auditor = recover.read(io.BytesIO(data))
        header = self.doc.header
        insunits = int(header.get("$INSUNITS", 0) or 0)
        metric_file = int(header.get("$MEASUREMENT", 0) or 0) == 1
        detected = ("mm" if metric_file else "architectural") if insunits not in UNIT_INCHES else ("mm" if insunits in (4, 5, 6, 8, 9, 14) else "architectural")
        self.units = units if units in ("architectural", "mm") else detected
        if insunits in UNIT_INCHES:
            inches = UNIT_INCHES[insunits]
            self.f = inches if self.units == "architectural" else inches * 25.4
        else:
            self.f = 1.0  # unitless: taken as the drawing's own units
        # Hatch patterns: spacing in the file's pattern units, then in the drawing's.
        source_base = 3.175 if metric_file else 0.125
        target_base = 3.175 if self.units == "mm" else 0.125
        self.pattern_factor = source_base * self.f / target_base
        self.skipped = Counter()
        self.layers = {}
        self.used_mtext = set()

    # values

    def p(self, v, ocs=None):
        if ocs is not None:
            v = ocs.to_wcs(v)
        return {"x": float(v[0]) * self.f, "y": float(v[1]) * self.f}

    def base(self, e):
        layer = e.dxf.get("layer", "0") or "0"
        if layer not in self.layers:
            self.layers[layer] = {"name": layer, "color": 7, "lineweight": -3, "linetype": "Continuous", "on": True, "frozen": False, "locked": False}
        if e.dxf.hasattr("true_color"):
            color = "#%02x%02x%02x" % colors.int2rgb(e.dxf.true_color)
        else:
            c = e.dxf.get("color", 256)
            color = None if c in (256, 257) or c is None else int(c)
        return {"id": new_id(), "layer": layer, "color": color, "lineweight": int(e.dxf.get("lineweight", -1)), "linetype": "ByLayer"}

    @staticmethod
    def mirrored(e):
        """Whether an object's plane faces down (its OCS mirrors X), as mirrored blocks leave them."""
        z = e.dxf.get("extrusion", (0, 0, 1))
        return z[2] < 0

    # the drawing

    def read(self):
        doc = self.doc
        for layer in doc.layers:
            name = layer.dxf.name
            rgb = layer.rgb
            self.layers[name] = {
                "name": name,
                "color": "#%02x%02x%02x" % rgb if rgb else abs(int(layer.dxf.get("color", 7))) or 7,
                "lineweight": int(layer.dxf.get("lineweight", -3)),
                "linetype": "Continuous",
                "on": layer.is_on(),
                "frozen": layer.is_frozen(),
                "locked": layer.is_locked(),
            }
        text_styles = []
        for style in doc.styles:
            name = style.dxf.name
            if not name or style.dxf.get("flags", 0) & 1:  # shape files, not text
                continue
            text_styles.append({"name": name, "font": font_name(style.dxf.get("font", "")), "widthFactor": float(style.dxf.get("width", 1) or 1)})
        dim_styles = [self.dim_style(ds) for ds in doc.dimstyles]
        blocks = []
        for block in doc.blocks:
            name = block.name
            # Layouts, dimensions' own geometry, external references and arrowheads stay out.
            if block.is_any_layout or name.upper().startswith("*D") or block.block.is_xref or name.upper().lstrip("_") in ARROW_BLOCKS:
                continue
            base = block.block.dxf.get("base_point", (0, 0, 0))
            entities = []
            for e in block:
                entities.extend(self.convert(e))
            blocks.append({"name": name, "base": self.p(base), "entities": entities})
        names = {b["name"] for b in blocks}
        entities = []
        for e in doc.modelspace():
            entities.extend(self.convert(e))
        # References to blocks that didn't come in (external references) are left out.
        missing = [e for e in entities if e["type"] == "insert" and e["block"] not in names]
        if missing:
            self.skipped["XREF"] += len(missing)
            entities = [e for e in entities if not (e["type"] == "insert" and e["block"] not in names)]
        for b in blocks:
            b["entities"] = [e for e in b["entities"] if not (e["type"] == "insert" and e["block"] not in names)]
        layouts = []
        for layout in doc.layouts:
            if layout.is_modelspace:
                continue
            try:
                converted = self.layout(layout, names)
                if converted:
                    layouts.append(converted)
            except Exception:
                self.skipped["LAYOUT"] += 1
        dimscale = float(doc.header.get("$DIMSCALE", 1) or 1)
        current = doc.header.get("$CLAYER", "0")
        drawing = {
            "format": "conkit-drawing",
            "version": 1,
            "units": self.units,
            "layers": list(self.layers.values()),
            "currentLayer": current if current in self.layers else "0",
            "entities": entities,
            "textStyles": text_styles,
            "dimStyles": dim_styles,
            "blocks": blocks,
            "layouts": layouts,
            "annoScale": dimscale * self.f if dimscale > 0 else None,
        }
        if text_styles:
            drawing["currentTextStyle"] = doc.header.get("$TEXTSTYLE", text_styles[0]["name"])
        if dim_styles:
            drawing["currentDimStyle"] = doc.header.get("$DIMSTYLE", dim_styles[0]["name"])
        if drawing["annoScale"] is None:
            del drawing["annoScale"]
        return drawing, dict(self.skipped)

    def layout(self, layout, block_names):
        """A layout: its paper (in inches or millimetres), viewports and paper-space objects."""
        d = layout.dxf
        width, height = float(d.get("paper_width", 0) or 0), float(d.get("paper_height", 0) or 0)
        if int(d.get("plot_rotation", 0) or 0) in (1, 3):
            width, height = height, width
        to_paper = 1 / 25.4 if self.units == "architectural" else 1.0  # PLOTSETTINGS sizes are in mm
        width, height = round(width * to_paper, 4), round(height * to_paper, 4)
        # Paper-space objects are in paper units; viewports look at the model in its units.
        model_f = self.f
        source_metric = int(self.doc.header.get("$MEASUREMENT", 0) or 0) == 1
        self.f = 1.0 if source_metric == (self.units == "mm") else (25.4 if self.units == "mm" else 1 / 25.4)
        entities = []
        try:
            for e in layout:
                if e.dxftype() == "VIEWPORT":
                    if int(e.dxf.get("id", 0) or 0) == 1 or e.dxf.get("status", 1) == 0:
                        continue  # the paper's own viewport, or one switched off
                    view_height = float(e.dxf.get("view_height", 0) or 0) * model_f
                    if view_height <= 0:
                        continue
                    h = float(e.dxf.height) * self.f
                    view = e.dxf.get("view_center_point", (0, 0))
                    entities.append({
                        **self.base(e),
                        "type": "viewport",
                        "center": self.p(e.dxf.center),
                        "width": float(e.dxf.width) * self.f,
                        "height": h,
                        "view": {"x": float(view[0]) * model_f, "y": float(view[1]) * model_f},
                        "scale": h / view_height,
                        "locked": bool(int(e.dxf.get("flags", 0) or 0) & 16384),
                    })
                else:
                    entities.extend(self.convert(e))
        finally:
            self.f = model_f
        entities = [e for e in entities if not (e["type"] == "insert" and e["block"] not in block_names)]
        for e in entities:
            if e["type"] in ("dimension", "leader"):
                e["dimScale"] = 1  # on paper, drawn 1:1
        if not entities and width <= 0:
            return None
        if width <= 0 or height <= 0:
            width, height = (36.0, 24.0) if self.units == "architectural" else (841.0, 594.0)
        unit = "in" if self.units == "architectural" else "mm"
        media = (d.get("paper_size", "") or "").replace("_", " ").strip()
        return {
            "id": new_id(),
            "name": layout.name,
            "paper": {"name": media or f"Custom ({width:g} x {height:g} {unit})", "width": width, "height": height},
            "plot": {"monochrome": "monochrome" in (d.get("current_style_sheet", "") or "").lower(), "lineweights": True},
            "entities": entities,
        }

    def dim_style(self, ds):
        d = ds.dxf
        blk = (d.get("dimblk", "") or "").upper().lstrip("_")
        arrow = "tick" if float(d.get("dimtsz", 0) or 0) > 0 else ARROWS_IN.get(blk, "closed")
        scale = float(d.get("dimscale", 1) or 1)
        return {
            "name": d.name,
            "textHeight": float(d.get("dimtxt", 0.18)),
            "arrowSize": float(d.get("dimasz", 0.18)),
            "arrow": arrow,
            "extOffset": float(d.get("dimexo", 0.0625)),
            "extBeyond": float(d.get("dimexe", 0.18)),
            "textGap": abs(float(d.get("dimgap", 0.09))),
            "baselineSpacing": float(d.get("dimdli", 0.38)),
            "scale": scale * self.f,
            "textStyle": d.get("dimtxsty", "Standard") or "Standard",
        }

    # objects

    def convert(self, e):
        kind = e.dxftype()
        method = getattr(self, "c_" + kind.lower(), None)
        try:
            if method:
                return method(e)
        except Exception:
            pass
        return self.fallback(e)

    def fallback(self, e):
        """Anything else drawn as its lines (an ordinate dimension, a 3D face...), or skipped."""
        kind = e.dxftype()
        if kind in ("POINT", "VIEWPORT", "IMAGE", "WIPEOUT", "OLE2FRAME", "UNDERLAY", "PDFUNDERLAY", "DWFUNDERLAY", "DGNUNDERLAY", "3DSOLID", "BODY", "REGION", "SURFACE", "MESH"):
            self.skipped[kind] += 1
            return []
        try:
            out = []
            for v in e.virtual_entities():
                out.extend(self.convert(v))
            if out:
                return out
        except Exception:
            pass
        try:
            p = path.make_path(e)
            points = list(p.flattening(self.flat_distance(p)))
            if len(points) >= 2:
                return [{**self.base(e), "type": "polyline", "points": [self.p(v) for v in points], "bulges": [0] * len(points), "closed": False}]
        except Exception:
            pass
        self.skipped[kind] += 1
        return []

    def flat_distance(self, p):
        try:
            box = p.bbox()
            return max(box.size.x, box.size.y) * 0.002 or 0.01
        except Exception:
            return 0.01

    def c_line(self, e):
        return [{**self.base(e), "type": "line", "a": self.p(e.dxf.start), "b": self.p(e.dxf.end)}]

    def c_lwpolyline(self, e):
        flip = -1 if self.mirrored(e) else 1
        points = [self.p(v) for v in e.vertices_in_wcs()]
        bulges = [float(b) * flip for (_, _, b) in e.get_points("xyb")]
        if not points:
            return []
        return [{**self.base(e), "type": "polyline", "points": points, "bulges": bulges, "closed": bool(e.closed)}]

    def c_polyline(self, e):
        if e.is_2d_polyline:
            ocs = e.ocs()
            flip = -1 if self.mirrored(e) else 1
            vertices = [v for v in e.vertices if not v.dxf.get("flags", 0) & 16]  # not spline frame points
            points = [self.p(v.dxf.location, ocs) for v in vertices]
            bulges = [float(v.dxf.get("bulge", 0)) * flip for v in vertices]
        elif e.is_3d_polyline:
            points = [self.p(v.dxf.location) for v in e.vertices]
            bulges = [0] * len(points)
        else:
            return self.fallback(e)
        if not points:
            return []
        return [{**self.base(e), "type": "polyline", "points": points, "bulges": bulges, "closed": bool(e.is_closed)}]

    def c_circle(self, e):
        return [{**self.base(e), "type": "circle", "center": self.p(e.dxf.center, e.ocs()), "radius": e.dxf.radius * self.f}]

    def c_arc(self, e):
        start, end = e.dxf.start_angle, e.dxf.end_angle
        if self.mirrored(e):
            start, end = 180 - end, 180 - start
        return [{**self.base(e), "type": "arc", "center": self.p(e.dxf.center, e.ocs()), "radius": e.dxf.radius * self.f, "start": math.radians(start), "end": math.radians(end)}]

    def c_ellipse(self, e):
        major = e.dxf.major_axis
        ratio = min(max(float(e.dxf.ratio), 1e-6), 1)
        start, end = float(e.dxf.start_param), float(e.dxf.end_param)
        if self.mirrored(e):  # seen from below, the minor axis points the other way: the sweep reverses
            start, end = -end, -start
        return [{**self.base(e), "type": "ellipse", "center": self.p(e.dxf.center), "major": {"x": major.x * self.f, "y": major.y * self.f}, "ratio": ratio, "start": start, "end": end}]

    def c_spline(self, e):
        if e.fit_point_count() >= 2:
            fit = [self.p(v) for v in e.fit_points]
        else:
            tool = e.construction_tool()
            count = max(8, 4 * e.control_point_count())
            fit = [self.p(v) for v in tool.approximate(segments=count)]
        closed = bool(e.closed)
        if closed and len(fit) > 2 and math.isclose(fit[0]["x"], fit[-1]["x"]) and math.isclose(fit[0]["y"], fit[-1]["y"]):
            fit = fit[:-1]
        return [{**self.base(e), "type": "spline", "fit": fit, "closed": closed}]

    def c_xline(self, e):
        d = Vec3(e.dxf.unit_vector).normalize()
        return [{**self.base(e), "type": "xline", "base": self.p(e.dxf.start), "dir": {"x": d.x, "y": d.y}}]

    def c_ray(self, e):
        d = Vec3(e.dxf.unit_vector).normalize()
        return [{**self.base(e), "type": "ray", "base": self.p(e.dxf.start), "dir": {"x": d.x, "y": d.y}}]

    def text_fields(self, e):
        align, p1, p2 = e.get_placement()
        halign, valign = ALIGN_BACK.get(align, ("left", "baseline"))
        at = p1 if align in (TextEntityAlignment.LEFT, TextEntityAlignment.ALIGNED, TextEntityAlignment.FIT) or p2 is None else p2
        rotation = float(e.dxf.get("rotation", 0))
        if self.mirrored(e):
            # Mirrored text, kept readable (MIRRTEXT 0): the angle mirrored, running the other way.
            rotation = -rotation
            halign = {"left": "right", "right": "left"}.get(halign, halign)
        return {
            "at": self.p(at, e.ocs()),
            "height": float(e.dxf.get("height", 2.5)) * self.f,
            "rotation": math.radians(rotation),
            "style": e.dxf.get("style", "Standard") or "Standard",
            "halign": halign,
            "valign": valign,
        }

    def c_text(self, e):
        text = e.plain_text()
        if not text.strip():
            return []
        return [{**self.base(e), "type": "text", "text": text, **self.text_fields(e)}]

    def c_attdef(self, e):
        fields = self.text_fields(e)
        return [{**self.base(e), "type": "attdef", "tag": e.dxf.tag, "prompt": e.dxf.get("prompt", "") or e.dxf.tag, "value": e.dxf.get("text", ""), "invisible": bool(e.is_invisible), **fields}]

    def c_mtext(self, e):
        if e.dxf.handle in self.used_mtext:
            return []
        text = e.plain_text(split=False)
        if not text.strip():
            return []
        h = float(e.dxf.get("char_height", 2.5)) * self.f
        width = float(e.dxf.get("width", 0) or 0) * self.f
        rotation = math.radians(e.get_rotation())
        lines = text.split("\n")
        # The editor anchors multiline text at its top left: move other attachments there.
        ap = int(e.dxf.get("attachment_point", 1) or 1)
        col, row = (ap - 1) % 3, (ap - 1) // 3
        w = width or max(len(line) for line in lines) * h * 0.6
        total = (len(lines) - 1) * h * 5 / 3 + h
        dx, dy = -col * w / 2, row * total / 2
        at = self.p(e.dxf.insert)
        at = {"x": at["x"] + dx * math.cos(rotation) - dy * math.sin(rotation), "y": at["y"] + dx * math.sin(rotation) + dy * math.cos(rotation)}
        return [{**self.base(e), "type": "mtext", "at": at, "text": text, "height": h, "width": width, "rotation": rotation, "style": e.dxf.get("style", "Standard") or "Standard"}]

    def c_dimension(self, e):
        d = e.dxf
        kind = d.get("dimtype", 0) & 7
        text = d.get("text", "") or ""
        style = d.get("dimstyle", "Standard") or "Standard"
        out = {**self.base(e), "type": "dimension", "text": "" if text == "<>" else text, "style": style, "angle": 0}
        defpoint = Vec3(d.get("defpoint", (0, 0, 0)))
        if kind in (0, 1):
            p1, p2 = Vec3(d.defpoint2), Vec3(d.defpoint3)
            angle = math.radians(d.get("angle", 0)) if kind == 0 else math.atan2(p2.y - p1.y, p2.x - p1.x)
            out.update(kind="linear" if kind == 0 else "aligned", p1=self.p(p1), p2=self.p(p2), loc=self.p(defpoint), center=self.p(p1), angle=angle)
        elif kind == 5:
            out.update(kind="angular", p1=self.p(d.defpoint2), p2=self.p(d.defpoint3), center=self.p(d.defpoint4), loc=self.p(defpoint))
        elif kind == 2:
            a1, a2, b1, b2 = Vec3(d.defpoint2), Vec3(d.defpoint3), Vec3(d.defpoint4), defpoint
            center = intersection(a1, a2, b1, b2)
            if center is None:
                return self.fallback(e)
            far = lambda p, q: p if (p - center).magnitude >= (q - center).magnitude else q  # noqa: E731
            out.update(kind="angular", p1=self.p(far(a1, a2)), p2=self.p(far(b1, b2)), center=self.p(center), loc=self.p(Vec3(d.get("defpoint5", defpoint))))
        elif kind == 3:
            p1, p2 = defpoint, Vec3(d.defpoint4)
            center = (p1 + p2) / 2
            out.update(kind="diameter", p1=self.p(p2), p2=self.p(p1), center=self.p(center), loc=self.p(d.get("text_midpoint", p2)))
        elif kind == 4:
            out.update(kind="radius", p1=self.p(d.defpoint4), p2=self.p(d.defpoint4), center=self.p(defpoint), loc=self.p(d.get("text_midpoint", d.defpoint4)))
        else:
            return self.fallback(e)
        return [out]

    def c_leader(self, e):
        points = [self.p(v) for v in e.vertices]
        # A horizontal last segment is the landing (hook line), which the editor draws itself.
        if len(points) >= 3 and abs(points[-1]["y"] - points[-2]["y"]) <= 1e-9 * max(1, abs(points[-1]["y"])):
            points = points[:-1]
        if len(points) < 2:
            return []
        text, height = "", None
        handle = e.dxf.get("annotation_handle")
        note = self.doc.entitydb.get(handle) if handle else None
        if note is not None and note.dxftype() == "MTEXT":
            text = note.plain_text(split=False)
            height = float(note.dxf.get("char_height", 0)) * self.f
            self.used_mtext.add(note.dxf.handle)
        style = e.dxf.get("dimstyle", "Standard") or "Standard"
        return [{**self.base(e), "type": "leader", "points": points, "text": text, "height": height or self.default_height(), "style": "Standard", "dimStyle": style}]

    def c_multileader(self, e):
        ctx = e.context
        text = ""
        if ctx.mtext is not None:
            from ezdxf.tools.text import plain_mtext

            text = plain_mtext(ctx.mtext.default_content, split=False)
        height = float(ctx.char_height or 0) * self.f or self.default_height()
        out = []
        for leader in ctx.leaders:
            # The dogleg (landing) ends where the text is: it says which side the text is on.
            end = [leader.last_leader_point]
            if leader.has_dogleg_vector and leader.dogleg_length:
                end.append(Vec3(leader.last_leader_point) + Vec3(leader.dogleg_vector).normalize(leader.dogleg_length))
            for line in leader.lines:
                vertices = list(line.vertices) + end
                points = [self.p(v) for v in vertices]
                if len(points) >= 2:
                    out.append({**self.base(e), "type": "leader", "points": points, "text": text if not out else "", "height": height, "style": "Standard", "dimStyle": "Standard"})
        return out or self.fallback(e)

    def default_height(self):
        return (2.5 if self.units == "mm" else 0.125) * 50

    def c_hatch(self, e):
        loops = []
        for p in path.from_hatch(e):
            points = [self.p(v) for v in p.flattening(self.flat_distance(p))]
            if len(points) >= 3:
                if points[0] == points[-1]:
                    points = points[:-1]
                loops.append(points)
        if not loops:
            return []
        loops.sort(key=lambda loop: -abs(polygon_area(loop)))
        solid = bool(e.dxf.get("solid_fill", 0)) or e.has_gradient_data
        name = "SOLID" if solid else (e.dxf.get("pattern_name", "ANSI31") or "ANSI31").upper()
        return [{
            **self.base(e),
            "type": "hatch",
            "loops": loops,
            "pattern": name,
            "scale": float(e.dxf.get("pattern_scale", 1) or 1) * self.pattern_factor,
            "angle": math.radians(float(e.dxf.get("pattern_angle", 0) or 0)),
        }]

    def c_solid(self, e):
        points = [self.p(v) for v in e.wcs_vertices()]
        return [{**self.base(e), "type": "hatch", "loops": [points], "pattern": "SOLID", "scale": 1, "angle": 0}] if len(points) >= 3 else []

    c_trace = c_solid

    def c_insert(self, e):
        out = []
        refs = list(e.multi_insert()) if e.mcount > 1 else [e]
        for ref in refs:
            d = ref.dxf
            at = self.p(d.insert, ref.ocs())
            sx, sy = float(d.get("xscale", 1)), float(d.get("yscale", 1))
            rotation = math.radians(float(d.get("rotation", 0)))
            if self.mirrored(ref):
                sx, rotation = -sx, -rotation
            attribs = {a.dxf.tag: a.dxf.get("text", "") for a in ref.attribs}
            out.append({**self.base(ref), "type": "insert", "block": d.name, "at": at, "scale": {"x": sx, "y": sy}, "rotation": rotation, "attribs": attribs})
        return out


def polygon_area(points):
    s = 0.0
    for i in range(len(points)):
        a, b = points[i], points[(i + 1) % len(points)]
        s += a["x"] * b["y"] - b["x"] * a["y"]
    return s / 2


def intersection(a1, a2, b1, b2):
    r = a2 - a1
    s = b2 - b1
    d = r.x * s.y - r.y * s.x
    if abs(d) < 1e-12:
        return None
    t = ((b1.x - a1.x) * s.y - (b1.y - a1.y) * s.x) / d
    return a1 + r * t


def import_dxf(data, units=None):
    """A drawing from DXF bytes (any version ezdxf reads), and what was left out, by type."""
    return Reader(data, units).read()

