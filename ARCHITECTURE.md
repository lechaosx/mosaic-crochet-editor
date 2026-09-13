# Technical Decisions

This file records the technical decisions behind the codebase: structure, module boundaries, algorithm choices, library/runtime picks. Implementation specifics (math formulas, function signatures, step-by-step algorithms) live in source-code comments. User-facing behaviour and product decisions live in [FEATURES.md](FEATURES.md). Setup and usage are in [README.md](README.md).

**your decision** = decided by the user. **Agent's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

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
- **wasm-pack `--target bundler`** + `vite-plugin-wasm`. — **Agent's choice**
- **`base: "./"` in vite.config.ts** so GitHub Pages can serve relative assets. — **Agent's choice**

---

## Package Boundaries

### `core` (Rust)
Pure logic, no WASM deps, testable with `cargo test`. Each source file's `//!` doc comment explains its own algorithm:
- `walk.rs` — row/round walk generators (gen blocks, 5-segment round structure).
- `pattern.rs` — DP-based stitch-sequence compression (LCE table, period-first + branch-and-bound splits).
- `export.rs` — 4-stage per-line export (virtual→physical, window, classify, group-by-parent).
- `tools.rs` — transformed paint / fill / eraser / overlay / lock-invalid / pixel-preservation transfer on resize (`transfer_preserved_row` / `transfer_preserved_round`), plus the shared symmetry-and-repeat target generator. Each tool is a self-contained function that takes pixels in, returns new pixels out.
- `common.rs` — geometry primitives (`min_dist_axes`, `step_toward_center`, `inward_cell_*`, `outward_cells_*`, `is_always_invalid_*`), highlight computation, render-plan emission, colour utilities.

— **your decision** (typed end-to-end, line-at-a-time streaming, no strings in the export pipeline). **Agent's choice** (LCE table, target-based tools, row-eraser fix that uses each target cell's own y).

### `wasm`
Thin binding layer — `src/lib.rs` only. — **Agent's choice**

- **`InstructionSession`** — `#[wasm_bindgen]` struct; JS owns it, calls `.next()` for typed row/round metadata, compressed text, yarn, and packed worked coordinates, then calls `.free()`. Avoids global session state and keeps Overview/Text on one generated sequence. — **Agent's choice**
- **`transformed_target_indices`** — exposes the shared target generator so the TS Invert tool can dedupe symmetry and repeat targets per stroke without re-implementing the transform logic in JS. — **Agent's choice**
- **`overlay_target_available_*`** — exposes Rust's inward-cell geometry so the web layer can explain unavailable Overlay targets without duplicating row/round rules. — **Agent's choice**

### `logic` (`@mosaic/logic`)
Pure TypeScript — no DOM, `lib: ["ESNext"]` enforced. All modules are free functions; `Store` is the only class (justified by the commit-chain invariant).

| Module | Owns | Shape |
|---|---|---|
| `store.ts` | `SessionState` + derived highlight plan + `visiblePixels`, `outOfBounds`, `forEachCell` helpers | **class** (`Store`) — `commit(mutate, opts?)` is the only mutation path |
| `selection.ts` | Float lift/cut/anchor/delete, transform replication, and `applySelectionMod` (rect / wand / select-all / deselect wrappers) | free functions |
| `clipboard.ts` | In-memory clipboard + `copyFloat` / `cutFloat` / `pasteClipboard` | free functions |
| `paint.ts` | `paintOps: Record<PaintTool, PaintFn>` — per-tool dispatch table | free functions + data |
| `symmetry.ts` | Axis list operations, Rust-boundary encoding, guide picking, snapping, and delete-zone geometry | free functions |
| `repeat.ts` | Repeat-grid defaults, validation, and combined transform encoding | free functions |
| `transform-evaluator.ts` | Exact quarter-turn expansion, mask-packed directional-grid evaluation, mirrored addressing, collision reporting, and source mapping | free functions |
| `pattern.ts` | `applyEditSettings(settings: EditSettings, source?)` — pure; DOM-reading adapter lives in `web/src/pattern.ts` | free functions |
| `storage.ts` | Packed pixel/float byte encodings | free functions |
| `mcw.ts` | Pure, versioned `.mcw` encode/decode and validation | free functions |
| `types.ts` | `PatternState`, `Float`, `RepeatGrid`, `Tool`, `SymKey`, `Axis` (discriminated union: V / H / D1 / D2 / C) | types |
| `dev.ts` | `devAssert` / `assertNever` — dead-code-eliminated in production | free functions |

