# Architecture

**Your decision** = decided by you. **Claude's choice** = suggested and decided by Claude. **Joint** = discussed and decided together.

---

## Repo Structure

```
mosaic-crochet-web/
├── core/          ← pure Rust logic (walk, pattern, highlight computation, drawing tools)
├── wasm/          ← Rust → WASM binding layer
│   ├── Cargo.toml
│   ├── package.json   ("name": "@mosaic/wasm")
│   ├── src/lib.rs     wasm-bindgen entry points only
│   └── pkg/           wasm-pack output (gitignored, internal)
├── web/           ← Vite + TypeScript application
│   └── src/
│       ├── main.ts      orchestration and event wiring
│       ├── pattern.ts   WASM calls, pattern state
│       ├── render.ts    canvas rendering, pixel size, colors
│       ├── symmetry.ts  closure computation, orbit, button state
│       ├── history.ts   undo/redo stack
│       ├── storage.ts   localStorage + file save/load
│       ├── types.ts     shared TypeScript types
│       └── dom.ts       el(), inputValue(), inputInt()
├── Cargo.toml     ← Rust workspace (core, wasm)
├── package.json   ← JS workspace (wasm, web)
├── rust-toolchain.toml
└── flake.nix
```

Workspace membership is source-driven, not artifact-driven. `pkg/` is internal to `wasm/`. — **your correction**

---

## Language & Runtime

- **Rust → WASM** for computation; **TypeScript** for the browser. — **your decision**
- **Nightly Rust, edition 2024** — required for `gen` blocks. — **your decision**
- **Vite** as dev server — in-memory TypeScript compilation, no disk artifacts during dev. — **joint**
- **Bun** for package management. — **your decision**
- **wasm-pack `--target bundler`** — named ESM exports, WASM loading via `vite-plugin-wasm`. — **Claude's choice**
- **`base: "./"` in vite.config.ts** — relative asset paths for GitHub Pages. — **Claude's choice**

---

## Package Boundaries

### `core`
Pure Rust. No WASM dependencies. Walk generators, pattern compression, highlight computation, symmetric paint/fill/erase. Testable with `cargo test`. — **your decision**

Key modules:
- `walk.rs` — `row_walk_at(size, row_index)` / `round_walk_at(size, rounds, round)` produce a single row/round using nightly `gen` blocks, 5-segment structure for rounds. — **your decision (generators); Claude's choice (per-index entry points)**
- `pattern.rs` — DP compression. Public types are `Stitch` (`Sc`/`Oc`/`Ch`) and `SequenceItem { Stitch, Group, RepeatGroup }` — strings only appear at the final `to_string` emit. `compress(items)` runs directly on `&[SequenceItem]`. Per call: (1) build an `n × n` LCE table where `lce[i, j]` = longest shared prefix between `items[i..]` and `items[j..]`, filled bottom-up via `lce(i,j) = items[i]==items[j] ? 1 + lce(i+1,j+1) : 0`; (2) iterative bottom-up DP filling cost/decision tables in increasing `len` order, indexed by `start * (n+1) + len`. Each cell first applies a uniformity short-circuit (`lce(start, start+1) >= len-1` → cost 1, period 1) which keeps long uniform runs (e.g. an all-sc edge) at O(n²). Otherwise periodicity check is one LCE read per period (O(1)), so the period loop is O(L); splits run after periods with branch-and-bound, skipping when `cost(left) >= best_cost`. Overall O(n³) with a tight constant. Output tree is rebuilt via back-pointer reconstruction. — **your decision (typed end-to-end, no strings in pipeline); Claude's choice (LCE table; iterative bottom-up; period-first + B&B splits; uniformity short-circuit)**
- `common.rs` — highlight computation, color utilities, `filter`/`map`
- `export.rs` — 4-stage export pipeline (virtual→physical, window, classify, group-by-parent) exposed as `export_row_at` / `export_round_at` that compute one line per call. Stitches flow through as `pattern::Stitch`; compound parent groups are wrapped as `SequenceItem::Group(inner_compressed)`. `export_round_at` additionally does **edge-aware preprocessing**: a stretch of consecutive single-stitch groups is one "edge" between corner increases, and each edge is compressed in isolation so its internal runs collapse to `RepeatGroup` tokens before reaching the top-level DP. For a typical sc-only round the top-level then sees ~8 items (4 edges + 4 corners) instead of ~4·E + 4 raw stitches, dropping round-100 export from ~1.6 s to ~60 µs. The wasm `ExportSession` calls these per `next()` rather than restarting a generator each time. — **your decision (line-at-a-time streaming, typed pipeline); Claude's choice (per-index entry points; edge-aware per-edge compress)**
- `tools.rs` — `paint_pixel`, `flood_fill`, `erase_pixel_row/round` with symmetry mask

