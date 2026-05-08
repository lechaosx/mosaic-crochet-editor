# Architecture

**Your decision** = decided by you. **Claude's choice** = suggested and decided by Claude. **Joint** = discussed and decided together.

---

## Language & Runtime

- **Rust → WASM** for all computation; **plain JavaScript** for the browser surface. — **your decision** (you explicitly ruled out TypeScript)
- **Nightly Rust, edition 2024** — required for `gen` blocks. — **your decision**
- **`gen` blocks** to port Lua coroutine-based walk generators directly. — **your decision**
- **Trunk** as WASM bundler and dev server. No Node, no npm, no Vite. — **joint**
- WASM bindings accessed via `window.wasmBindings`; `main.js` waits for `TrunkApplicationStarted` event. — **Claude's choice** (race-condition fix)

---

## Dependencies

- **`glam`** (`IVec2`) — Vec2 from cargo instead of a custom implementation. — **your decision**; specific crate choice — **joint**
- **`ndarray`** (`Array2<u8>`) — 2D pixel and highlight buffers. — **joint** (you noted drawing would need 2D data anyway)
- **`wasm-bindgen`** — JS/WASM interop; pixel buffers cross the boundary as flat `Uint8Array`. — **Claude's choice**

---

## Rust Modules

### `walk.rs`
Row and round walk generators. Five `Segment` structs (start, step vector, count) replacing separate corners + sides tables. — **your decision (segment structure)**. Round starts one pixel right of TL corner so the full corner group stays together. — **your decision**

### `pattern.rs`
Maximum-compression DP (O(n³) time, O(n²) space). Content-keyed memoization (`Vec<String>` cache key) so identical subsequences across all rows and rounds share results. — **Claude's choice**. Memo passed in by caller (`CompressMemo` newtype) so it persists across the whole export. — **your decision** ("not overkill, this makes export faster")

### `common.rs`
Pure row and round highlight computation. `filter`, `map` iterator utilities moved here. — **your decision** ("filter and map can be moved to common")

### `export.rs`
Four-stage pipeline: virtual→physical conversion, window filter, stitch classification, group-by-parent formatting. — **your decision (pipeline structure)**. Foundation ring detection (0 inner hole → `sc` instead of `ch`). — **Claude's choice** (documented as limitation instead, per your decision)

### `lib.rs`
wasm-bindgen entry points. Pixel buffers converted between flat `&[u8]` and `Array2<u8>`. — **Claude's choice**

---

## JavaScript (`main.js`)

Single ES module, no framework. — **your decision**

- **Symmetry closure** computed via iterative group-theory rules. — **Claude's choice**; diagonal disable condition `(W−H) % 2 ≠ 0` — **your decision**
- **Orbit computation** expands a pixel into its full orbit under enabled transforms via BFS. — **Claude's choice**
- **Diagonal transforms** use integer arithmetic to guarantee `f(f(p)) = p`. — **Claude's choice**
- **localStorage** auto-save on every stroke and new pattern. — **Claude's choice**

---

## Dev Environment

- **`flake.nix`** with rustup, trunk, cargo-watch; no Nix overlay needed. — **joint**
- **`rust-toolchain.toml`**: nightly, `wasm32-unknown-unknown`, standard components. — **Claude's choice**

---

## CI / CD

GitHub Actions: push to `master` → trunk build → deploy to GitHub Pages via `actions/deploy-pages`. Source zip attached automatically; no custom packaging step. — **your decision** (you removed the custom packaging). Cargo cache keyed by `Cargo.lock`. — **Claude's choice**
