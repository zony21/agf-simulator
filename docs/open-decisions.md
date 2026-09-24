# Open decisions (keep out of public fixtures)

Full customer/site requirements and CAD layouts remain outside this public repository pending publication approval.

- Exact per-line discharge timestamps and active line selection.
- Per-line pickup points and georeferenced equipment coordinates.
- Physical route graph, actual turn/stop points, individual slot-to-row map, shutter-specific stopping points and transit times. The [abstract logical map](logical-map.md) records confirmed corridor relationships but is not measured physical routing. Use the [route annotation guide](route-annotation-guide.md); do not silently promote provisional paths to confirmed geometry.
- Battery discharge by motion segment and charging travel/queue durations.
- Wrapper/labeler exact durations and blocking/interlock behavior.
- Initial magazine quantities, physical capacity and source readiness timeline.
- Transport-type priority and preemption policy.
- Final UI layout, warehouse slot coordinates and output metrics.

Use an explicit scenario schema and synthetic values until confirmed. Never silently resolve these by guessing.