### `wasm`
Thin binding layer. `src/lib.rs` only. `package.json` points `main`/`types` to `pkg/`. — **Claude's choice**

Key WASM-level decisions:
- **`ExportSession`** — `#[wasm_bindgen]` struct; JS owns the object, calls `.next()` to pull one line at a time from WASM heap, calls `.free()` when done. Avoids global session state. — **your decision**

### `web`
Vite + TypeScript. Imports `@mosaic/wasm` by workspace name. Modules:
- `main.ts`     orchestration only — dirty tracking, paint/undo/redo/save/load/export glue
- `pattern.ts`  owns `state`, `pixels`, `highlights`
- `render.ts`   owns `view` (`panX`, `panY`, `zoom`, `rotation`), `COLORS`, `canvas`/`ctx`; renders via `ctx.setTransform(matrix)` on a viewport-sized canvas; provides `screenToPattern` and `fitToView`
- `gesture.ts`  pointer-event gesture state machine (paint / pinch-pan-zoom / middle-pan)
- `ui.ts`       all toolbar wiring (tools, swatches, swap, symmetry, highlights popover, new-pattern popover, rotate, dialogs); exposes `mountUI` returning a `UIHandle` of state-update setters
- `symmetry.ts` owns `directlyActive`; functions receive dimensions as parameters; pure logic only, no DOM
- `history.ts`  owns snapshot array; `historySave` / `historyUndo` / `historyRedo` take/return `Uint8Array`
- `storage.ts`  pure serialisation — no orchestration, no DOM

— **joint** (structure); **Claude's choice** (per-module ownership of `gesture.ts` and `ui.ts`)

### Render & Coordinate Model

