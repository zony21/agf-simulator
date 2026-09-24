#!/usr/bin/env python3
"""Inspect a DXF without asserting its units; stream selected CAD-native entities privately.

This is not a route extractor: mapped lines are never automatically walkable.
The selected-layer configuration and produced geometry are site-sensitive and
must remain outside the public repo (e.g. in the gitignored private/ folder).
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path
import sys

import ezdxf

SKIP = {"HATCH", "DIMENSION", "LEADER", "MLEADER", "TEXT", "MTEXT", "ATTRIB", "ATTDEF"}
SUPPORTED = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "SPLINE", "ELLIPSE", "INSERT"}
UNITS = {0: "unverified", 1: "inch", 2: "foot", 3: "mile", 4: "mm", 5: "cm", 6: "m"}


def _point(value):
    return [float(value[0]), float(value[1])]


def _record(entity):
    kind = entity.dxftype()
    payload = {"type": kind}
    if kind == "LINE":
        payload["start"] = _point(entity.dxf.start)
        payload["end"] = _point(entity.dxf.end)
    elif kind == "LWPOLYLINE":
        payload["vertices"] = [[float(x), float(y), float(bulge)] for x, y, bulge in entity.get_points("xyb")]
        payload["closed"] = bool(entity.closed)
    elif kind == "POLYLINE":
        payload["vertices"] = [_point(v.dxf.location) for v in entity.vertices]
        payload["closed"] = bool(entity.is_closed)
        payload["note"] = "2D projection; Z and bulge information are not represented"
    elif kind in {"ARC", "CIRCLE"}:
        payload["center"] = _point(entity.dxf.center)
        payload["radius"] = float(entity.dxf.radius)
        if kind == "ARC":
            payload["startAngleDeg"] = float(entity.dxf.start_angle)
            payload["endAngleDeg"] = float(entity.dxf.end_angle)
    elif kind == "SPLINE":
        payload["degree"] = int(entity.dxf.degree)
        payload["controlPoints"] = [_point(x) for x in entity.control_points]
        payload["knots"] = [float(x) for x in entity.knots]
        payload["weights"] = [float(x) for x in entity.weights]
    elif kind == "ELLIPSE":
        payload["center"] = _point(entity.dxf.center)
        payload["majorAxis"] = _point(entity.dxf.major_axis)
        payload["ratio"] = float(entity.dxf.ratio)
        payload["startParam"] = float(entity.dxf.start_param)
        payload["endParam"] = float(entity.dxf.end_param)
    elif kind == "INSERT":
        payload["blockRef"] = str(entity.dxf.name)
        payload["insert"] = _point(entity.dxf.insert)
        payload["scale"] = [float(entity.dxf.xscale), float(entity.dxf.yscale)]
        payload["rotationDeg"] = float(entity.dxf.rotation)
        payload["geometryExpanded"] = False
    else:
        return None
    return payload


def inspect(filename, layer_config=None, out_geometry=None):
    if filename.suffix.lower() != ".dxf":
        raise ValueError("A .dxf export is required; this tool does not read DWG")
    if not filename.is_file():
        raise ValueError("Input DXF is not a readable file")
    doc = ezdxf.readfile(str(filename))
    unit_code = int(doc.header.get("$INSUNITS", 0))
    unit = UNITS.get(unit_code, f"unknown-code-{unit_code}")
    layers = {x.dxf.name for x in doc.layers}
    selection = {}
    if layer_config is not None:
        config = json.loads(layer_config.read_text(encoding="utf-8"))
        mapping = config.get("categories")
        if not isinstance(mapping, dict) or not mapping:
            raise ValueError("categories must map descriptive categories to lists of layer names")
        assigned = {}
        for group, names in mapping.items():
            if not isinstance(group, str) or not group or not isinstance(names, list) or not names:
                raise ValueError("invalid category or layer list")
            for name in names:
                if not isinstance(name, str) or name not in layers:
                    raise ValueError(f"configured layer not found: {name!r}")
                if name in assigned:
                    raise ValueError(f"layer assigned twice: {name!r}")
                selection[name] = group
                assigned[name] = True
    if out_geometry is not None and not selection:
        raise ValueError("geometry export requires a private layer configuration")
    if out_geometry is not None and out_geometry.suffix != ".gz":
        raise ValueError("geometry output must be .json.gz")
    counts = Counter()
    selected_counts = Counter()
    discarded = Counter()
    skipped = Counter()
    records = 0
    writer = None
    try:
        if out_geometry is not None:
            out_geometry.parent.mkdir(parents=True, exist_ok=True)
            writer = gzip.open(out_geometry, "wt", encoding="utf-8", compresslevel=6)
            header = {
                "schemaVersion": "private-cad-native-v1",
                "coordinateSystem": {
                    "units": unit, "headerInsunits": unit_code,
                    "origin": "original-CAD-origin-unverified",
                    "physicalDistanceAllowed": False,
                    "note": "Raw DXF coordinates; do not claim mm or actual route without verification",
                },
                "geometryNature": "selected-2d-entities-not-a-walkable-map",
                "features": [],
            }
            writer.write('{"schemaVersion":"private-cad-native-v1","coordinateSystem":')
            writer.write(json.dumps(header["coordinateSystem"], ensure_ascii=False, separators=(",", ":")))
            writer.write(',"geometryNature":"selected-2d-entities-not-a-walkable-map","features":[')
        for entity in doc.modelspace():
            dtype = entity.dxftype()
            layer = entity.dxf.layer
            counts[(layer, dtype)] += 1
            if dtype in SKIP:
                discarded[dtype] += 1
                continue
            if not writer or layer not in selection:
                continue
            if dtype not in SUPPORTED:
                skipped[dtype] += 1
                continue
            data = _record(entity)
            if data is None:
                skipped[dtype] += 1
                continue
            data["category"] = selection[layer]
            data["layer"] = layer
            if records:
                writer.write(",")
            writer.write(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
            records += 1
            selected_counts[(selection[layer], dtype)] += 1
        if writer:
            writer.write(']}')
    finally:
        if writer:
            writer.close()
    per_layer = defaultdict(Counter)
    for (layer, dtype), count in counts.items():
        per_layer[layer][dtype] += count
    return {
        "schemaVersion": "private-cad-report-v1",
        "unitCode": unit_code,
        "units": unit,
        "metricScaleVerified": False,
        "originVerified": False,
        "modelspaceEntityCount": sum(counts.values()),
        "layerCount": len(layers),
        "blockCount": len(doc.blocks),
        "layers": {layer: dict(types) for layer, types in sorted(per_layer.items())},
        "selectedEntityCount": records,
        "selectedTypes": {f"{group}/{kind}": count for (group, kind), count in selected_counts.items()},
        "discardedAnnotationTypes": dict(discarded),
        "skippedSelectedTypes": dict(skipped),
        "notes": [
            "All coordinates remain original unverified drawing units.",
            "Selected CAD shapes are not evidence of passable corridors or validated gate topology.",
            "INSERT references are not expanded; retain CAD source for nested geometry.",
            "Reported geometry is site-sensitive. Do not upload report or geometry to a public repository.",
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dxf", type=Path, required=True)
    parser.add_argument("--out-report", type=Path, required=True)
    parser.add_argument("--layer-config", type=Path)
    parser.add_argument("--out-geometry", type=Path)
    args = parser.parse_args(argv)
    try:
        result = inspect(args.dxf, args.layer_config, args.out_geometry)
        args.out_report.parent.mkdir(parents=True, exist_ok=True)
        args.out_report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "schemaVersion": result["schemaVersion"],
            "units": result["units"], "unitCode": result["unitCode"],
            "metricScaleVerified": result["metricScaleVerified"],
            "originVerified": result["originVerified"],
            "modelspaceEntityCount": result["modelspaceEntityCount"],
            "layerCount": result["layerCount"],
            "selectedEntityCount": result["selectedEntityCount"],
        }, ensure_ascii=False))
    except (OSError, ValueError, ezdxf.DXFError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
