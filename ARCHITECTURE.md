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
- `pattern.rs` — DP compression. Public types are `Stitch` (`Sc`/`Oc`/`Ch`) and `SequenceItem { Stitch, Group, RepeatGroup }` — strings only appear at the final `to_string` emit. `compress(items)` runs directly on `&[SequenceItem]`. The subproblem table is **position-keyed** by `(start, len)` over the input — a flat `Vec<Option<(cost, Decision)>>` of size `(n+1)²` allocated per call — so cache lookups are O(1) and the DP runs in O(n³). Output tree is rebuilt at the end via back-pointer reconstruction. Uniform-run short-circuit collapses all-equal slices in O(n). — **your decision (typed end-to-end, no strings in pipeline); Claude's choice (per-call position-keyed table; cost+back-pointer; short-circuit)**
- `common.rs` — highlight computation, color utilities, `filter`/`map`
- `export.rs` — 4-stage export pipeline (virtual→physical, window, classify, group-by-parent) exposed as `export_row_at` / `export_round_at` that compute one line per call. Stitches flow through as `pattern::Stitch`; compound parent groups are wrapped as `SequenceItem::Group(inner_compressed)`. The wasm `ExportSession` calls these per `next()` rather than restarting a generator each time. — **your decision (line-at-a-time streaming, typed pipeline); Claude's choice (per-index entry points)**
- `tools.rs` — `paint_pixel`, `flood_fill`, `erase_pixel_row/round` with symmetry mask

### `wasm`
Thin binding layer. `src/lib.rs` only. `package.json` points `main`/`types` to `pkg/`. — **Claude's choice**

Key WASM-level decisions:
- **`ExportSession`** — `#[wasm_bindgen]` struct; JS owns the object, calls `.next()` to pull one line at a time from WASM heap, calls `.free()` when done. Avoids global session state. — **your decision**

### `web`
Vite + TypeScript. Imports `@mosaic/wasm` by workspace name. Modules:
- `pattern.ts` owns `state`, `pixels`, `highlights`
- `render.ts` owns `pixelSize`, `COLORS`, `canvas`/`ctx`
- `symmetry.ts` owns `directlyActive`; functions receive dimensions as parameters
- `history.ts` owns snapshot array; `historySave` / `historyUndo` / `historyRedo` take/return `Uint8Array`
- `storage.ts` is pure serialization — no orchestration

— **joint** (structure evolved through design review)

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
