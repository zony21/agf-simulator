# Open decisions (keep out of public fixtures)

Full customer/site requirements and CAD layouts remain outside this public repository pending publication approval.

- Each of the 8 lines has an individually editable discharge interval (minutes) on the settings screen; default interval, fractional precision, and persistence across sessions are unresolved. Input generated from intervals must not be represented as actual PLC history.
- The uploaded DXF has `$INSUNITS=0`; the user considers its model units likely mm. The display-only private preview can use an explicit mm assumption, but physical scale remains unverified until compared with a known length. The reference origin, relevant layer semantics, and unresolved INSERTs remain open. Do not derive approved mm distances or ETA from this preview.
- Per-line pickup points and georeferenced equipment coordinates.
- Physical route graph, actual turn/stop points, individual slot-to-row map, shutter-specific stopping points and transit times. The [abstract logical map](logical-map.md) records confirmed corridor relationships but is not measured physical routing. Use the [route annotation guide](route-annotation-guide.md); do not silently promote provisional paths to confirmed geometry.
- Battery discharge by motion segment and charging travel/queue durations.
- Wrapper/labeler exact durations and blocking/interlock behavior.
- Initial magazine quantities, physical capacity and source readiness timeline.
- Transport-type priority and preemption policy.
- Local dashboard layout, reservation dialog and CSV implementation are available for user review; final acceptance, persistence across browser reloads and actual warehouse slot coordinates remain open. See [dashboard implementation](ui-dashboard.md).
- Warehouse structure is confirmed at 802PL; east column 10 is empty and its traversability unresolved. Four main aisles (west two/east two) have unreviewed individual directions, lanes and passing conditions. Row side-by-side passing is prohibited.
- South of EB2: two waiting places and two distinct charging places, two charger devices, five aligners; east-main-aisle access is confirmed. Individual branches, stops, charger mapping and initial AGF physical positions remain unresolved. Empty-pallet storage below the aligners is AGF-forbidden, never a route/retreat/pickup point.
- Dispatch mode `area_first` now prioritizes eligible AGFs at the **destination/drop-off area** by lowest battery. Fallback when no eligible AGF is in that area and equal-battery tie handling need confirmation; the engine already implements destination-area priority; ID tie breaks and optional cross-area fallback remain explicit model assumptions.

Use an explicit scenario schema and synthetic values until confirmed. Never silently resolve these by guessing.
