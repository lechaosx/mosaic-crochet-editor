# Technical Decisions

This file records the technical decisions behind the codebase: structure, module boundaries, algorithm choices, library/runtime picks. Implementation specifics (math formulas, function signatures, step-by-step algorithms) live in source-code comments. User-facing behaviour and product decisions live in [FEATURES.md](FEATURES.md). Setup and usage are in [README.md](README.md).

**your decision** = decided by the user. **Claude's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

---

## Repo Structure

```
mosaic-crochet-web/
├── core/   pure Rust logic (walk, pattern compression, highlight, drawing tools, export)
├── wasm/   Rust → WASM binding layer (src/lib.rs only; pkg/ is internal output)
├── logic/  pure TypeScript logic (@mosaic/logic) — no DOM, lib: ["ESNext"] enforces the boundary
├── web/    Vite + TypeScript application — I/O shell, imports @mosaic/logic and @mosaic/wasm
└── flake.nix, Cargo.toml, package.json
```

Workspace membership is source-driven. — **your correction**

Dependency direction is enforced structurally: `logic/tsconfig.json` uses `lib: ["ESNext"]` with no DOM, so any accidental import of browser APIs causes a compile-time error. `web/` imports from `logic/`; `logic/` never imports from `web/`. — **joint**

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

### `logic` (`@mosaic/logic`)
Pure TypeScript — no DOM, `lib: ["ESNext"]` enforced. All modules are free functions; `Store` is the only class (justified by the commit-chain invariant).

| Module | Owns | Shape |
|---|---|---|
| `store.ts` | `SessionState` + derived highlight plan + `visiblePixels`, `outOfBounds`, `forEachCell` helpers | **class** (`Store`) — `commit(mutate, opts?)` is the only mutation path |
| `selection.ts` | Float lift/cut/anchor/delete + `applySelectionMod` (rect / wand / select-all / deselect wrappers) | free functions |
| `clipboard.ts` | In-memory clipboard + `copyFloat` / `cutFloat` / `pasteClipboard` | free functions |
| `paint.ts` | `paintOps: Record<PaintTool, PaintFn>` — per-tool dispatch table | free functions + data |
| `symmetry.ts` | `computeClosure`, `getSymmetryMask`, `pruneUnavailableDiagonals` | free functions |
| `pattern.ts` | `applyEditSettings(settings: EditSettings, source?)` — pure; DOM-reading adapter lives in `web/src/pattern.ts` | free functions |
| `storage.ts` | `packPixels` / `unpackPixels` / `packFloat` / `unpackFloat` / `packSelection` / `unpackSelection` — serialisation only | free functions |
| `types.ts` | `PatternState`, `Float`, `Tool`, `SymKey` | types |
| `dev.ts` | `devAssert` / `assertNever` — dead-code-eliminated in production | free functions |

### `web`
Vite + TypeScript I/O shell. Imports `@mosaic/logic` and `@mosaic/wasm`.

| Module | Owns | Shape |
|---|---|---|
| `main.ts` | Boot + orchestration: constructs `Store` + `RendererState`, wires renderer/history/persistence/observers, mounts UI + gestures, dispatches keyboard. Owns the per-gesture `Gesture` union for the duration of one pointerdown→up. | free functions |
| `render.ts` | `RendererState` struct (canvas, ctx, view pan/zoom, animation state, colour cache) + `render`, `screenToPattern`, `fitToView`, `clampZoom`, `updateStatus` | free functions + state struct |
| `gesture.ts` | Pointer-event state machine. `mountGestures(r, callbacks)` takes renderer state explicitly. | free function |
| `ui.ts` | Toolbar wiring (tools, swatches, symmetry, popovers, dialogs) + `mountToolbarLayout` | free function returning `UIHandle` |
| `history.ts` | Undo/redo snapshot stack, localStorage-backed (`mosaic-history-v3`); takes/returns `SessionState` slices | free functions |
| `storage-io.ts` | `saveToLocalStorage` / `loadFromLocalStorage` / `saveToFile` / `loadFromFile` — browser I/O only | free functions |
| `pattern.ts` | DOM adapter: reads Edit popover inputs, calls `@mosaic/logic/pattern.applyEditSettings` | free function |
| `dom.ts` | Small DOM helpers (`el`, `radioValue`, `readClampedInt`) | free functions |

