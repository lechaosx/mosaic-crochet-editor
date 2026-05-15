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
- `export.rs` — 4-stage per-line export (virtual→physical, window, classify, group-by-parent).
- `tools.rs` — symmetric paint / fill / eraser / overlay / lock-invalid / pixel-preservation transfer on resize (`transfer_preserved_row` / `transfer_preserved_round`), plus the orbit walker. Each tool is a self-contained function that takes pixels in, returns new pixels out.
- `common.rs` — geometry primitives (`min_dist_axes`, `step_toward_center`, `inward_cell_*`, `outward_cells_*`, `is_always_invalid_*`), highlight computation, render-plan emission, colour utilities.

— **your decision** (typed end-to-end, line-at-a-time streaming, no strings in the export pipeline). **Claude's choice** (LCE table, orbit-based tools, row-eraser fix that uses each orbit cell's own y).

### `wasm`
Thin binding layer — `src/lib.rs` only. — **Claude's choice**

- **`ExportSession`** — `#[wasm_bindgen]` struct; JS owns it, calls `.next()` per line, calls `.free()`. Avoids global session state. — **your decision**
- **`symmetric_orbit_indices`** — exposes the BFS orbit walker so the TS Invert tool can dedupe orbit cells per stroke without re-implementing the walk in JS. — **Claude's choice**

### `web`
Vite + TypeScript. Imports `@mosaic/wasm` by workspace name. State ownership and shape:

| Module | Owns | Shape |
|---|---|---|
| `store.ts` | `SessionState` (pattern, pixels, **selection** bitset, colours, tool, primary, symmetry, settings, rotation) + derived highlight plan | **class** (`Store`) — `commit(mutate, opts?)` is the only path that runs the recompute → render → history → persist → observers chain; the invariant justifies the class |
| `main.ts` | `init()` orchestrates: constructs `Store` + `RendererState`, wires renderer/history/persistence/observers, mounts UI + gestures, keyboard. Stroke-scoped state (`preStroke`, `invertVisited`, `strokeColor`) lives in the `init()` closure | free function |
| `render.ts` | `RendererState` struct (canvas, ctx, view pan/zoom, animation state, colour cache) + `render(r, store)`, `screenToPattern(r, …)`, `fitToView(r, …)`, `clampZoom`, `updateStatus` | **free functions + state struct** — no invariants, no resources to manage |
| `gesture.ts` | pointer-event state machine. `mountGestures(r, callbacks)` takes the renderer state explicitly | free function |
| `ui.ts` | toolbar wiring (tools, swatches, symmetry, popovers, dialogs) + `mountToolbarLayout` | free function returning a `UIHandle` |
| `symmetry.ts` | pure helpers (`computeClosure`, `getSymmetryMask`, `pruneUnavailableDiagonals`); active-axis set is owned by `Store` | free functions |
| `pattern.ts` | `applyEditSettings(source?)` — pure, returns a fresh `{ pattern, pixels }` for the caller to commit | free functions |
| `history.ts` | undo/redo snapshot stack, localStorage-backed; takes/returns `SessionState` slices | free functions |
| `storage.ts` | localStorage + file save/load serialisation; takes/returns `SessionState` | free functions |
| `dom.ts` | small helpers | free functions |

— **your decision** (single-owner Store + free functions everywhere else); **Claude's choice** (specific shape of `Store.commit` opts and `RendererState`).

**Object policy:** an object (class) is only justified by an **invariant** (constraint on state that must be enforced — `Store.commit` is the only path for state mutation) or **RAII** (resource lifetime). Without one of those, prefer free functions with an explicit state argument. No module-level mutable singletons; no factory closures.

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

### Pixel encoding
- In memory: 3 values — 0 = inner hole (transparent sentinel), 1 = COLOR_A, 2 = COLOR_B. The sentinel doubles as the universal "skip this cell" guard (`!= 0`) across every tool. — **your decision**
- On disk: 1 bit per cell (A=0, B=1). Save converts at the boundary; load rebuilds the 3-value array using geometry to fill the transparent sentinel. Hole bits in storage are arbitrary. — **your decision**
- Save format `.mcw` and the `localStorage` payload are versioned. v2 = packed bits + base64. v1 (legacy `number[]` with the same 0/1/2 in-memory encoding) is still loadable; the BC path is marked in `storage.ts`. — **your decision**

