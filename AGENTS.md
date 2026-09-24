# Agent instructions

This is a **public-safe development harness**. Read README.md, docs/specification.md, docs/specs/00-overview.md, docs/specs/08-map.md for layout or path tasks, the relevant individual specifications under docs/specs/, docs/route-annotation-guide.md for route handoffs, and docs/harness-contract.md before editing.

## Source-of-truth order

1. Explicit user-confirmed decisions in an approved project specification.
2. Source documents and CAD only where their publication is authorized.
3. docs/open-decisions.md for unresolved points.
4. Clearly marked synthetic fixtures for automated tests.

Never convert a proposal, an example trace, a screenshot guess, or a past assistant simulation into a confirmed physical fact. Do not commit confidential source files, source-document names, layout screenshots, actual site maps, customer identifiers, exact coordinates, or identifiable operational records. The explicitly approved baseline simulation settings in docs/specs/00-overview.md and docs/specs/07-agf.md are documented requirements, not permission to publish the underlying sources. Use synthetic fixtures and external approved scenarios for testing.

## Engineering rules

- Build deterministic discrete-event logic. Clock is integer milliseconds, ordered by (timeMs, sequence).
- Keep request creation, dispatch, pickup, drop-off, equipment processing, charging, and completion as distinct events.
- An event may only change state when its preconditions are satisfied. Invalid capacity, duplicate pallet, impossible causal order, or overbooked charger must fail.
- Never create a downstream transport independently of its upstream completion and equipment-ready conditions.
- Maintain individual pallet IDs, source line IDs, device IDs, and AGF IDs through the trace.
- Define battery and processing assumptions in scenario input; never silently hard-code unverified site values.
- Provisional positions and route edges must be visually labeled provisional. Do not derive travel time from unfinished route geometry. Never infer missing turns, shutter stop points, pickup positions or reverse-direction permissions from an image: ask for an annotated route or mark unresolved.
- Dispatch variants receive the *same* exogenous production stream and scenario, differing only in the selection strategy.
- Tests must cover normal and impossible events, determinism, boundary capacities, charging limits, replenishment trigger semantics, and tie breaks.
- Keep core logic independent of the UI. Render from snapshots/events, not a second timer-based simulation.
- Use Japanese user-facing UI copy; code identifiers and test names may be English.

## Definition of done

1. Document whether a changed value is source-confirmed, user-confirmed, or a provisional model assumption.
2. Add a failing regression test for corrected simulation behavior, then make it pass.
3. Run `npm run check`; report any command that could not run.
4. Do not claim throughput or timing results without a reproducible scenario, source stream, and event log.
5. Do not substitute a visual-only animation for validated simulation output.