— **your decision** (single-owner Store + free functions everywhere else); **Claude's choice** (specific shape of `Store.commit` opts and `RendererState`).

**Object policy:** an object (class) is only justified by an **invariant** (constraint on state that must be enforced — `Store.commit` is the only path for state mutation) or **RAII** (resource lifetime). Without one of those, prefer free functions with an explicit state argument. No module-level mutable singletons; no factory closures.

**Guard policy:** asserts are the default; `if`-guards are the exception. A function's preconditions live at the *caller*, not as silent defensive returns inside. Use `devAssert` / `assertNever` (`src/dev.ts`) for anything the caller must satisfy; functions read cleaner when the body assumes a valid input and the guarantee is documented up-front. Plain `if`-guards are reserved for **documented runtime drops** that fire on legitimate user actions — off-canvas float cells, hole-cell skips, rect fully outside, paste cells past the destination canvas edge, "no clipboard / no float" early returns. Anything else is an invariant: assert it. — **your decision**

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
- **Edit popover commits before any outside input**: capture-phase `pointerdown` / `keydown` listeners on `document` explicitly `hidePopover()` the Edit popover when input lands outside it, so its `onEditClose` history push runs synchronously *before* the outside button or shortcut handler. Without this the click/keydown ordering is browser-dependent and `Undo` (etc.) could see the pre-commit head and silently drop the live preview. — **your decision**
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
- `.mcw` file format is v2 (packed bits + base64). v1 (legacy `number[]` in-memory encoding) is still loadable; the BC path is in `storage-io.ts`. Session `localStorage` is v3 (adds float serialisation). History `localStorage` is v3. — **your decision**

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
- Each tool is a self-contained Rust function: `paint_pixel`, `flood_fill(..., selection: &[u8])`, `wand_select(..., mode, existing)`, `paint_natural_*(invert: bool)`, `paint_overlay_*` / `clear_overlay_*` (split where the gutter handling makes the two semantic actions structurally different), `lock_invalid_*`, `cut_to_natural_*` (selection → natural baseline, used by the move-pixels lift step), `transfer_preserved_*` (bottom-left anchored resize preservation; row mode shifts by `(0, ΔH)`, round mode uses the corner-block / strip partition with strips bottom-anchored). TS calls the right one based on click type or operation — UI concepts like "right-click" never leak into Rust signatures; parameters describe the action's output. — **your decision**
- **Selection = float (lifted layer)**: `SessionState.float = { mask, pixels, dx, dy } | null` *is* the selection. Whenever the user selects (rect, wand, select-all) the cells are lifted off the canvas immediately — `pixels` at those cells is reset to natural baseline, the original values move to `float.pixels`, and the float renders on top of the canvas at offset `(dx, dy)`. Move-tool drag just updates `dx / dy`; nothing else has to happen until commit. Commit (deselect, tool switch, save, export, anchor-on-click-outside) writes `float.pixels` back into `pixels` at the offset position and clears the float. This collapses the older "transient `rs.float` lives only during a drag" design into a single source of truth: floats are first-class state, captured in undo snapshots and localStorage, so paste / move / undo all compose naturally. — **your decision**
- **Selection modify keeps the float's lift state.** Shift / Ctrl on rect or wand route through a single `applySelectionMod(region, mode)`, but the three modes are different:
  - `replace` anchors any active float and lifts the region fresh.
  - `add` lifts JUST the new cells into the existing float at `(canvas − offset)` source positions; existing float content / offset are preserved. Cells whose source position would fall off the W×H mask grid (only possible when the float has been dragged far enough that the new cell is unreachable in source coords) are skipped — not worth re-anchoring for a rare case.
  - `remove` stamps each overlapping cell back onto the canvas at its *current visible position* and clears the float's mask there. No anchor; the rest of the float keeps moving. — **your decision**
