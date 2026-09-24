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

## Newly confirmed requirements

- The finished simulator must follow the CAD layout; the committed SVG is still a schematic, not a verified CAD reproduction.
- A settings screen must make simulation values editable, including independent per-line discharge intervals measured in minutes.
- Operators can reserve manual transport tasks 04 and 05 via UI buttons.
- Simulation results must be exportable to CSV.
- Primary AGF dispatch prioritizes eligible vehicles in the **destination/drop-off area**, then chooses the one with the lowest battery. **The current test harness still prefers the pickup/origin area and requires an implementation change**. Fallback when no eligible vehicle is in the destination area remains open.

## Specifications

The ten standalone documents cover overview, equipment, normal transport 01 through 05, AGF operation, the overall 2D map, and phased AGF access/lane rules. The overview defines cross-document event, configuration, and acceptance rules. Each individual specification defines its own inputs, event sequence, state, outputs, acceptance criteria, and unresolved details.

## CAD/DXF-to-JSON map pipeline

The [DXF map pipeline guide](docs/map-dxf-pipeline.md) describes exporting the source CAD to millimetre DXF with an explicit origin, mapping layers, extracting geometry with ezdxf, supplying reviewed gates/area connectivity, and optionally rasterizing a geometric grid. The converter is [tools/dxf_to_map.py](tools/dxf_to_map.py). Run synthetic-only Python tests with `python -m unittest discover -s tests -p 'test_*.py' -v` after `pip install -r requirements-map.txt`. The [private DXF inspector](tools/inspect_dxf_private.py) accepts a DXF whose unit header is unset and retains original drawing coordinates with **unverified units**. An uploaded DXF has been examined and selected CAD-native shapes extracted privately, but **mm scale, reference origin, complete block geometry and site-specific routing remain unverified**. No real CAD or derived coordinates are committed.

## DXF-free logical map

The [public-safe abstract map JSON](data/reference-logical-map.json), [schematic 2D SVG](assets/logical-map.svg), [logical map guide](docs/logical-map.md), and [conceptual path validator](src/map/logical-map.mjs) are now available. They use confirmed corridor relationships but **not measured coordinates, detailed stop/turn points or travel times**. Run `npm run check:map`. Inter-area geometry and individual warehouse slot links remain unresolved, so a physical 01–05 route engine is not yet implemented.


## Experimental interactive simulator (feature branch)

The repository includes a **scenario-driven discrete-event model** and Japanese replay UI. It is an offline, **synthetic/conceptual** simulator, not a CAD-calibrated physical or safety simulation.

Run with Node.js 22+ for tests, and serve the repository root with any static HTTP server for the UI:

    npm run check
    python -m http.server 8000

Then open http://localhost:8000/ . No frontend packages or build process are needed.

### Implemented simulation slice

- Four AGFs, two exclusive charger slots, scenario-configurable consumption and charging rates.
- Independent per-line minute intervals or an explicit external production event stream. Interval-generated events have inputKind=synthetic-interval, never PLC history.
- Task 01 → wrapper (input 1, process 1, output 2) → label → exit-ready → task 02 → explicitly declared synthetic warehouse slot. The same pallet ID persists across stages. Same-row task issuance is held and location reservations prevent overbooking.
- Task 03 only on observed magazine consumption down to the trigger, with an explicitly ready aligner and a +10 refill only on drop-off.
- UI-requested tasks 04/05 use preloaded synthetic temporary pallets; reentry/storage permission and individual destination must be explicitly supplied; duplicate reservations are rejected.
- Destination-area-first/lowest-battery selection, optional explicitly selected cross-area fallback (wait is the core default), independent low-battery comparison.
- Deterministic event history/snapshots, seek/replay, state panels, same-input mode comparison, and UTF-8 BOM events CSV with run/config metadata.

The UI's warehouse slots, initial AGF areas, production intervals, source supplies and journey/handling durations are **synthetic demo values**, not confirmed site settings. Travel duration inputs are modeled constants, not derived from CAD, route geometry, speed, interlocks or traffic. The displayed floor layout is a **conceptual diagram** with schematic AGF area markers, not the uploaded drawing.

### Private CAD preview with provisional millimetre assumption

The uploaded drawing has an unset DXF unit header. The user's current indication is that the drawing is in millimetres, so `tools/private_cad_preview.py` supports **explicit `--assume-mm` for display only**, without claiming validated scale or physical geometry. The selected source layers and SVG/report must remain outside this public repository (e.g. in `private/`). The Japanese UI can load the resulting local SVG or PNG in the map area without uploading it; schematic AGF markers are hidden while private CAD is displayed. The preview is not a navigable route graph. See [DXF pipeline](docs/map-dxf-pipeline.md).

### Not implemented or approved

Actual CAD-aligned background and coordinates, reviewed physical node/edge graph, route-dependent times, collision/traffic/shutter/interlock model, real production stream import UI, full exception recovery, runtime WCS/PLC/RCS integration, and physical charge-route timing. The map import pipeline and private inspector are intentionally separate. Only public-safe synthetic fixtures belong in this repository.


## Planned implementation

1. Confirm equipment positions and graph nodes with the user.
2. Implement discrete-event simulation with production, transport, packaging/labeling, replenishment, charging and physical occupancy.
3. Render a simplified CAD-aligned 2D SVG map. Unconfirmed routes must appear as provisional, not measured geometry.
4. Add deterministic replay, playback controls, event log, metrics, and like-for-like dispatch-mode comparison.

See the [specification index (1 overall + 9 individual documents)](docs/specification.md), [overall map specification](docs/specs/08-map.md), [DXF-free logical map](docs/logical-map.md), [DXF map pipeline guide](docs/map-dxf-pipeline.md), [AGF access and lane specification](docs/specs/09-traffic.md), [route annotation guide](docs/route-annotation-guide.md), [AGENTS.md](AGENTS.md), [harness contract](docs/harness-contract.md), and [open decisions](docs/open-decisions.md).

The public specification includes the agreed baseline simulation settings and marks provisional values explicitly. Identifying source-document titles, original drawings, site coordinates, and operational records stay outside the repository; individual scenario values remain configurable.