### `web`
Vite + TypeScript I/O shell. Imports `@mosaic/logic` and `@mosaic/wasm`.

| Module | Owns | Shape |
|---|---|---|
| `main.ts` | Boot + orchestration: constructs `Store` + `RendererState`, wires renderer/history/persistence/observers, mounts UI + gestures, dispatches keyboard. Owns the per-gesture `Gesture` union for the duration of one pointerdown→up. | free functions |
| `render.ts` | `RendererState` struct (canvas, ctx, view pan/zoom, animation state, colour cache) + `render`, `screenToPattern`, `fitToView`, `clampZoom`, `updateStatus` | free functions + state struct |
| `gesture.ts` | Pointer-event state machine. `mountGestures(r, callbacks)` takes renderer state explicitly. | free function |
| `ui.ts` | Document bar, authoring dock, shared inspector, transient menus, and dialogs + responsive layout | `mountUI` returns `UIHandle` |
| `history.ts` | Undo/redo snapshot stack, localStorage-backed (`mosaic-history`); takes/returns bounded `SessionState` slices | free functions |
| `storage-io.ts` | Browser recovery storage plus file-picker/download I/O; delegates `.mcw` content to `@mosaic/logic/mcw` | free functions |
| `pattern.ts` | DOM adapter: reads Pattern inspector inputs, calls `@mosaic/logic/pattern.applyEditSettings` | free function |
| `dom.ts` | Small DOM helpers (`el`, `radioValue`, `readClampedInt`) | free functions |

— **your decision** (single-owner Store + free functions everywhere else); **Agent's choice** (specific shape of `Store.commit` opts and `RendererState`).

**Object policy:** an object (class) is only justified by an **invariant** (constraint on state that must be enforced — `Store.commit` is the only path for state mutation) or **RAII** (resource lifetime). Without one of those, prefer free functions with an explicit state argument. No module-level mutable singletons; no factory closures.

**Guard policy:** asserts are the default; `if`-guards are the exception. A function's preconditions live at the *caller*, not as silent defensive returns inside. Use `devAssert` / `assertNever` (`src/dev.ts`) for anything the caller must satisfy; functions read cleaner when the body assumes a valid input and the guarantee is documented up-front. Plain `if`-guards are reserved for **documented runtime drops** that fire on legitimate user actions — off-canvas float cells, hole-cell skips, rect fully outside, paste cells past the destination canvas edge, "no clipboard / no float" early returns. Anything else is an invariant: assert it. — **your decision**

---

## Cross-Cutting Decisions

### Render & coordinate model
- Canvas is sized to the viewport; the pattern is positioned via `ctx.setTransform`, not via CSS transforms on the element. — **Agent's choice**
- All transforms (pan, zoom, rotation) go through ctx. The matrix is built so that the rotation pivot is the pattern centre. — **your decision** (pattern-centre pivot); **Agent's choice** (ctx-only).
- `visualRotation` (animated) is kept separate from `view.rotation` (target/persisted) so painting mid-animation hits the pixel that's actually on screen. — **Agent's choice**
- Rotation animation runs in a single rAF loop alongside the indicator opacity. — **Agent's choice**

### Gestures
Pointer-event state machine — one path for mouse, pen, touch:

| Mode | Trigger | Behaviour |
|---|---|---|
| `idle` | no pointers | hover updates status |
| `paint` | first pointer (non-middle) | paint stroke; right-click → secondary colour |
| `gesture` | second pointer arrives | pinch-zoom + pan, anchored at midpoint |
| `gesture-end` | one pointer released | latch until last is released |
| `middle-pan` | mouse middle button | pan only |
| `navigate-pan` | Navigate + primary pointer, or Space + primary pointer | pan only |