- **Non-destructive paste & duplicate**: `Ctrl+V` creates an *uncut* float at the clipboard's original canvas coords — `pixels` underneath is NOT modified at lift time. A regular Move-drag of that float stamps it at the destination and the source stays pristine — "paste then move" gives duplicate semantics for free. The Move tool's `Ctrl+drag` is the explicit duplicate path for *any* float: pre-stamp the float into the canvas at its current position on paintdown, then drag normally. Single history snapshot at release; the duplicate is visible the entire drag. — **your decision**
- **Copy / cut symmetry on the base image**: both `Ctrl+C` and `Ctrl+X` yank the float (bbox-bounded clipboard) AND modify the base canvas — copy stamps the float into `pixels` and keeps the float alive on top; cut clears `pixels` under the float to natural baseline and drops the float (destructive op deselects). The base-image change is the "I see this here" commitment; the yank is the "and I can paste it later." — **your decision**
- **Mask-only via Alt-drag (Move tool)**: at paintdown we (1) stamp the float into `pixels` via `visiblePixels` so the original lifted content doesn't vanish, (2) zero `float.pixels` while keeping the mask and offset, then (3) let the drag proceed normally. The empty pixels skip stamping in `visiblePixels` so only the marquee outline tracks the cursor. Release re-lifts the canvas content at the new mask position via `liftCells`. Net: original content stays where it was, marquee re-lifts the area underneath at the new position. Alt dominates Ctrl. — **your decision**
- **Move tool click-outside-float is a no-op.** The float lives across stray clicks; only explicit operations (deselect / modify-select / save-anchor / canvas-resize / Ctrl+A) end it. Earlier "anchor on outside click" was a leftover from the paste-as-free-float era; with the unified model it caused accidental commits and was removed. — **your decision**
- **Single `gesture: Gesture | null` per-stroke state**: a discriminated union over the four `paint` / `select` / `wand` / `move` kinds replaces the half-dozen separate `preStroke` / `preFloat` / `selectDrag` / `wandDrag` / `moveDrag` / `pendingMoveMode` / `strokeColor` / `invertVisited` module vars. `onPaintStart` sets it, `onPaintAt` mutates it via `gesture.kind`-narrowed access, `onPaintEnd` / `onPaintCancel` consume + clear. Invalid combinations (two drags in flight, paint mid-wand, etc.) are unrepresentable. The pre-stroke pixels/float lives on the gesture variant that needs them — paint always, wand always, move only when paintdown mutated state (duplicate's pre-stamp, mask-only's stamp + clear), select never (drag preview is renderer state). — **Claude's choice**
- **Render path is "what you see"**: `visiblePixels(s)` = `pixels` with the float stamped at offset (off-canvas / hole destinations drop). The store recomputes the highlight plan from `visiblePixels` on every commit, so ✕ / ! markers reflect the float live without a per-frame WASM rebuild. The renderer also uses `visiblePixels` for the cell draw pass, plus the shifted-mask outline for the marquee. — **your decision**
- **Move tool gating**: the Move tool (`M`) is the only tool whose drag interacts with the float (drag-anchor + offset update). Switching tools keeps the float alive — paint tools clip to its shifted mask, so the selection survives across tool changes. — **your decision**
- Selection clipping for painting tools is **TS-side clip-after on the visible canvas**: paint operates on `visiblePixels(state)` (so the user paints what they see, float included), the result is clipped against the float's shifted mask, then split — cells inside the mask are written back to `float.pixels` at source coords; cells outside stay on the canvas. Only `flood_fill` does selection-aware writes in Rust (its BFS walker stops at unselected cells, so same-colour paths through unselected can't leak across the marquee). — **your decision**
- **Edit popover bakes the float**: `onEditChange` reads the head snapshot via `historyPeek`, runs the float through `visiblePixels` to bake it into the source pixels, then passes that to `applyEditSettings` for the resize. The float itself drops on commit (mask coords no longer match the new geometry). Without baking, the lifted content would silently vanish across a resize. — **your decision**
- **Save / export keep the float alive**: `onSave` / `onExport` build a throwaway snapshot via `visiblePixels` for the file or export session; the live `store.state.float` is untouched, so the marquee survives across save. — **your decision**
- Highlight render plan: Rust emits a flat `Int16Array` with stride-4 records `[type, dir, wrong_x, wrong_y]` once per paint stroke. TS renderer iterates the plan and picks glyph / colour / opacity from presentation rules — those can change without touching Rust. Per-cell highlight `Uint8Array` lives only inside Rust (used by the export pipeline). — **joint**
- Plan enum values: `PlanType` / `PlanDir` are `#[wasm_bindgen]` enums in `wasm/src/lib.rs` (autogenerates TS bindings). Core uses matching `u8` constants for the Vec<i16> writes; a compile-time `const _` assert verifies the discriminants stay in lockstep. — **joint**
- **Invariant guards via `devAssert` / `assertNever`** (`src/dev.ts`): bounds checks that are *callable invariants* (callers must satisfy) — `commitWandAt` coords, exhaustive enum dispatch in `applySelectionMod` / `applyEditSettings` — throw in dev/test and dead-code-eliminate in production. Documented runtime drops (off-canvas float cells, hole-cell skips, rect fully outside, paste cells past dest edge) remain plain `if` guards because they fire on legitimate user actions. The split surfaces real coordinate-computation bugs early instead of letting them silently no-op via TypedArray-OOB-write semantics. — **joint**