- The `<canvas>` is sized to the viewport (CSS 100% × 100% inside `.canvas-area`, with backing store at `rect × devicePixelRatio`). — **Claude's choice**
- **Hybrid transform**: pan + zoom go through `ctx.setTransform(matrix)`; rotation goes through CSS `transform: rotate(…deg)` on the canvas element with a 250 ms transition. This buys a free, GPU-accelerated rotation animation. The cost is one inverse-rotation step (`rotateDeltaIntoInternal`) when converting client-space gesture deltas to canvas-internal pan. — **joint** (your call to use CSS for rotation; Claude's design of the inverse-rotation helper)
- `view` holds `panX`, `panY` (CSS px in canvas-internal coords), `zoom` (CSS px per pattern pixel), and `rotation` (degrees). The single forward `DOMMatrix` collapses scale + pan + dpr. `screenToPattern` inverse-rotates the cursor offset around canvas centre, then applies the matrix inverse. — **Claude's choice**
- A small triangle is drawn above y=0 in pattern coords as a top-of-pattern indicator; it rotates with the canvas through the same CSS transform. `fitToView` reserves ~1.8 pattern pixels above y=0 for it and shifts pan down so the union (pattern + indicator) stays centred. — **Claude's choice**
- `setRotationImmediate()` restores rotation on session load by temporarily disabling the CSS transition for one frame so the page doesn't spin from 0° on every refresh. — **Claude's choice**
- `ResizeObserver(canvas)` rebinds the backing store and re-renders on layout/DPR changes. — **Claude's choice**

### Gestures

`gesture.ts` is a small pointer-event state machine:

| Mode           | Trigger                                          | Behaviour                                  |
|----------------|--------------------------------------------------|--------------------------------------------|
| `idle`         | no active pointers                               | hover updates status                       |
| `paint`        | first non-middle pointer down                    | paint stroke; right-click → secondary col. |
| `gesture`      | second pointer down (during `paint` or `idle`)   | pinch-zoom + pan, anchored at midpoint     |
| `gesture-end`  | one of two pointers released                     | latch until last pointer also released     |
| `middle-pan`   | mouse middle button down                         | pan only                                   |

Wheel zoom is anchored at the cursor; pinch zoom is anchored at the two-finger midpoint. The pan correction `panX_new = dx − f·(dx − panX)` is rotation-invariant since uniform scale commutes with rotation. — **Claude's choice**

### UI Layer

- `ui.ts` exposes `mountUI(callbacks): UIHandle`. Callbacks fire from DOM events; the handle's setters are called by `main.ts` to push state into the DOM (active tool, history-button enabled state, symmetry highlight/implied state, etc.). No reactive framework. — **Claude's choice**
- Modals are native `<dialog>` (`showModal()` / `close(returnValue)`) with backdrop click-to-close. The dirty-confirm dialog returns its decision via `returnValue` (`"discard"` / `"cancel"`). — **Claude's choice**
- The new-pattern picker and the highlight settings panel use the native HTML `popover` attribute, which provides light-dismiss for free. JS sets fixed-position coords against the anchor button on each open. — **Claude's choice**
- A unified `bindLongPress(el, onClick, onLong)` helper drives swatch click-to-select / long-press-to-edit on mouse, pen, and touch via pointer events. — **Claude's choice**

### Styling

`web/src/style.css` is built around CSS custom-property design tokens (`--space-*`, `--radius-*`, `--font-*`, `--bg-*`, `--fg-*`, `--accent`, `--hit`). Sizing rules:

- **rem** for typography and spacing tokens
- **em** within self-scaling components
- **px** only for borders and shadows
- **%, fr, vw, vh, dvh** for responsive layout
- **clamp()** for fluid hit targets (`--hit: clamp(2.25rem, 6vw, 2.75rem)`)
- No 62.5% root-font hack

— **your decision (units)**

---

## Key Design Decisions

- **Module ownership**: each module declares its own `let` state, exported for reading; setters provided for cross-module writes. — **your correction**
- **Parameter passing**: functions receive what they need (state dimensions, closure set) rather than importing mutable state directly. — **your decision**
- **Symmetry mask**: TypeScript computes the closure, converts to a `u8` bitmask, passes to Rust tools. — **Claude's choice**
- **Dirty detection**: computed by diffing `pixels` against `baselinePixels` snapshot, not a stored boolean. Drawing and erasing back to original = clean. — **your decision**
- **Stroke optimization**: pre-stroke snapshot compared on mouseup; if unchanged, no history entry and no session save. — **Claude's choice**
- **Diagonal transforms**: integer arithmetic (`floor((W−H)/2)` offset) guarantees `f(f(p)) = p`. Diagonals disabled when `(W−H) % 2 ≠ 0`. — **your decision (condition); Claude's choice (algorithm)**

---

## Build Pipeline

```json
{
  "build:wasm": "wasm-pack build wasm --target bundler --no-default-features",
  "build:web":  "bun run --cwd web build",
  "build":      "bun run build:wasm && bun run build:web",
  "dev:rust":   "cargo-watch ... 'wasm-pack build wasm --target bundler --dev'",
  "dev:web":    "bun run --cwd web dev"
}
```

`--dev` flag keeps debug symbols, skips `wasm-opt`, compiles faster. `--no-default-features` strips `console_error_panic_hook` from release builds. — **Claude's choice**

---

## Dev Environment

- **`flake.nix`**: rustup, wasm-pack, bun, cargo-watch. — **joint**
- **`rust-toolchain.toml`**: nightly, `wasm32-unknown-unknown`. — **Claude's choice**

---

## CI / CD

GitHub Actions: push to `master` → `build:wasm` → `build:web` → deploy `web/dist/` to GitHub Pages. — **Claude's choice**; no custom packaging — **your decision**