### Data flow & state
- Single mutable owner: `Store` (class, in `store.ts`) owns `SessionState`. Direct mutation of `store.state` is blocked at the type level (`Readonly<SessionState>`); all writes go through `store.commit(mutate, opts?)`. — **your decision**
- `commit` runs the chain: recompute highlight plan → push history (if `history`) → render (via registered renderer) → persist (via registered persister) → run observers. Defaults: recompute on, render on, history off, persist on. — **joint**
- Observers fire after every commit and replace the boilerplate of e.g. `ui.setHistory(canUndo(), canRedo())` repeated at every mutation site. — **Claude's choice**
- Pass things in — never reach for them: every module receives its dependencies as arguments. No module-level mutable singletons; no factory closures that hide state. — **your decision**
- Renderer state is data (`RendererState` struct) operated on by free functions. The renderer has no invariant to enforce, so no class. — **joint**
- Symmetry mask: TS computes the closure, passes a `u8` bitmask to Rust. — **Claude's choice**
- Dirty detection: pixel-array diff against a baseline snapshot (`preStroke`). — **your decision**
- Stroke optimisation: pre-stroke snapshot compared on stroke end; unchanged → no history entry. — **Claude's choice**
- Diagonal symmetries: integer arithmetic for `f(f(p)) = p`. — **Claude's choice**

### TS / Rust boundary
- "No duplicated functionality between Rust and TS." Geometry, tool logic, and natural-colour rules all live exactly once, in Rust core. TS owns DOM, canvas drawing, stroke state (`invertVisited`), and presentation choices (glyph shape, colour, opacity). — **your decision**
- Each tool is a self-contained Rust function: `paint_pixel`, `flood_fill(..., selection: &[u8])`, `wand_select(..., mode, existing)`, `paint_natural_*(invert: bool)`, `paint_overlay_*` / `clear_overlay_*` (split where the gutter handling makes the two semantic actions structurally different), `lock_invalid_*`, `transfer_preserved_*` (bottom-left anchored resize preservation; row mode shifts by `(0, ΔH)`, round mode uses the corner-block / strip partition with strips bottom-anchored). TS calls the right one based on click type or operation — UI concepts like "right-click" never leak into Rust signatures; parameters describe the action's output. — **your decision**
- Selection clipping for painting tools is currently **TS-side clip-after** (revert any out-of-selection cells after the tool runs); only `flood_fill` does selection-aware writes in Rust (its BFS walker stops at unselected cells, so same-colour paths through unselected don't leak fills across selection boundaries). Moving the other painting tools' clipping into Rust per-tool is queued as a Phase 2 follow-up. — **your decision**
- Highlight render plan: Rust emits a flat `Int16Array` with stride-4 records `[type, dir, wrong_x, wrong_y]` once per paint stroke. TS renderer iterates the plan and picks glyph / colour / opacity from presentation rules — those can change without touching Rust. Per-cell highlight `Uint8Array` lives only inside Rust (used by the export pipeline). — **joint**
- Plan enum values: `PlanType` / `PlanDir` are `#[wasm_bindgen]` enums in `wasm/src/lib.rs` (autogenerates TS bindings). Core uses matching `u8` constants for the Vec<i16> writes; a compile-time `const _` assert verifies the discriminants stay in lockstep. — **joint**

---

## Build & CI

- `build:wasm` (wasm-pack, `--no-default-features` strips `console_error_panic_hook` from release) → `build:web` (Vite). `dev:rust` watches via `cargo-watch`. — **Claude's choice**
- `flake.nix` provides rustup, wasm-pack, bun, cargo-watch. — **joint**
- `rust-toolchain.toml`: nightly + `wasm32-unknown-unknown`. — **Claude's choice**
- GitHub Actions: push to `master` → `build:wasm` → `build:web` → deploy `web/dist/` to GitHub Pages. — **Claude's choice**; no custom packaging — **your decision**