When `paint` transitions to `gesture`, the in-flight stroke is **cancelled** (reverted to pre-stroke pixels), so an accidental two-finger pan never leaves stray pixels. A `pointercancel` in `paint` routes through the same rollback callback instead of the release/commit callback. — **Agent's choice**

Latched and momentary Navigate state lives in `main.ts`; `gesture.ts` receives only a predicate and keeps an in-progress pan independent of later key release. `zoomAt` is shared render-layer view math, used by gestures with a pointer anchor and by zoom buttons with the canvas centre. — **Agent's choice**

### UI layer
- `ui.ts` exposes `mountUI(callbacks): UIHandle`. Callbacks fire from DOM events; setters on the handle push state back into the DOM. No reactive framework. — **Agent's choice**
- Styled radios and checkboxes use a visually-hidden focusable input rather than `display: none`; their label or track renders the focus indicator. Tool and yarn setters update `aria-pressed` with the visual active class. — **Agent's choice**
- Export uses a native `<dialog>` and More uses a light-dismiss popover. Pattern, Selection, Mirror & Repeat, and Settings are sections in one non-modal inspector host. — **Agent's choice**
- Pattern editing is an explicit transaction. `main.ts` owns a deep-enough baseline of pattern, pixels, and float; every preview derives from that baseline and skips persistence. Apply writes one history/recovery boundary, while Cancel or Escape replaces the preview with the baseline. Capture listeners block unrelated outside commands, canvas authoring callbacks no-op during the transaction, and canvas wheel navigation remains active. — **Agent's choice**
- Canvas view controls mutate `Viewport` directly and render without project history. Rotation continues through the browser-local session preference so the renderer's existing pattern-centre animation remains the only rotation path. — **Agent's choice**
- Swatches use a unified `bindLongPress` helper for click-to-select / long-press-to-edit on any pointer type, plus `dblclick` for desktop double-click. — **Agent's choice**
- Persistent canvas context derives directly from the current `Store` and highlight plan. Rejected-action feedback is transient per-gesture UI state, coalesced before it reaches the context strip, and is not persisted. — **Agent's choice**

### Adaptive shell
- CSS Grid composes a document bar, authoring dock, canvas/status, and one inspector host. At 64rem the dock changes from a wrapping bottom row to a vertical rail and the inspector changes from a fixed bottom sheet to a grid column; the content nodes never move or duplicate. — **Agent's choice**
- The compact document-bar breakpoint derives at runtime from its two full-size groups. Below it, the existing secondary-command elements move into More without changing identity or event bindings. — **Agent's choice**

### Styling
- CSS custom-property tokens (`--space-*`, `--radius-*`, `--font-*`, `--bg-*`, `--fg-*`, `--accent`, `--hit`).
- **rem** for typography/spacing; **em** for self-scaling components; **px** only for borders and shadows; **%, fr, vw, vh, dvh** for responsive. No 62.5% root-font hack. — **your decision**
- Control hit targets use a 36 CSS-pixel token on wide fine-pointer layouts and a 44 CSS-pixel token when any coarse pointer is available or the viewport is at most 48rem wide; typography and spacing use rem tokens and reflow independently. — **Agent's choice**

### Pixel encoding
- In memory: 3 values — 0 = inner hole (transparent sentinel), 1 = COLOR_A, 2 = COLOR_B. The sentinel doubles as the universal "skip this cell" guard (`!= 0`) across every tool. — **your decision**
- On disk: 1 bit per cell (A=0, B=1). Save converts at the boundary; load rebuilds the 3-value array using geometry to fill the transparent sentinel. Hole bits in storage are arbitrary. — **your decision**
- `.mcw` file format is v2 (packed bits + base64). Pure encode/decode lives in `@mosaic/logic/mcw`; the web layer only reads and writes text. Fixture tests preserve v1 legacy `number[]` loading and v2 output, and decoding validates version, shape, dimensions, and payload length before allocation or session replacement. — **your decision** (v1/v2 compatibility); **Agent's choice** (codec boundary and validation)

