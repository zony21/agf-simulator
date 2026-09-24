# AGF Simulator

A development harness for a deterministic, event-driven AGF logistics simulator and a simple 2D replay UI.

**Public repository notice:** The source procurement specification and CAD drawings supplied for this project are marked confidential. Do not commit their files, screenshots, exact geometry, customer/site names, or derived operational details here. Keep the full project specification outside this public repository until its visibility and publication scope are approved.

## Current scope

This repository initially contains a **development harness**, not a finished logistics simulator. It establishes trace validation, AGF dispatch selection, synthetic test fixtures, agent instructions, and CI. The later UI can use Vue 3 + TypeScript + SVG; do not interpret the synthetic fixture as facility data.

## Run

Requires Node.js 22 or later. No dependency installation is necessary for the current harness.

```bash
npm test
npm run check:fixtures
npm run check
```

## Specifications

The ten standalone documents cover overview, equipment, normal transport 01 through 05, AGF operation, the overall 2D map, and phased AGF access/lane rules. The overview defines cross-document event, configuration, and acceptance rules. Each individual specification defines its own inputs, event sequence, state, outputs, acceptance criteria, and unresolved details.

## CAD/DXF-to-JSON map pipeline

The [DXF map pipeline guide](docs/map-dxf-pipeline.md) describes exporting the source CAD to millimetre DXF with an explicit origin, mapping layers, extracting geometry with ezdxf, supplying reviewed gates/area connectivity, and optionally rasterizing a geometric grid. The converter is [tools/dxf_to_map.py](tools/dxf_to_map.py). Run synthetic-only Python tests with `python -m unittest discover -s tests -p 'test_dxf_to_map.py' -v` after `pip install -r requirements-map.txt`. **No real site geometry or generated private map has been committed; an externally exported DXF and reviewed layer/topology inputs are still required.**

## Planned implementation

1. Confirm equipment positions and graph nodes with the user.
2. Implement discrete-event simulation with production, transport, packaging/labeling, replenishment, charging and physical occupancy.
3. Render a simplified CAD-aligned 2D SVG map. Unconfirmed routes must appear as provisional, not measured geometry.
4. Add deterministic replay, playback controls, event log, metrics, and like-for-like dispatch-mode comparison.

See the [specification index (1 overall + 9 individual documents)](docs/specification.md), [overall map specification](docs/specs/08-map.md), [DXF map pipeline guide](docs/map-dxf-pipeline.md), [AGF access and lane specification](docs/specs/09-traffic.md), [route annotation guide](docs/route-annotation-guide.md), [AGENTS.md](AGENTS.md), [harness contract](docs/harness-contract.md), and [open decisions](docs/open-decisions.md).

The public specification includes the agreed baseline simulation settings and marks provisional values explicitly. Identifying source-document titles, original drawings, site coordinates, and operational records stay outside the repository; individual scenario values remain configurable.