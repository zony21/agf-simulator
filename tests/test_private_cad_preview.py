"""Synthetic-only tests; never commit real drawing or derived site geometry."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import unittest
import xml.etree.ElementTree as ET

import ezdxf

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from private_cad_preview import export_preview, require_private_destination


class PrivatePreviewTests(unittest.TestCase):
    def drawing(self, folder, unit=0):
        doc = ezdxf.new("R2013")
        doc.header["$INSUNITS"] = unit
        doc.layers.new("SYN_LAYER")
        doc.layers.new("IGNORE_ME")
        ms = doc.modelspace()
        ms.add_line((10, 20), (30, 40), dxfattribs={"layer": "SYN_LAYER"})
        ms.add_circle((25, 25), 2, dxfattribs={"layer": "SYN_LAYER"})
        ms.add_text("SYNTHETIC_SECRET_LABEL", dxfattribs={"layer": "SYN_LAYER"})
        ms.add_line((5000, 5000), (6000, 6000),
                    dxfattribs={"layer": "IGNORE_ME"})
        path = folder / "fixture.dxf"
        doc.saveas(path)
        return path

    def test_explicit_mm_assumption_produces_display_only_output(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            source = self.drawing(folder)
            svg, report = folder / "preview.svg", folder / "report.json"
            result = export_preview(source, {"categories": {"architecture": ["SYN_LAYER"]}},
                                    svg, report, assume_mm=True)
            self.assertEqual(result["unitEvidence"], "user-provisional")
            self.assertFalse(result["metricScaleVerified"])
            self.assertFalse(result["referenceOriginVerified"])
            self.assertFalse(result["routable"])
            self.assertFalse(result["physicalEtaAllowed"])
            self.assertTrue(result["displayOnly"])
            self.assertEqual(result["totalSelectedFeatures"], 2)
            self.assertEqual(result["skippedSelectedEntityTypes"]["TEXT"], 1)
            data = svg.read_text(encoding="utf-8")
            ET.parse(svg)
            self.assertIn("PRIVATE-CAD-PREVIEW-V1", data)
            self.assertNotIn("SYNTHETIC_SECRET_LABEL", data)
            self.assertNotIn("SYN_LAYER", data)
            self.assertNotIn("5000", data)
            self.assertEqual(json.loads(report.read_text())["sourceHeaderInsunits"], 0)

    def test_unitless_file_without_opt_in_is_rejected(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            with self.assertRaisesRegex(ValueError, "--assume-mm"):
                export_preview(self.drawing(folder), {"categories": {"other": ["SYN_LAYER"]}},
                               folder / "preview.svg", folder / "report.json")

    def test_explicit_non_mm_header_cannot_be_overridden(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            with self.assertRaisesRegex(ValueError, "INSUNITS"):
                export_preview(self.drawing(folder, unit=1),
                               {"categories": {"other": ["SYN_LAYER"]}},
                               folder / "preview.svg", folder / "report.json",
                               assume_mm=True)

    def test_mm_header_does_not_claim_verified_scale(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            r = export_preview(self.drawing(folder, unit=4),
                               {"categories": {"equipment": ["SYN_LAYER"]}},
                               folder / "preview.svg", folder / "report.json")
            self.assertEqual(r["unitEvidence"], "header-mm")
            self.assertFalse(r["metricScaleVerified"])

    def test_no_automatic_layer_inference(self):
        with TemporaryDirectory() as temp:
            folder = Path(temp)
            with self.assertRaisesRegex(ValueError, "does not exist"):
                export_preview(self.drawing(folder),
                               {"categories": {"equipment": ["NONEXISTENT"]}},
                               folder / "preview.svg", folder / "report.json",
                               assume_mm=True)

    def test_generated_files_cannot_be_written_into_public_repository(self):
        repo = Path(__file__).resolve().parents[1]
        with self.assertRaisesRegex(ValueError, "gitignored private"):
            require_private_destination(repo / "assets" / "actual-layout.svg")
        require_private_destination(repo / "private" / "actual-layout.svg")


if __name__ == "__main__":
    unittest.main()
