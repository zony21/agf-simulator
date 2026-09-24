# Open decisions (keep out of public fixtures)

Full customer/site requirements and CAD layouts remain outside this public repository pending publication approval.

- Each of the 8 lines has an individually editable discharge interval (minutes) on the settings screen; default interval, fractional precision, and persistence across sessions are unresolved. Input generated from intervals must not be represented as actual PLC history.
- An uploaded DXF is available for private review, but its drawing units and reference origin have not been verified. Verify the unit/scale against a known CAD dimension, review relevant layer semantics and unresolved INSERT blocks before deriving mm coordinates or ETA.
- Per-line pickup points and georeferenced equipment coordinates.
- Physical route graph, actual turn/stop points, individual slot-to-row map, shutter-specific stopping points and transit times. The [abstract logical map](logical-map.md) records confirmed corridor relationships but is not measured physical routing. Use the [route annotation guide](route-annotation-guide.md); do not silently promote provisional paths to confirmed geometry.
- Battery discharge by motion segment and charging travel/queue durations.
- Wrapper/labeler exact durations and blocking/interlock behavior.
- Initial magazine quantities, physical capacity and source readiness timeline.
- Transport-type priority and preemption policy.
- Exact settings screen layout, 04/05 manual task-reservation interaction details, CSV column schema/file split/encoding, warehouse slot coordinates and final output metrics.
- Dispatch mode `area_first` now prioritizes eligible AGFs at the **destination/drop-off area** by lowest battery. Fallback when no eligible AGF is in that area and equal-battery tie handling need confirmation; the existing harness still uses origin-area priority pending implementation.

Use an explicit scenario schema and synthetic values until confirmed. Never silently resolve these by guessing.
