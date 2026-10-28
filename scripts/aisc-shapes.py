"""Converts the AISC Shapes Database (Excel, from aisc.org) into the compact table Calcs ships.

    python3 scripts/aisc-shapes.py aisc-shapes-database-v16.0.xlsx

Keeps the US customary values of the properties design uses (the app converts units itself),
grouped by shape type, with each shape's metric label so either name finds it. Double angles
(2L) are left out: they're a row per spacing.
"""

import json
import sys

import openpyxl

KEEP = ["W", "A", "d", "Ht", "h", "OD", "bf", "B", "b", "ID", "tw", "tf", "t", "tnom", "tdes", "kdes", "k1", "x", "y", "eo", "xp", "yp", "bf/2tf", "b/t", "b/tdes", "h/tw", "h/tdes", "D/t", "Ix", "Zx", "Sx", "rx", "Iy", "Zy", "Sy", "ry", "Iz", "rz", "Sz", "J", "Cw", "C", "ro", "H", "rts", "ho"]
OUT = "src/lib/calcs/library/aisc-shapes.json"


def number(v):
    if v is None or v == "–":
        return None
    n = float(v)
    return int(n) if n.is_integer() else n


def main(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["Database v16.0"]
    rows = ws.iter_rows(values_only=True)
    head = list(next(rows))
    us = {name: i for i, name in enumerate(head[:84])}
    metric_label = head.index("AISC_Manual_Label", 84)
    types = {}
    for r in rows:
        kind = r[0]
        if not kind or kind == "2L":
            continue
        values = {p: number(r[us[p]]) for p in KEEP}
        types.setdefault(kind, []).append((r[us["AISC_Manual_Label"]], r[metric_label], values))
    out = {"source": "AISC Shapes Database v16.0", "types": {}}
    for kind, shapes in types.items():
        props = [p for p in KEEP if any(v[p] is not None for _, _, v in shapes)]
        out["types"][kind] = {"props": props, "shapes": [[label, metric, *[v[p] for p in props]] for label, metric, v in shapes]}
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(OUT, sum(len(s) for s in types.values()), "shapes")


if __name__ == "__main__":
    main(sys.argv[1])
