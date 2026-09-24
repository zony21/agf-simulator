"""Synthetic-only regression tests for DXF extraction and reviewed connectivity."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import sys
import unittest

import ezdxf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from dxf_to_map import build_graph, check_config, extract_dxf, make_grid


CONFIG = {
    "units": "mm",
    "originMm": {"x": 1000, "y": 2000},
    "curveToleranceMm": 5,
    "layers": {
        "walkable": ["TEST_WALK"],
        "walls": ["TEST_WALL"],
        "routeCenterlines": ["TEST_ROUTE"],
    },
}
TOPOLOGY = {
    "areas": [{"id": "A"}, {"id": "B"}],
    "gates": [{"id": "GATE", "areaIds": ["A", "B"], "status": "confirmed"}],
    "nodes": [
        {"id": "A1", "areaId": "A", "xMm": 1100, "yMm": 2050, "status": "confirmed"},
        {"id": "B1", "areaId": "B", "xMm": 1200, "yMm": 2050, "status": "confirmed"},
    ],
    "edges": [
        {
            "id": "LINK", "from": "A1", "to": "B1", "gateId": "GATE",
            "access": "allowed", "direction": "both", "status": "confirmed",
            "laneCount": 1, "simultaneousPassing": "unresolved",
        }
    ],
}


def synthetic_dxf(path, units=4):
    doc = ezdxf.new("R2013")
    doc.header["$INSUNITS"] = units
    for name in ["TEST_WALK", "TEST_WALL", "TEST_ROUTE", "IGNORED"]:
        doc.layers.new(name)
    ms = doc.modelspace()
    ms.add_lwpolyline(
        [(1000, 2000), (1300, 2000), (1300, 2200), (1000, 2200)],
        close=True, dxfattribs={"layer": "TEST_WALK"}
    )
    ms.add_line((1000, 2000), (1300, 2000), dxfattribs={"layer": "TEST_WALL"})
    ms.add_line((1100, 2050), (1200, 2050), dxfattribs={"layer": "TEST_ROUTE"})
    ms.add_text("Discard me", dxfattribs={"layer": "TEST_WALK"})
    ms.add_line((0, 0), (1, 1), dxfattribs={"layer": "IGNORED"})
    doc.saveas(path)


class TestDxfMap(unittest.TestCase):
    def test_normalize_extract_and_discard_annotations(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "synthetic.dxf"
            synthetic_dxf(path)
            result, origin = extract_dxf(path, CONFIG)
            self.assertEqual(origin, (1000.0, 2000.0))
            self.assertEqual(result["coordinateSystem"]["units"], "mm")
            self.assertEqual(result["extractionReport"]["counts"]["walkable"], 1)
            self.assertEqual(result["extractionReport"]["counts"]["walls"], 1)
            self.assertEqual(result["extractionReport"]["counts"]["routeCenterlines"], 1)
            self.assertEqual(result["extractionReport"]["discardedEntityTypes"]["TEXT"], 1)
            self.assertEqual(result["geometry"]["routeCenterlines"][0]["pointsMm"], [[100.0, 50.0], [200.0, 50.0]])
            self.assertNotIn("Discard me", json.dumps(result))

    def test_fail_unknown_units(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "synthetic.dxf"
            synthetic_dxf(path, units=0)
            with self.assertRaisesRegex(ValueError, r"INSUNITS"):
                extract_dxf(path, CONFIG)

    def test_reject_dwg_instead_of_guessing(self):
        with TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "DXF export is required"):
                extract_dxf(Path(td) / "private_input.dwg", CONFIG)

    def test_origin_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "originMm"):
            check_config({**CONFIG, "originMm": {}})

    def test_explicit_gate_topology_and_origin(self):
        graph = build_graph(TOPOLOGY, (1000, 2000))
        self.assertEqual(graph["routableEdgeIds"], ["LINK"])
        self.assertEqual(graph["nodes"][0]["xMm"], 100)
        self.assertEqual(graph["nodes"][0]["yMm"], 50)
        self.assertEqual(graph["edges"][0]["simultaneousPassing"], "unresolved")

    def test_missing_gate_rejected_for_cross_area(self):
        topology = {**TOPOLOGY, "edges": [{k: v for k, v in TOPOLOGY["edges"][0].items() if k != "gateId"}]}
        with self.assertRaisesRegex(ValueError, "requires an explicit matching gate"):
            build_graph(topology, (0, 0))

    def test_unresolved_edge_not_routable(self):
        topology = {**TOPOLOGY, "edges": [{**TOPOLOGY["edges"][0], "status": "unresolved"}]}
        result = build_graph(topology, (0, 0))
        self.assertEqual(result["routableEdgeIds"], [])
        self.assertFalse(result["edges"][0]["routable"])

    def test_grid_requires_verified_walkable_shape(self):
        geometry = {"walkable": [], "walls": []}
        config = {"cellMm": 100, "agfRadiusMm": 0, "wallHalfWidthMm": 1}
        with self.assertRaisesRegex(ValueError, "walkable"):
            make_grid(geometry, config)

    def test_pallet_location_is_not_automatically_blocked(self):
        geometry = {
            "walkable": [{"id": "W1", "kind": "polygon", "pointsMm": [[0, 0], [100, 0], [100, 100], [0, 100]]}],
            "walls": [],
            "fixtures": [],
            "equipment": [],
            "palletLocations": [{"id": "L1", "kind": "polygon", "pointsMm": [[0, 0], [100, 0], [100, 100], [0, 100]]}],
        }
        grid = make_grid(geometry, {"cellMm": 50, "agfRadiusMm": 0, "wallHalfWidthMm": 1})
        self.assertEqual(grid["cells"], [[1, 1], [1, 1]])
        self.assertIn("Pallet locations are not assumed blocked", grid["warning"])

    def test_optional_grid_geometry_only(self):
        with TemporaryDirectory() as td:
            path = Path(td) / "synthetic.dxf"
            synthetic_dxf(path)
            result, _ = extract_dxf(path, CONFIG)
            grid = make_grid(result["geometry"], {"cellMm": 50, "agfRadiusMm": 0, "wallHalfWidthMm": 2})
            self.assertEqual((grid["rows"], grid["cols"]), (4, 6))
            self.assertEqual(grid["type"], "geometric_only")
            self.assertTrue(all(v in (0, 1) for row in grid["cells"] for v in row))


if __name__ == "__main__":
    unittest.main()
