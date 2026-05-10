# Technical Decisions

This file records the technical decisions behind the codebase: structure, module boundaries, algorithm choices, library/runtime picks. Implementation specifics (math formulas, function signatures, step-by-step algorithms) live in source-code comments. User-facing behaviour and product decisions live in [FEATURES.md](FEATURES.md). Setup and usage are in [README.md](README.md).

**your decision** = decided by the user. **Claude's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

---

## Repo Structure

```
mosaic-crochet-web/
├── core/   pure Rust logic (walk, pattern compression, highlight, drawing tools, export)
├── wasm/   Rust → WASM binding layer (src/lib.rs only; pkg/ is internal output)
├── web/    Vite + TypeScript application
└── flake.nix, Cargo.toml, package.json
```

Workspace membership is source-driven. — **your correction**

---

## Language & Runtime

- **Rust → WASM** for computation; **TypeScript** for the browser. — **your decision**
- **Nightly Rust, edition 2024** for `gen` blocks. — **your decision**
- **Vite** dev server (in-memory TS, no disk artifacts during dev). — **joint**
- **Bun** for package management. — **your decision**
- **wasm-pack `--target bundler`** + `vite-plugin-wasm`. — **Claude's choice**
- **`base: "./"` in vite.config.ts** so GitHub Pages can serve relative assets. — **Claude's choice**

---

## Package Boundaries

### `core` (Rust)
Pure logic, no WASM deps, testable with `cargo test`. Each source file's `//!` doc comment explains its own algorithm:
- `walk.rs` — row/round walk generators (gen blocks, 5-segment round structure).
- `pattern.rs` — DP-based stitch-sequence compression (LCE table, period-first + branch-and-bound splits).
- `export.rs` — 4-stage per-line export, with edge-aware preprocessing for rounds.
- `tools.rs` — symmetric paint / fill / eraser, plus the orbit walker.
- `common.rs` — highlight computation, colour utilities.

— **your decision** (typed end-to-end, line-at-a-time streaming, no strings in the export pipeline). **Claude's choice** (LCE table, edge-aware preprocess, orbit-based tools, row-eraser fix that uses each orbit cell's own y).

### `wasm`
Thin binding layer — `src/lib.rs` only. — **Claude's choice**

- **`ExportSession`** — `#[wasm_bindgen]` struct; JS owns it, calls `.next()` per line, calls `.free()`. Avoids global session state. — **your decision**
- **`symmetric_orbit_indices`** — exposes the BFS orbit walker so the TS Invert tool can dedupe orbit cells per stroke without re-implementing the walk in JS. — **Claude's choice**

### `web`
Vite + TypeScript. Imports `@mosaic/wasm` by workspace name. Module ownership:

| Module | Owns |
|---|---|
| `main.ts` | orchestration only — dirty tracking, paint/undo/save/load/export glue, per-stroke `invertVisited` set |
| `pattern.ts` | `state`, `pixels`, `highlights` |
| `render.ts` | `view` (pan / zoom / target rotation), `visualRotation`, `COLORS`, `canvas`/`ctx`; the rAF loop driving rotation animation and indicator opacity; `screenToPattern`, `fitToView`, `applyRotation`, `setRotationImmediate` |
| `gesture.ts` | pointer-event state machine (paint / pinch-pan-zoom / middle-pan) |
| `ui.ts` | toolbar wiring (tools, swatches, symmetry, popovers, dialogs) and `mountToolbarLayout` |
| `symmetry.ts` | `directlyActive` + closure logic; pure, no DOM |
| `history.ts` | undo/redo snapshot stack |
| `storage.ts` | localStorage + file save/load serialisation |
| `dom.ts` | small helpers |

— **joint** (structure); **Claude's choice** (per-module ownership of `gesture.ts` and `ui.ts`).

---

## Cross-Cutting Decisions

