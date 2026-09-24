#!/usr/bin/env python3
"""Export a display-only private SVG from explicitly selected DXF layers.

A unitless file needs --assume-mm. This does NOT confirm physical scale, origin,
AGF routes, interlocks, or ETA. Source CAD and all derived outputs stay private.
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

GEOMETRY = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "SPLINE", "ELLIPSE"}
COLORS = {
    "architecture": "#a8bac9",
    "equipment": "#73ccda",
    "pallets": "#edbb80",
    "other": "#99a6b1",
}


def require_private_destination(path):
    repo = Path(__file__).resolve().parents[1]
    resolved = path.resolve()
    if resolved.is_relative_to(repo) and not resolved.is_relative_to(repo / "private"):
        raise ValueError("CAD-derived output inside this repository must stay in gitignored private/")


def configured_layers(config):
    groups = config.get("categories")
    if not isinstance(groups, dict) or not groups:
        raise ValueError("private config must have a nonempty categories object")
    inverse = {}
    for category, names in groups.items():
        if category not in COLORS or not isinstance(names, list) or not names:
            raise ValueError("invalid preview category or layer list")
        for layer in names:
            if not isinstance(layer, str) or not layer.strip() or layer.casefold() in inverse:
                raise ValueError("invalid or duplicate layer")
            inverse[layer.casefold()] = category
    excluded = config.get("excludeLayers")
    if not isinstance(excluded, list) or not excluded or not all(
        isinstance(layer, str) and layer.strip() for layer in excluded
    ):
        raise ValueError("excludeLayers must explicitly list the private AGF drawing layer(s)")
    denied = {layer.casefold() for layer in excluded}
    if len(denied) != len(excluded) or denied.intersection(inverse):
        raise ValueError("excluded AGF layers cannot also be selected as equipment")
    return inverse, denied


def iter_geometry(entities, problems, inherited=None, depth=0, excluded=frozenset()):
    if depth > 20:
        raise ValueError("nested INSERT depth exceeded")
    for entity in entities:
        kind = entity.dxftype()
        layer = entity.dxf.get("layer", "0")
        layer = inherited if layer == "0" and inherited else layer
        # Skip an excluded INSERT before virtual expansion, including nested
        # entities that carry a different layer name inside the block.
        if layer.casefold() in excluded:
            problems["AGF_LAYER_EXCLUDED"] += 1
            continue
        if kind == "INSERT":
            try:
                yield from iter_geometry(entity.virtual_entities(), problems, layer, depth + 1, excluded)
            except (ValueError, KeyError, TypeError, ezdxf.DXFError):
                problems["INSERT_UNRESOLVED"] += 1
        else:
            yield entity, layer


def flattened_points(entity, tolerance):
    if entity.dxftype() == "LINE":
        raw = [entity.dxf.start, entity.dxf.end]
    else:
        raw = dxf_path.make_path(entity).flattening(distance=tolerance, segments=8)
    coordinates = []
    for point in raw:
        x, y = float(point[0]), float(point[1])
        if not math.isfinite(x) or not math.isfinite(y):
            return None
        xy = (round(x, 2), round(y, 2))
        if not coordinates or coordinates[-1] != xy:
            coordinates.append(xy)
    if len(coordinates) < 2:
        return None
    closed = entity.dxftype() == "CIRCLE" or bool(getattr(entity, "closed", False))
    if closed and len(coordinates) > 2 and coordinates[0] == coordinates[-1]:
        coordinates.pop()
    return coordinates, closed


def export_preview(source, config, out_svg, out_report, *, assume_mm=False, tolerance_mm=20):
    require_private_destination(out_svg)
    require_private_destination(out_report)
    if source.suffix.lower() != ".dxf" or out_svg.suffix.lower() != ".svg":
        raise ValueError("input must be .dxf and preview output must be .svg")
    if not math.isfinite(tolerance_mm) or tolerance_mm <= 0:
        raise ValueError("curve tolerance must be positive")
    selected, excluded = configured_layers(config)
    doc = ezdxf.readfile(source)
    unit = int(doc.header.get("$INSUNITS", 0))
    if unit != 4 and not (unit == 0 and assume_mm):
        raise ValueError("DXF $INSUNITS is not mm; unitless DXF requires explicit --assume-mm")
    existing = {layer.dxf.name.casefold() for layer in doc.layers}
    if not set(selected).union(excluded).issubset(existing):
        raise ValueError("a configured DXF layer does not exist")
    paths = {category: [] for category in COLORS}
    counts, skipped = Counter(), Counter()
    bounds = [math.inf, math.inf, -math.inf, -math.inf]
    for entity, layer in iter_geometry(doc.modelspace(), skipped, excluded=excluded):
        category = selected.get(layer.casefold())
        if category is None:
            continue
        kind = entity.dxftype()
        if kind not in GEOMETRY:
            skipped[kind] += 1
            continue
        try:
            geometry = flattened_points(entity, tolerance_mm)
        except (ValueError, TypeError, ezdxf.DXFError):
            skipped[kind] += 1
            continue
        if geometry is None:
            skipped[kind] += 1
            continue
        coordinates, closed = geometry
        for x, y in coordinates:
            bounds[0] = min(bounds[0], x)
            bounds[1] = min(bounds[1], y)
            bounds[2] = max(bounds[2], x)
            bounds[3] = max(bounds[3], y)
        paths[category].append("M" + " ".join(f"{x:g},{y:g}" for x, y in coordinates) +
                               (" Z" if closed else ""))
        counts[category] += 1
    if not any(counts.values()):
        raise ValueError("no geometry was extracted from the selected layers")
    x0, y0, x1, y1 = bounds
    width, height = max(1, x1 - x0), max(1, y1 - y0)
    stroke = max(width, height) / 3500
    out_svg.parent.mkdir(parents=True, exist_ok=True)
    with out_svg.open("w", encoding="utf-8") as output:
        output.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        output.write(f'<svg xmlns="http://www.w3.org/2000/svg" '
                     f'viewBox="{x0:g} {-y1:g} {width:g} {height:g}" role="img">\n')
        output.write("<desc>PRIVATE-CAD-PREVIEW-V1. Display-only CAD-derived geometry. "
                     "Millimetre assumption is provisional; actual route, stop, clearance, "
                     "physical scale and ETA are not verified.</desc>\n")
        output.write(f'<g transform="scale(1,-1)" fill="none" stroke-width="{stroke:g}" '
                     'stroke-linecap="round" stroke-linejoin="round">\n')
        for category, commands in paths.items():
            if commands:
                output.write(f'<path stroke="{COLORS[category]}" d="' +
                             " ".join(commands) + '"/>\n')
        output.write("</g></svg>\n")
    report = {
        "schemaVersion": "private-display-preview-v1",
        "unitsAssumed": "mm",
        "unitEvidence": "header-mm" if unit == 4 else "user-provisional",
        "sourceHeaderInsunits": unit,
        "metricScaleVerified": False,
        "referenceOriginVerified": False,
        "displayOnly": True,
        "routable": False,
        "physicalEtaAllowed": False,
        "agfLayerExclusionConfigured": True,
        "excludedDrawingLayerCount": len(excluded),
        "selectedFeatureCounts": dict(counts),
        "skippedSelectedEntityTypes": dict(skipped),
        "totalSelectedFeatures": sum(counts.values()),
        "curveToleranceMmAssumed": tolerance_mm,
        "notes": [
            "This SVG is derived from a private CAD drawing and must not be committed.",
            "The display viewBox is not an approved coordinate origin.",
            "Unresolved INSERT references and skipped entities require review.",
            "AGF drawing layers are excluded, including block inserts on those layers.",
            "A mixed equipment/AGF layer cannot be safely separated by layer filter.",
            "Layer shape is not a confirmed walkable path or AGF location.",
        ],
    }
    out_report.parent.mkdir(parents=True, exist_ok=True)
    out_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                          encoding="utf-8")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dxf", required=True, type=Path)
    parser.add_argument("--layer-config", required=True, type=Path)
    parser.add_argument("--out-svg", required=True, type=Path)
    parser.add_argument("--out-report", required=True, type=Path)
    parser.add_argument("--assume-mm", action="store_true")
    parser.add_argument("--curve-tolerance-mm", type=float, default=20)
    args = parser.parse_args(argv)
    try:
        report = export_preview(
            args.dxf, json.loads(args.layer_config.read_text(encoding="utf-8")),
            args.out_svg, args.out_report, assume_mm=args.assume_mm,
            tolerance_mm=args.curve_tolerance_mm,
        )
        print(json.dumps({k: report[k] for k in
                          ("unitsAssumed", "unitEvidence", "totalSelectedFeatures",
                           "displayOnly", "routable")}, ensure_ascii=False))
    except (ValueError, OSError, ezdxf.DXFError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