---

## Build & CI

- `build:wasm` (wasm-pack) → `build:web` (Vite). `dev:rust` watches via `cargo-watch`. Both write to `wasm/pkg/`. — **Claude's choice**
- `@mosaic/logic` exports pure TypeScript (`store`, `selection`, `paint`, `pattern`, `symmetry`, `clipboard`, `storage` serialisation). `web/src/` keeps the I/O shell: `history.ts` (localStorage-backed undo), `storage-io.ts` (localStorage + file picker), DOM adapters. Stryker mutates only `logic/src/` — I/O paths are covered by E2E. — **joint**
- `flake.nix` provides rustup, wasm-pack, bun, cargo-watch, plus `playwright-driver.browsers` and the env vars to point Playwright at the nixpkgs-built chromium-headless-shell (downloaded binaries don't link against system libs on NixOS). — **joint**
- `rust-toolchain.toml`: nightly + `wasm32-unknown-unknown`. — **Claude's choice**
- GitHub Actions: single `ci.yml` — `test-rust` and `build-wasm` run in parallel; `test-logic`, `test-io`, and `build-app` fan out from `build-wasm`; `test-e2e` runs against the `build-app` artifact; `deploy` is gated on all test jobs and reuses the `build-app` artifact. `test-logic` runs typecheck (`tsc -p logic/tsconfig.json`) before tests, enforcing the no-DOM boundary in CI. — **Claude's choice**; no custom packaging — **your decision**

## Testing

- **Rust:** `cargo test` (156 tests). Per-tool BFS/flood/wand/cut/transfer specs live in `core/tests`; covers the geometry boundary that TS can't easily exercise.
- **Logic unit + properties:** `logic/tests/` — Vitest with `vite-plugin-wasm`, no jsdom. Covers `store`, `selection`, `paint`, `clipboard`, `symmetry`, `storage`, `pattern`, `types` + cross-feature interaction tests. `properties.test.ts` uses `fast-check` for invariants over random inputs (pack/unpack round-trips, lift-anchor identity, `applySelectionMod` add idempotence, wand BFS, history undo/redo balance). — **Claude's choice**
- **Web IO unit:** `web/tests/` — Vitest with jsdom. Covers `history.ts` (localStorage-backed undo) and `storage-io.ts` (localStorage persistence). jsdom required for `localStorage`. — **Claude's choice**
- **Logic mutation:** Stryker with the vitest runner (`bun run test:mutation`) — ~780-mutant sweep across `logic/src/`, ~20s, 81% score. The script invokes `node ./node_modules/@stryker-mutator/core/bin/stryker.js` directly: Stryker's instrumenter relies on Node's CJS-default unwrap which Bun correctly omits per the ESM spec. `nodejs` is pulled in via `flake.nix` for that reason. — **joint**
- **E2E:** Playwright (pinned to 1.59.1) drives a `vite preview` build. Tests in `web/e2e/*.spec.ts` cover boot, tools, paint, selection/move/copy/cut/paste, symmetry, edit popover, persistence (localStorage round-trip, float survives reload, undo/redo stability). `render.ts` exposes the canvas matrix on `window.__test_matrix__` so cell-relative clicks don't need to inspect view state. — **Claude's choice**
- Root `test` script chains all four: `bun run test` → cargo + logic vitest + web vitest + playwright. — **Claude's choice**
