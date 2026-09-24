# Simulator specification template — public-safe

> This is a blank template, **not** the full facility specification. The original source documents and exact site layout are confidential; maintain the detailed, approval-controlled specification outside this public repository until explicitly approved for publication.

## Status ledger

For every item, declare **source-confirmed**, **user-confirmed**, **model assumption**, or **unresolved**. Identify page/decision date in the non-public specification. Never silently promote a model assumption to a source requirement.

## Purpose

2D event-replay simulator, task causal validation, performance comparison. No actual machine control.

## Sections to fill after review

1. Equipment registry and coordinates (private map asset)
2. Production input stream and trace provenance
3. Task and pallet life cycles
4. Resource and capacity limits
5. Vehicle allocation and charging modes
6. Validated route graph and travel-time evidence
7. Event schema and reproducibility constraints
8. UI, metrics, exports, and error presentation
9. Acceptance scenarios and synthetic regression tests
10. Open decisions and scope of publication

Development harness behavior is described in [harness-contract.md](harness-contract.md).