### Data flow & state
- State ownership is defined by meaning rather than by its current storage container:

  | Owner | State | Persistence and history boundary |
  |---|---|---|
  | Authored document | Pattern geometry, pixels, and yarn definitions; future output/traversal settings that change generated instructions | `.mcw`; project Undo/Redo when edited |
  | Editor workspace | Active tool/yarn, selection float, transform-tool recipe and live-application mode, current inspector/context | Browser recovery as appropriate; never `.mcw` merely to recreate the editing setup |
  | Local recovery | The last recoverable authored document plus workspace state needed to resume editing | Versioned browser storage; independent of whether a project file is current |
  | Editor Undo/Redo | Reversible authored edits plus reversible workspace-tool edits such as selection and transform configuration | Separate versioned browser stack; excludes view-only state and future crochet progress |
  | Display preferences | View rotation and visibility today; future theme, yarn differentiation, handedness, focus layout, and text wrapping | Browser-local; excluded from `.mcw` and project history |
  | Live progress | Confirmed crochet progress boundary | Browser-local recovery; progress-only Back changes this boundary and it remains excluded from `.mcw` and project Undo/Redo |

  Recovery v5 physically separates document, workspace, and preferences. History v5 stores document, active selection, and the axis/repeat recipe as separate bounded fields; a future retained transform-source bitmap belongs to workspace recovery rather than every Undo snapshot. — **your decision** (ownership); **Agent's choice** (v5 envelopes)
