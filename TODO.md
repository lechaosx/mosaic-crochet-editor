# TODO — Selection and transforms

Current implementation status and remaining work. Shipped product decisions live in [FEATURES.md](FEATURES.md); technical decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).

## Status

| Phase | State |
|---|---|
| 1 — Selection foundation | Shipped |
| 2 — Selection operations | Shipped |
| 3 — Persistent-float library | Cancelled |
| 4 — Custom symmetry axes | Shipped |
| 5 — Apply symmetry to selection | Next |
| 6 — Repeat grids | Waiting on Phase 5 |

## Phase 5 — Apply symmetry to selection

**Ships:** a one-shot action that replicates selected pixels through the active symmetry axes.

- [ ] Decide the conflict rule when different source cells map to the same destination.
- [ ] For every selected cell, walk its orbit through the active axes and copy its value to valid destination cells.
- [ ] Skip inner-hole destinations and define how off-canvas source cells behave.
- [ ] Add the action to the selection UI and assign a keyboard shortcut.
- [ ] Commit the whole operation as one undo snapshot.
- [ ] Add Rust tests for orbit application, logic tests for selection/float state, and Playwright coverage for the user flow.
- [ ] Update README, FEATURES, and ARCHITECTURE with the shipped behavior and attributed decisions.

## Phase 6 — Repeat grids

**Ships:** bounded translation transforms for live painting and one-shot application.

- [ ] Define translation-transform state and persistence.
- [ ] Add tile width, tile height, and bounded-count controls.
- [ ] Preview grid guides before enabling live repetition.
- [ ] Replicate live paint strokes at grid offsets while preserving selection clipping.
- [ ] Reuse Phase 5's application path for one-shot repetition.
- [ ] Cap replications per action and warn before exceeding it.
- [ ] Add tests at the Rust, logic, and E2E layers affected by the implementation.

## Cross-cutting backlog

### Touch interaction

- [ ] Choose a discoverable modifier-free equivalent of mask-only move for touch.
- [ ] Add a mobile-browser Playwright project for the supported touch flows. Current E2E coverage is desktop Chromium only.

### Symmetry bounds

- [ ] Define supported maximum canvas dimensions.
- [ ] Add an orbit-iteration safety cap before exposing substantially larger canvases. The current orbit is bounded by the number of canvas cells, but multiple interacting axes can traverse the whole canvas.