### Render & coordinate model
- Canvas is sized to the viewport; the pattern is positioned via `ctx.setTransform`, not via CSS transforms on the element. — **Claude's choice**
- All transforms (pan, zoom, rotation) go through ctx. The matrix is built so that the rotation pivot is the pattern centre. — **your decision** (pattern-centre pivot); **Claude's choice** (ctx-only).
- `visualRotation` (animated) is kept separate from `view.rotation` (target/persisted) so painting mid-animation hits the pixel that's actually on screen. — **Claude's choice**
- Rotation animation runs in a single rAF loop alongside the indicator opacity. — **Claude's choice**

### Gestures
Pointer-event state machine — one path for mouse, pen, touch:

| Mode | Trigger | Behaviour |
|---|---|---|
| `idle` | no pointers | hover updates status |
| `paint` | first pointer (non-middle) | paint stroke; right-click → secondary colour |
| `gesture` | second pointer arrives | pinch-zoom + pan, anchored at midpoint |
| `gesture-end` | one pointer released | latch until last is released |
| `middle-pan` | mouse middle button | pan only |

When `paint` transitions to `gesture`, the in-flight stroke is **cancelled** (reverted to pre-stroke pixels), so an accidental two-finger pan never leaves stray pixels. — **Claude's choice**

### UI layer
- `ui.ts` exposes `mountUI(callbacks): UIHandle`. Callbacks fire from DOM events; setters on the handle push state back into the DOM. No reactive framework. — **Claude's choice**
- Modals are native `<dialog>` (`showModal()` / `close(returnValue)`). Dirty-confirm decision flows through `returnValue` (`"discard"` / `"cancel"`). — **Claude's choice**
- New-pattern picker and highlight panel use the native HTML `popover` attribute. Trigger buttons carry `popovertarget` so light-dismiss skips them; click handlers `preventDefault()` the auto-toggle so the dirty-confirm flow can run before opening. — **Claude's choice**
- Swatches use a unified `bindLongPress` helper for click-to-select / long-press-to-edit on any pointer type, plus `dblclick` for desktop double-click. — **Claude's choice**

### Toolbar layout
- Two `<div class="tb-row">` wrappers around the five groups, switched between `display: contents` (wide) and full-width flex containers (narrow). — **Claude's choice**
- Breakpoints derived at runtime from each group's measured intrinsic width at two scales (full and 2/3), not hard-coded. — **Claude's choice**

### Styling
- CSS custom-property tokens (`--space-*`, `--radius-*`, `--font-*`, `--bg-*`, `--fg-*`, `--accent`, `--hit`).
- **rem** for typography/spacing; **em** for self-scaling components; **px** only for borders, shadows, and JS-set toolbar tokens; **%, fr, vw, vh, dvh** for responsive. No 62.5% root-font hack. — **your decision**
- The toolbar's `--hit` and `--font-base` are JS-set (from measured widths). Everything else uses the rem tokens. — **Claude's choice**

### Data flow & state
- Module ownership: each module owns its `let` state, exported for reading; setters for cross-module writes. — **your correction**
- Parameter passing: functions receive what they need rather than reaching into mutable module state. — **your decision**
- Symmetry mask: TS computes the closure, passes a `u8` bitmask to Rust. — **Claude's choice**
- Dirty detection: pixel-array diff against a baseline snapshot. — **your decision**
- Stroke optimisation: pre-stroke snapshot compared on stroke end; unchanged → no history entry, no session save. — **Claude's choice**
- Diagonal symmetries: integer arithmetic for `f(f(p)) = p`. — **Claude's choice**

---

## Build & CI

- `build:wasm` (wasm-pack, `--no-default-features` strips `console_error_panic_hook` from release) → `build:web` (Vite). `dev:rust` watches via `cargo-watch`. — **Claude's choice**
- `flake.nix` provides rustup, wasm-pack, bun, cargo-watch. — **joint**
- `rust-toolchain.toml`: nightly + `wasm32-unknown-unknown`. — **Claude's choice**
- GitHub Actions: push to `master` → `build:wasm` → `build:web` → deploy `web/dist/` to GitHub Pages. — **Claude's choice**; no custom packaging — **your decision**