- Browser recovery and editor history use stable `mosaic-recovery` and `mosaic-history` keys with independently versioned payloads. Existing `mosaic-pattern-v4` and unversioned `mosaic-history-v4` payloads migrate to v5 after successful decoding; the legacy recovery remains when writing its migrated replacement fails. — **Agent's choice**
- Browser recovery writes return success to `main.ts`, which owns the persistent recovery-status presentation independently from `.mcw` file I/O. — **Agent's choice**
- Single mutable owner: `Store` (class, in `store.ts`) owns `SessionState`. Direct mutation of `store.state` is blocked at the type level (`Readonly<SessionState>`); all writes go through `store.commit(mutate, opts?)`. — **your decision**
- `commit` runs the chain: recompute highlight plan → push history (if `history`) → render (via registered renderer) → persist (via registered persister) → run observers. Defaults: recompute on, render on, history off, persist on. — **joint**
- Paint preview commits set `persist: false`; the release commit writes both the single undo snapshot and the final recovery state. — **Agent's choice**
- Observers fire after every commit and replace the boilerplate of e.g. `ui.setHistory(canUndo(), canRedo())` repeated at every mutation site. — **Agent's choice**
- Pass things in — never reach for them: every module receives its dependencies as arguments. No module-level mutable singletons; no factory closures that hide state. — **your decision**
- Renderer state is data (`RendererState` struct) operated on by free functions. The renderer has no invariant to enforce, so no class. — **joint**
- Symmetry axes: `SessionState.axes: Axis[]` — a list of mirror / rotation axes, each with a kind-specific position scalar. Fresh sessions start with `[]`; the user adds axes via the Mirror & Repeat inspector (5 "+V/+H/+C/+D1/+D2" buttons) or the V/H/C/D/A keyboard shortcuts. Multiple axes of the same kind coexist (wallpaper symmetry). `symmetry.ts` compiles active axes to flat `(kind, a, b)` records via `axesToFlat`; `repeat.ts` appends the two repeat records through `transformsToFlat` before crossing into Rust. Rust builds the per-axis reflection closure first, then applies the Cartesian repeat offsets to that completed motif. The symmetry closure handles composition (V + H produces the 4-cell orbit; C isn't needed). Move-tool drag near an active guide starts an `axis-drag` gesture; `pickAxesAt` picks up to one axis per kind within the hit tolerance, so a click at an intersection grabs all crossing axes (parallel overlapping axes of the same kind get disambiguated by closeness). Each axis tracks the cursor along its own kind's projection. Release snaps to half-cell (V/H/C) or whole-cell (D1/D2). Dragging an axis to where it can no longer mirror two distinct in-canvas cells (`axisOffCanvas`) deletes it on release; the guide renders at reduced alpha while the cursor is in the dead zone. The inspector's per-axis row carries a toggle (active/inactive) and an × delete button. The authoring dock groups `g-paint` (pencil / fill / eraser / invert), `g-overlay` (overlay), `g-transform` (select / wand / move / transforms), and yarn controls. The WASM build needs `--enable-nontrapping-float-to-int` because the target generator's `f64 as i32` casts emit `i32.trunc_sat_f64_s`. — **Agent's choice** (axes refactor, inspector UX, wire encoding); **your decision** (keep C as a kind, zero-axes default, add-to-list semantics, toolbar regroup, geometric delete trigger, snap-to-half/integer, symmetry-before-repeat order)
- Repeat grid: `SessionState.repeat: RepeatGrid` stores inclusion, tile width/height, and copies per side on each axis. `SessionState.liveTransforms` independently gates whether `paintAt` passes the configured records to drawing tools; selection stamping always passes them. Repeat configuration remains session/history state through `.mcw` load and canvas resize, while the live flag is session-only workflow state. The renderer uses `transformed_target_indices` for selection previews, so sparse preview placement and application share the Rust target evaluator; source and destination claims remain sparse maps rather than canvas-sized render buffers. `renderRepeatGuides` draws dotted tile boundaries and direct distance handles; a handle drag updates the corresponding exact field continuously and commits one history snapshot on release. — **your decision** (two execution paths, state lifetime, exact preview, direct manipulation); **Agent's choice** (module, renderer, gesture placement, sparse preview storage)
- The prototype transform evaluator composes Source, exact Around-centre quarter turns, then Grid on unbounded integer cell coordinates. Rotation centres use the existing Central-axis coordinate convention; 90°/270° require matching whole/half parity while 180° also accepts edge midpoints. Zero grid spacing searches the expanded occupied mask for the nearest non-overlapping placement after cross-axis offset and local odd-instance mirroring. Results retain unique source indices and every multi-source collision coordinate. — **your decision** (pipeline, exact quarter turns, mask packing, directional counts, spacing, offsets, mirrored addressing, and collision rules); **Agent's choice** (pure evaluator contract)
- Pattern dimensions are validated in `@mosaic/logic/pattern` before Rust allocation: at most 16,777,216 canvas cells total and 1,048,576 cells on either axis. Edit, local-session restore, and `.mcw` load all use the same rule. Repeat settings are validated in `@mosaic/logic/repeat` at 4,096 configured positions. Rust separately aborts whole operations when a symmetry closure or transformed target set exceeds 1,048,576 cells, or when a repeat action exceeds 1,048,576 source-to-destination claims; tools return the original pixel buffer instead of partial output. — **your decision** (repeat ceilings); **joint** (pattern and symmetry ceilings); **Agent's choice** (validation boundaries and abort sentinel)
- Dirty detection: pixel-array diff against a baseline snapshot (`preStroke`). — **your decision**
- Stroke optimisation: pre-stroke snapshot compared on stroke end; unchanged → no history entry. — **Agent's choice**
- Diagonal symmetries: integer arithmetic for `f(f(p)) = p`. — **Agent's choice**

### TS / Rust boundary
- "No duplicated functionality between Rust and TS." Geometry, tool logic, and natural-colour rules all live exactly once, in Rust core. TS owns DOM, canvas drawing, stroke state (`invertVisited`), and presentation choices (glyph shape, colour, opacity). — **your decision**
- Each tool is a self-contained Rust function: `paint_pixel`, `flood_fill(..., selection: &[u8])`, `wand_select(..., mode, existing)`, `paint_natural_*(invert: bool)`, `paint_overlay_*` / `clear_overlay_*` (split where the gutter handling makes the two semantic actions structurally different), `lock_invalid_*`, `cut_to_natural_*` (selection → natural baseline, used by the move-pixels lift step), `transfer_preserved_*` (bottom-left anchored resize preservation; row mode shifts by `(0, ΔH)`, round mode uses the corner-block / strip partition with strips bottom-anchored). TS calls the right one based on click type or operation — UI concepts like "right-click" never leak into Rust signatures; parameters describe the action's output. — **your decision**
- **Selection = float (lifted layer)**: `SessionState.float = { x, y, w, h, pixels } | null` *is* the selection. `pixels` is the compact bounding box; zero cells are outside the marquee and non-zero cells carry lifted colours. Selecting resets those canvas cells to their natural baseline. Moving updates `x` / `y`; deselect stamps the visible cells back. Tool changes, save, and export keep the live float; save/export operate on a baked throwaway snapshot. Floats live in undo snapshots and session storage, but not `.mcw` files. — **your decision**
- One-shot transform stamping sends a canvas-sized source buffer and the combined transform records to Rust independently of `liveTransforms`. Rust resolves every destination claim before writing, rejecting conflicting colours or safety-limit overflow atomically; TS commits only copied canvas pixels, leaving the source float active. — **your decision** (atomic claim semantics and live independence); **Agent's choice** (canvas-sized boundary buffer)
- **Selection modify keeps the float's lift state.** Shift / Ctrl on rect or wand route through a single `applySelectionMod(region, mode)`, but the three modes are different:
  - `replace` anchors any active float and lifts the region fresh.
  - `add` lifts JUST the new cells into the existing float at `(canvas − offset)` source positions; existing float content / offset are preserved. Cells whose source position would fall off the W×H mask grid (only possible when the float has been dragged far enough that the new cell is unreachable in source coords) are skipped — not worth re-anchoring for a rare case.
  - `remove` stamps each overlapping cell back onto the canvas at its *current visible position* and clears the float's mask there. No anchor; the rest of the float keeps moving. — **your decision**
- **Non-destructive paste & duplicate**: `Ctrl+V` creates an *uncut* float at the clipboard's original canvas coords — `pixels` underneath is NOT modified at lift time. A regular Move-drag of that float stamps it at the destination and the source stays pristine — "paste then move" gives duplicate semantics for free. The Move tool's `Ctrl+drag` is the explicit duplicate path for *any* float: pre-stamp the float into the canvas at its current position on paintdown, then drag normally. Single history snapshot at release; the duplicate is visible the entire drag. — **your decision**
- **Copy / cut against the base image**: `Ctrl+C` copies the float without changing either layer. `Ctrl+X` copies and drops the float; it clears matching canvas cells to their natural baseline only when every float cell matches the canvas, otherwise the base canvas is unchanged. — **your decision**
- **Mask-only via Alt-drag (Move tool)**: paintdown stamps the float into `pixels` via `visiblePixels` so the original lifted content stays in place. During the drag, the float retains its mask while its pixels mirror the canvas under the translated mask, keeping the marquee visible without carrying the original content. Release re-lifts the canvas content at the new mask position via `liftCells`. Alt dominates Ctrl. — **your decision**
- **Modifier-free mask movement** is a transient UI mode rather than a persisted tool. The Mask button activates Move and supplies the existing mask-only drag mode until toggled off or another tool is selected. — **Agent's choice**
- **Move tool click-outside-float is a no-op.** The float lives across stray clicks and tool changes; deselect, modifying selection, canvas resize, file load, and select-all are the explicit operations that replace or end it. — **your decision**
- **Single `gesture: Gesture | null` per-stroke state**: a discriminated union over the four `paint` / `select` / `wand` / `move` kinds replaces the half-dozen separate `preStroke` / `preFloat` / `selectDrag` / `wandDrag` / `moveDrag` / `pendingMoveMode` / `strokeColor` / `invertVisited` module vars. `onPaintStart` sets it, `onPaintAt` mutates it via `gesture.kind`-narrowed access, `onPaintEnd` / `onPaintCancel` consume + clear. Invalid combinations (two drags in flight, paint mid-wand, etc.) are unrepresentable. The pre-stroke pixels/float lives on the gesture variant that needs them — paint always, wand always, move only when paintdown mutated state (duplicate's pre-stamp, mask-only's stamp + clear), select never (drag preview is renderer state). Wand region changes suppress history and persistence during movement; release records the resulting selection once. — **Agent's choice**
- **Render path is "what you see"**: `visiblePixels(s)` = `pixels` with the float stamped at offset (off-canvas / hole destinations drop). The store recomputes the highlight plan from `visiblePixels` on every commit, so ✕ / ! markers reflect the float live without a per-frame WASM rebuild. The renderer also uses `visiblePixels` for the cell draw pass, plus the shifted-mask outline for the marquee. — **your decision**
- **Move tool gating**: the Move tool (`M`) is the only tool whose drag interacts with the float (drag-anchor + offset update). Switching tools keeps the float alive — paint tools clip to its shifted mask, so the selection survives across tool changes. — **your decision**
- Selection clipping for painting tools is **Rust-side**: `paint_pixel`, `paint_natural_row/round`, `flood_fill` take an optional selection parameter. The WASM bindings expose it as `Option<Vec<u8>>` so JS callers pass `null` for "no selection" rather than a sentinel empty array; the binding unwraps to `&[]` for the core functions. The Invert tool clips inline in TS (pure-JS orbit loop). Overlay stays unclipped — its click-cell gate handles user intent. `flood_fill` stops BFS at unselected cells. After painting, the result is split: cells inside the float's shifted mask are written back to `float.pixels` at source coords; cells outside stay on the canvas. — **your decision**
- **Pattern preview bakes the opening float**: each preview passes the transaction baseline through `visiblePixels` before `applyEditSettings`; the preview drops the float because its mask coordinates no longer match resized geometry. — **your decision**
- **Save / Instructions keep the float alive**: `onSave` / `onInstructions` build a throwaway snapshot via `visiblePixels` for the file or instruction session; the live `store.state.float` is untouched. — **your decision**
- `core::export` derives public flat `WorkStep` records before rendering text. Each record carries its row/round identity, Yarn A/B slot, worked and parent coordinates, and stitch kind. `WorkSequence` pairs those ordered records with a renderer-independent `SequenceItem` compression tree; expanding the tree consumes the flat steps in order, while the text exporter renders the same tree without changing valid-chart output. Invalid highlights produce an unresolved draft token instead of silently becoming `sc`. — **Agent's choice**
- Instructions Overview owns a separate, non-persisted `Store`, `Viewport`, and `RendererState`. It renders the same finished-chart layers without selection or transform guides; `RendererState.focusPath` adds only the selected work path or blocker location. — **Agent's choice**
- Overview and Live move one Instructions canvas between their layouts, so both use the same preview store, renderer, and focus-path representation. `live-progress.ts` stores a versioned completed-unit count under `mosaic-live-progress`, keyed by a 64-bit fingerprint of every unit's label, yarn, text, and worked coordinates; a nonmatching or invalid record starts at the first unit. — **Agent's choice**
- Highlight render plan: Rust emits a flat `Int16Array` with stride-4 records `[type, dir, wrong_x, wrong_y]` once per paint stroke. TS renderer iterates the plan and picks glyph / colour / opacity from presentation rules — those can change without touching Rust. Per-cell highlight `Uint8Array` lives only inside Rust (used by the export pipeline). — **joint**
- Plan enum values: `PlanType` / `PlanDir` are `#[wasm_bindgen]` enums in `wasm/src/lib.rs` (autogenerates TS bindings). Core uses matching `u8` constants for the Vec<i16> writes; a compile-time `const _` assert verifies the discriminants stay in lockstep. — **joint**
- **Invariant guards via `devAssert` / `assertNever`** (`src/dev.ts`): bounds checks that are *callable invariants* (callers must satisfy) — `commitWandAt` coords, exhaustive enum dispatch in `applySelectionMod` / `applyEditSettings` — throw in dev/test and dead-code-eliminate in production. Documented runtime drops (off-canvas float cells, hole-cell skips, rect fully outside, paste cells past dest edge) remain plain `if` guards because they fire on legitimate user actions. The split surfaces real coordinate-computation bugs early instead of letting them silently no-op via TypedArray-OOB-write semantics. — **joint**

---

## Build & CI

- `build:wasm` (wasm-pack) writes `wasm/pkg/`; `build:web` type-checks and writes the Vite bundle to `web/dist/`. `dev:rust` watches via `cargo-watch`. — **Agent's choice**
- `@mosaic/logic` exports pure TypeScript (`store`, `selection`, `paint`, `pattern`, `symmetry`, `repeat`, `clipboard`, packed storage, and the `.mcw` codec). `web/src/` keeps the I/O shell: `history.ts` (localStorage-backed undo), `storage-io.ts` (localStorage + file picker), DOM adapters. Stryker mutates only `logic/src/` — I/O paths are covered by E2E. — **joint**
- `flake.nix` provides rustup, wasm-pack, bun, cargo-watch, plus `playwright-driver.browsers` and the env vars to point Playwright at the nixpkgs-built chromium-headless-shell (downloaded binaries don't link against system libs on NixOS). — **joint**
- `rust-toolchain.toml`: nightly + `wasm32-unknown-unknown`. — **Agent's choice**
- GitHub Actions: single `ci.yml` — `test-rust` enforces rustfmt and reports Clippy warnings before running Rust tests; warnings do not fail CI because floating nightly toolchains can introduce new lints. `build-wasm` runs in parallel; `test-logic`, `test-io`, and `build-app` fan out from `build-wasm`; `test-e2e` runs against the `build-app` artifact; `deploy` is gated on all test jobs and reuses the `build-app` artifact. `test-logic` runs typecheck (`tsc -p logic/tsconfig.json`) before tests, enforcing the no-DOM boundary in CI. — **Agent's choice** (workflow shape); **your decision** (warning policy and no custom packaging)

## Testing

- **Rust:** `cargo test`. Per-tool BFS/flood/wand/cut/transfer specs cover the geometry boundary that TS cannot easily exercise. — **Agent's choice**
- **Logic unit + properties:** `logic/tests/` — Vitest with `vite-plugin-wasm`, no jsdom. Covers `store`, `selection`, `paint`, `clipboard`, `symmetry`, `repeat`, `storage`, `pattern`, `types` + cross-feature interaction tests. `properties.test.ts` uses `fast-check` for invariants over random inputs (pack/unpack round-trips, lift-anchor identity, `applySelectionMod` add idempotence, wand BFS, history undo/redo balance). — **Agent's choice**
- **Web IO unit:** `web/tests/` — Vitest with jsdom. Covers `history.ts` (localStorage-backed undo) and `storage-io.ts` (localStorage persistence). jsdom required for `localStorage`. — **Agent's choice**
- **Logic mutation:** Stryker with the Vitest runner (`bun run test:mutation`) mutates `logic/src/`. The September 2026 baseline is 1,167 mutants, 87.75% total mutation score, and 87.90% among covered mutants; every mutated module scores above 80%. Node executes Stryker because its instrumenter relies on CommonJS default-import unwrapping that Bun does not provide; `flake.nix` supplies Node for this script. — **joint** (runner); **Agent's choice** (recorded baseline)
- **E2E:** Playwright (pinned to 1.59.1) drives `vite preview`. Desktop Chromium covers the adaptive shell, tools, paint, selection/move/copy/cut/paste, symmetry/repeat, Pattern transactions, and persistence; a Pixel 7 Chromium project covers single-finger paint, two-finger pan/zoom cancellation, and modifier-free mask movement. `render.ts` exposes the canvas matrix on `window.__test_matrix__` so cell-relative input does not need to inspect view state. — **Agent's choice**
- Root `test` builds WASM and the production web bundle before running cargo, logic Vitest, web Vitest, and Playwright. Root subset scripts build the generated artifacts they consume. — **Agent's choice**
