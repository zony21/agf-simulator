# Harness contract (public-safe)

This file describes the generic test harness, **not a facility specification**.

## Included now

- Node 22+ built-in tests, no npm dependencies.
- A pure AGF selector with `area_first` and `low_battery_first` modes. Only idle, unblocked AGFs above scenario reserve threshold are eligible.
- A deterministic validation pass over a synthetic event trace.
- Validation of line buffer, wrapper input/output, one wrapper process, AGF exclusive assignment, downstream readiness, charging slot exclusivity, and inventory refill trigger.
- Synthetic fixture and GitHub Actions CI.

## Trace event contract

Each event has `timeMs` (nonnegative integer), `sequence` (integer, strictly increasing for same timestamp), `type`, and event-specific IDs. The validator rejects out-of-order events. A transport has separate assignment, pickup and delivery events; label completion and exit readiness are separate from wrapping completion.

Supported events:
`PALLET_EXITED`, `TASK_01_ASSIGNED`, `TASK_01_PICKED`, `TASK_01_DROPPED`, `WRAP_STARTED`, `WRAP_COMPLETED`, `LABEL_COMPLETED`, `EXIT_READY`, `TASK_02_ASSIGNED`, `TASK_02_PICKED`, `TASK_02_STORED`, `CHARGE_STARTED`, `CHARGE_ENDED`, `MAGAZINE_USED`, `MAGAZINE_REFILL_REQUESTED`, `MAGAZINE_REFILLED`.

This is a *validation harness*. It does not yet schedule events, calculate trajectories, or model every transport type. Unsupported event types fail closed.

## Core invariants

1. Line count remains between 0 and configured capacity.
2. Wrapper input/output never exceed configured capacity; only one pallet wraps at a time.
3. A pallet cannot be wrapped before 01 drop-off, or assigned for 02 until labeling and exit-ready status.
4. An AGF has only one assignment or charging occupation at a time.
5. A charger is assigned to at most one AGF.
6. Replenishment request occurs only upon observed magazine quantity == configured trigger and only once per outstanding replenishment.
7. Refill is completion only, requires an outstanding request and explicit source-ready flag.
8. The entire replay is deterministic with a scenario and ordered stream.

## Not yet implemented

Event queue, travel-time engine, graph routing, task 03 full physical transfer, 04/05, battery curves, map importer, collision/interlock model, metrics and UI. Do not represent these as completed features.
