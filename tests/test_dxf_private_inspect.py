"""Synthetic checks: unitless DXF is inspectable but cannot become a mm route map."""
from __future__ import annotations

import gzip
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

import ezdxf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from inspect_dxf_private import inspect


class TestPrivateDxfInspection(unittest.TestCase):
    def create_dxf(self, folder, insunits=0):
        output = folder / "synthetic.dxf"
        d = ezdxf.new("R2013")
        d.header["$INSUNITS"] = insunits
        d.layers.new("SYNTHETIC_GEOMETRY")
        m = d.modelspace()
        m.add_line((10, 20), (30, 40), dxfattribs={"layer": "SYNTHETIC_GEOMETRY"})
        m.add_circle((30, 35), radius=2, dxfattribs={"layer": "SYNTHETIC_GEOMETRY"})
        m.add_text("PRIVATE_NOTE", dxfattribs={"layer": "SYNTHETIC_GEOMETRY"})
        d.saveas(output)
        return output

    def test_unitless_geometry_retained_without_claiming_millimetres(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            input_file = self.create_dxf(folder, insunits=0)
            config = folder / "mapping.json"
            config.write_text(json.dumps({"categories": {"drawing-not-walkable": ["SYNTHETIC_GEOMETRY"]}}))
            output = folder / "private.json.gz"
            report = inspect(input_file, config, output)
            self.assertEqual(report["unitCode"], 0)
            self.assertEqual(report["units"], "unverified")
            self.assertFalse(report["metricScaleVerified"])
            self.assertFalse(report["originVerified"])
            self.assertEqual(report["selectedEntityCount"], 2)
            self.assertEqual(report["discardedAnnotationTypes"]["TEXT"], 1)
            with gzip.open(output, "rt", encoding="utf-8") as file:
                geometry = json.load(file)
            self.assertEqual(geometry["coordinateSystem"]["units"], "unverified")
            self.assertFalse(geometry["coordinateSystem"]["physicalDistanceAllowed"])
            self.assertEqual(geometry["geometryNature"], "selected-2d-entities-not-a-walkable-map")
            self.assertEqual(len(geometry["features"]), 2)
            self.assertEqual(geometry["features"][0]["start"], [10.0, 20.0])
            self.assertNotIn("PRIVATE_NOTE", json.dumps(geometry))

    def test_unknown_layer_rejected_without_inference(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            input_file = self.create_dxf(folder)
            config = folder / "mapping.json"
            config.write_text(json.dumps({"categories": {"walls": ["NONEXISTENT"]}}))
            with self.assertRaisesRegex(ValueError, "not found"):
                inspect(input_file, config, folder / "private.json.gz")

    def test_selected_export_requires_mapping(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            input_file = self.create_dxf(folder)
            with self.assertRaisesRegex(ValueError, "layer configuration"):
                inspect(input_file, None, folder / "private.json.gz")

    def test_geometry_output_is_compressed(self):
        with TemporaryDirectory() as temporary:
            folder = Path(temporary)
            input_file = self.create_dxf(folder)
            config = folder / "mapping.json"
            config.write_text(json.dumps({"categories": {"drawing": ["SYNTHETIC_GEOMETRY"]}}))
            with self.assertRaisesRegex(ValueError, "json.gz"):
                inspect(input_file, config, folder / "unsafe.json")


if __name__ == "__main__":
    unittest.main()
