#!/usr/bin/env python3
"""Convert an explicitly exported millimetre DXF into a private AGF map JSON.

No CAD -> route inference: pass a separately reviewed topology JSON.
The produced JSON may contain private geometry: do not commit it to a public repo.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import sys

import ezdxf
from ezdxf import path as dxf_path

CATEGORIES = (
    "walls", "doors", "shutters", "windows", "fixtures",
    "equipment", "palletLocations", "areaBoundaries",
    "walkable", "routeCenterlines",
)
SKIP_TYPES = {"HATCH", "DIMENSION", "LEADER", "MLEADER", "TEXT", "MTEXT", "ATTRIB", "ATTDEF"}
GEOMETRY_TYPES = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "SPLINE", "ELLIPSE"}
ALLOWED_ACCESS = {"allowed", "forbidden", "unresolved"}
ALLOWED_DIRECTION = {"both", "forward", "reverse", "unresolved"}
ALLOWED_STATUS = {"confirmed", "provisional", "unresolved"}


def fail(message: str):
    raise ValueError(message)


def load_json(filename):
    with open(filename, "r", encoding="utf-8") as handle:
        return json.load(handle)


def finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(f"{name} must be a finite number")
    return float(value)


def check_config(config):
    if config.get("units") != "mm":
        fail("config.units must explicitly equal mm")
    origin = config.get("originMm")
    if not isinstance(origin, dict):
        fail("config.originMm must explicitly provide x and y in DXF model coordinates")
    ox = finite_number(origin.get("x"), "originMm.x")
    oy = finite_number(origin.get("y"), "originMm.y")
    mapping = config.get("layers")
    if not isinstance(mapping, dict) or not mapping:
        fail("config.layers must map categories to explicit DXF layer names")
    inverse = {}
    for category, names in mapping.items():
        if category not in CATEGORIES:
            fail(f"unknown geometry category: {category}")
        if not isinstance(names, list) or not names or not all(isinstance(n, str) and n.strip() for n in names):
            fail(f"layers.{category} must be a nonempty list of layer names")
        for name in names:
            key = name.casefold()
            if key in inverse:
                fail(f"layer {name!r} is mapped more than once")
            inverse[key] = category
    tolerance = finite_number(config.get("curveToleranceMm", 10), "curveToleranceMm")
    if tolerance <= 0:
        fail("curveToleranceMm must be positive")
    return ox, oy, inverse, tolerance


def iter_entities(entities, report, inherited=None, depth=0):
    if depth > 20:
        fail("nested INSERT depth exceeds 20")
    for entity in entities:
        dtype = entity.dxftype()
        layer = entity.dxf.get("layer", "0")
        effective = inherited if layer == "0" and inherited else layer
        if dtype == "INSERT":
            if entity.dxf.name.upper().startswith("*X"):
                report["warnings"].append("anonymous INSERT encountered; verify its geometry")
            try:
                yield from iter_entities(entity.virtual_entities(), report, effective, depth + 1)
            except (TypeError, ValueError, ezdxf.DXFError) as exc:
                fail(f"cannot expand INSERT on layer {effective}: {exc}; bind external references first")
        elif dtype in SKIP_TYPES:
            report["discarded"][dtype] += 1
        else:
            yield entity, effective


def feature_points(entity, origin, tolerance):
    dtype = entity.dxftype()
    if dtype not in GEOMETRY_TYPES:
        return None
    if dtype == "LINE":
        raw = [entity.dxf.start, entity.dxf.end]
        closed = False
    else:
        try:
            p = dxf_path.make_path(entity)
            raw = list(p.flattening(distance=tolerance, segments=8))
        except (TypeError, ValueError, ezdxf.DXFError) as exc:
            fail(f"failed to flatten {dtype}: {exc}")
        closed = dtype in {"CIRCLE"} or bool(getattr(entity, "closed", False))
    points = [[round(float(pt.x) - origin[0], 3), round(float(pt.y) - origin[1], 3)] for pt in raw]
    if closed and len(points) >= 2 and points[0] == points[-1]:
        points.pop()
    if len(points) < (3 if closed else 2):
        return None
    return {"kind": "polygon" if closed else "line", "pointsMm": points}


def extract_dxf(filename, config):
    origin_x, origin_y, layer_to_category, tolerance = check_config(config)
    if Path(filename).suffix.lower() != ".dxf":
        fail("DXF export is required: DWG cannot be read by ezdxf; export it in CAD first")
    try:
        doc = ezdxf.readfile(str(filename))
    except (OSError, ezdxf.DXFError) as exc:
        fail(f"cannot read DXF: {exc}")
    insunits = int(doc.header.get("$INSUNITS", 0))
    if insunits != 4:
        fail(f"DXF $INSUNITS must be 4 (millimetres); got {insunits}. Re-export with mm")
    report = {"discarded": Counter(), "ignored": Counter(), "warnings": []}
    features = {name: [] for name in CATEGORIES}
    observed = set()
    for entity, layer in iter_entities(doc.modelspace(), report):
        category = layer_to_category.get(layer.casefold())
        if category is None:
            report["ignored"][layer] += 1
            continue
        observed.add(layer.casefold())
        geometry = feature_points(entity, (origin_x, origin_y), tolerance)
        if geometry is None:
            report["ignored"][f"unsupported:{entity.dxftype()}"] += 1
            continue
        geometry["id"] = f"{category}-{len(features[category]) + 1:05d}"
        geometry["category"] = category
        features[category].append(geometry)
    missing = sorted(k for k in layer_to_category if k not in observed)
    if missing:
        report["warnings"].append("configured layers without extracted geometry: " + ", ".join(missing))
    if not any(features.values()):
        fail("no supported geometry extracted; check DXF modelspace and layer mapping")
    return {
        "schemaVersion": 1,
        "coordinateSystem": {"units": "mm", "origin": [0, 0], "xAxis": "DXF +X", "yAxis": "DXF +Y"},
        "geometry": features,
        "extractionReport": {
            "counts": {k: len(v) for k, v in features.items()},
            "discardedEntityTypes": dict(report["discarded"]),
            "ignored": dict(report["ignored"]),
            "warnings": report["warnings"],
        },
    }, (origin_x, origin_y)


def build_graph(source, origin):
    if not isinstance(source, dict):
        fail("topology JSON must be an object")
    areas = source.get("areas", [])
    gates = source.get("gates", [])
    nodes = source.get("nodes", [])
    edges = source.get("edges", [])
    if not all(isinstance(a, list) for a in (areas, gates, nodes, edges)):
        fail("areas, gates, nodes and edges must be arrays")
    def indexed(items, what):
        output = {}
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip():
                fail(f"{what} must have nonempty string id")
            if item["id"] in output:
                fail(f"duplicate {what} id: {item['id']}")
            output[item["id"]] = item
        return output
    area_index = indexed(areas, "area")
    gate_index = indexed(gates, "gate")
    node_index = indexed(nodes, "node")
    indexed(edges, "edge")
    new_nodes = []
    for node in nodes:
        if node.get("areaId") not in area_index:
            fail(f"node {node['id']} refers to unknown areaId")
        if node.get("status") not in ALLOWED_STATUS:
            fail(f"node {node['id']} requires explicit status")
        new_nodes.append({
            **node,
            "xMm": round(finite_number(node.get("xMm"), "node.xMm") - origin[0], 3),
            "yMm": round(finite_number(node.get("yMm"), "node.yMm") - origin[1], 3),
        })
    for gate in gates:
        ends = gate.get("areaIds")
        if not isinstance(ends, list) or len(ends) != 2 or any(a not in area_index for a in ends):
            fail(f"gate {gate['id']} requires two known areaIds")
        if gate.get("status") not in ALLOWED_STATUS:
            fail(f"gate {gate['id']} requires explicit status")
    new_edges, routable = [], []
    for edge in edges:
        eid = edge["id"]
        src, dst = edge.get("from"), edge.get("to")
        if src not in node_index or dst not in node_index or src == dst:
            fail(f"edge {eid}: invalid from/to node")
        access, direction = edge.get("access"), edge.get("direction")
        status = edge.get("status")
        if access not in ALLOWED_ACCESS or direction not in ALLOWED_DIRECTION or status not in ALLOWED_STATUS:
            fail(f"edge {eid}: explicit access, direction and status are required")
        lanes = edge.get("laneCount")
        if lanes is not None and (isinstance(lanes, bool) or not isinstance(lanes, int) or lanes < 1):
            fail(f"edge {eid}: laneCount must be positive integer or null")
        gate_id = edge.get("gateId")
        if gate_id is not None and gate_id not in gate_index:
            fail(f"edge {eid}: unknown gateId")
        area_src = node_index[src]["areaId"]
        area_dst = node_index[dst]["areaId"]
        if area_src != area_dst:
            if gate_id is None or set(gate_index[gate_id]["areaIds"]) != {area_src, area_dst}:
                fail(f"edge {eid}: cross-area passage requires an explicit matching gate")
        # Do not turn drawn geometry into confirmed traversal.
        ready = access == "allowed" and direction != "unresolved" and status == "confirmed"
        if gate_id and gate_index[gate_id]["status"] != "confirmed":
            ready = False
        edge_copy = {**edge, "routable": ready}
        new_edges.append(edge_copy)
        if ready:
            routable.append(eid)
    return {"areas": areas, "gates": gates, "nodes": new_nodes, "edges": new_edges, "routableEdgeIds": routable}


def make_grid(geometry, config):
    """Optional *geometric* occupancy grid; dynamic shutter permissions remain in graph."""
    try:
        from shapely.geometry import LineString, Point, Polygon
        from shapely.ops import unary_union
    except ImportError as exc:
        fail(f"grid export requires shapely: {exc}")
    cell = finite_number(config.get("cellMm"), "grid.cellMm")
    clearance = finite_number(config.get("agfRadiusMm"), "grid.agfRadiusMm")
    wall_half = finite_number(config.get("wallHalfWidthMm"), "grid.wallHalfWidthMm")
    if cell <= 0 or clearance < 0 or wall_half < 0:
        fail("grid cell must be positive and clearance/half wall width nonnegative")
    walkables = geometry.get("walkable", [])
    if not walkables or any(f["kind"] != "polygon" for f in walkables):
        fail("grid needs explicitly mapped closed walkable polygons; do not infer floor from empty space")
    walk = unary_union([Polygon(f["pointsMm"]) for f in walkables])
    if not walk.is_valid:
        fail("walkable polygon is invalid; repair DXF before rasterization")
    obstacles = []
    for category in ("walls", "fixtures", "equipment"):
        for f in geometry.get(category, []):
            if f["kind"] == "polygon":
                shape = Polygon(f["pointsMm"])
                if not shape.is_valid:
                    fail(f"invalid obstacle polygon: {f['id']}")
            else:
                if category == "walls" and wall_half == 0:
                    fail("grid.wallHalfWidthMm must be set for LINE walls")
                shape = LineString(f["pointsMm"]).buffer(wall_half if category == "walls" else clearance)
            obstacles.append(shape)
    blocked = unary_union(obstacles) if obstacles else None
    xmin, ymin, xmax, ymax = walk.bounds
    cols = math.ceil((xmax - xmin) / cell)
    rows = math.ceil((ymax - ymin) / cell)
    if cols <= 0 or rows <= 0 or cols * rows > 2_000_000:
        fail("grid dimensions invalid or exceed 2 million cells")
    accessible = walk.buffer(-clearance) if clearance else walk
    blocked = blocked.buffer(clearance) if blocked is not None and clearance else blocked
    cells = []
    for row in range(rows):
        y = ymin + (row + 0.5) * cell
        items = []
        for col in range(cols):
            point = Point(xmin + (col + 0.5) * cell, y)
            valid = accessible.covers(point) and (blocked is None or not blocked.intersects(point))
            items.append(1 if valid else 0)
        cells.append(items)
    return {
        "type": "geometric_only", "units": "mm", "cellMm": cell,
        "originMm": [xmin, ymin], "rows": rows, "cols": cols,
        "cells": cells, "agfRadiusMm": clearance,
        "warning": "Geometric occupancy only. Pallet locations are not assumed blocked; their current occupancy, dynamic shutter states, lanes, reservations and permissions MUST be applied separately.",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dxf", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--topology", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--grid-out", type=Path)
    parser.add_argument("--grid-config", type=Path)
    args = parser.parse_args(argv)
    if bool(args.grid_out) != bool(args.grid_config):
        parser.error("--grid-out and --grid-config must be supplied together")
    try:
        layout, origin = extract_dxf(args.dxf, load_json(args.config))
        layout["graph"] = build_graph(load_json(args.topology), origin)
        grid = make_grid(layout["geometry"], load_json(args.grid_config)) if args.grid_out else None
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(layout, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if args.grid_out:
            args.grid_out.parent.mkdir(parents=True, exist_ok=True)
            args.grid_out.write_text(json.dumps(grid, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"generated map schema v1; features={sum(layout['extractionReport']['counts'].values())}; routableEdges={len(layout['graph']['routableEdgeIds'])}; output={args.out}")
        for warning in layout["extractionReport"]["warnings"]:
            print(f"WARNING: {warning}", file=sys.stderr)
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
