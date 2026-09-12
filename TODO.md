# TODO — Selection and transforms

Current implementation status and remaining work. Shipped product decisions live in [FEATURES.md](FEATURES.md); technical decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).

## Status

| Phase | State |
|---|---|
| 1 — Selection foundation | Shipped |
| 2 — Selection operations | Shipped |
| 3 — Persistent-float library | Cancelled |
| 4 — Custom symmetry axes | Shipped |
| 5 — Apply symmetry to selection | Shipped |
| 6 — Repeat grids | Next |

## Phase 6 — Repeat grids

**Ships:** bounded translation transforms for live painting and one-shot application.

- [ ] Define translation-transform state and persistence.
- [ ] Add tile width, tile height, and bounded-count controls.
- [ ] Preview grid guides before enabling live repetition.
- [ ] Replicate live paint strokes at grid offsets while preserving selection clipping.
- [ ] Reuse Phase 5's application path for one-shot repetition.
- [ ] Cap replications per action and warn before exceeding it.
- [ ] Add tests at the Rust, logic, and E2E layers affected by the implementation.
