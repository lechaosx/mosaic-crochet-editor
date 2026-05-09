# Architecture

**Your decision** = decided by you. **Claude's choice** = suggested and decided by Claude. **Joint** = discussed and decided together.

---

## Repo Structure

```
mosaic-crochet-web/
├── core/          ← pure Rust logic (walk, pattern, highlight computation)
├── wasm/          ← Rust → WASM binding layer
│   ├── Cargo.toml
│   ├── package.json   ("name": "@mosaic/wasm", points into pkg/)
│   ├── src/lib.rs     wasm-bindgen entry points only
│   └── pkg/           wasm-pack output (gitignored, internal)
├── web/           ← Vite + TypeScript application
├── Cargo.toml     ← Rust workspace (members: core, wasm)
├── package.json   ← JS workspace (members: wasm, web)
├── rust-toolchain.toml
└── flake.nix
```

Workspace membership is source-driven, not artifact-driven. `pkg/` is internal to `wasm/` and never a workspace member. — **your correction**

---

## Language & Runtime

- **Rust → WASM** for all computation; **TypeScript** for the browser surface. — **your decision** (switched from plain JS; originally ruled out TypeScript, then reconsidered)
- **Nightly Rust, edition 2024** — required for `gen` blocks. — **your decision**
- **`gen` blocks** to port Lua coroutine-based walk generators directly. — **your decision**
- **Vite** as dev server. Justified by in-memory TypeScript compilation with no disk artifacts during dev. — **joint**
- **Bun** for package management and script running. — **your decision**
- **wasm-pack `--target bundler`** — produces named ESM exports consumed directly by Vite; no init function needed, WASM loading handled automatically by `vite-plugin-wasm`. — **Claude's choice**
- **`base: "./"` in vite.config.ts** — relative asset paths so the site works on GitHub Pages subpaths. — **Claude's choice**

---

## Package Boundaries

### `core`
Pure Rust library. No WASM dependencies. Contains all domain logic: walk generators, pattern compression, highlight computation. Testable with plain `cargo test`. — **your decision** (split from wasm to enable native testing)

### `wasm`
Thin binding layer. Depends on `core`. Contains only `src/lib.rs` with wasm-bindgen entry points. `package.json` points `main` and `types` directly to `pkg/` output — justified since `pkg/` is an internal detail within the same package boundary. — **Claude's choice**

### `web`
Vite + TypeScript application. Depends on `@mosaic/wasm` by workspace name — no filesystem paths. — **joint**

---

## Rust Modules (in `core`)

### `walk.rs`
Row and round walk generators using nightly `gen` blocks. Five `Segment` structs (start, step vector, count). Round starts one pixel right of TL corner so the full corner group stays together. — **your decision**

### `pattern.rs`
Maximum-compression DP (O(n³) time, O(n²) space). Content-keyed memoization (`Vec<String>` cache key) so identical subsequences share results across all rows and rounds. `CompressMemo` newtype passed in by caller so it persists across the whole export. — **your decision** ("not overkill, this makes export faster"); content-keyed cache — **Claude's choice**

### `common.rs`
Row and round highlight computation. `filter`, `map` iterator utilities. — **your decision** ("filter and map can be moved to common")

### `export.rs`
Four-stage pipeline: virtual→physical conversion, window filter, stitch classification, group-by-parent formatting. — **your decision (pipeline structure)**

---

## TypeScript (`web/src/main.ts`)

- **Discriminated union** (`RowState | RoundState`) for pattern state — TypeScript narrows correctly when accessing round-only fields. — **Claude's choice**
- **`el<T>(id)`** typed DOM helper — avoids scattered null assertions. — **Claude's choice**
- **Symmetry closure** computed via iterative group-theory rules. — **Claude's choice**; diagonal disable condition `(W−H) % 2 ≠ 0` — **your decision**
- **Orbit computation** expands a pixel into its full orbit under enabled transforms via BFS. — **Claude's choice**
- **Diagonal transforms** use integer arithmetic to guarantee `f(f(p)) = p`. — **Claude's choice**
- **localStorage** auto-save on every stroke and new pattern. — **Claude's choice**

---

## Build Pipeline

```json
{
  "build:wasm": "wasm-pack build wasm --target bundler",
  "build:web":  "vite build web",
  "build":      "bun run build:wasm && bun run build:web",
  "dev:rust":   "cargo-watch --watch core/src --watch wasm/src -s 'wasm-pack build wasm --target bundler'",
  "dev:web":    "vite web",
  "dev":        "bun run dev:rust & bun run dev:web"
}
```

Build order is mandatory: `core` → `wasm` → `web`. `bun install` works before any build since workspace membership is based on `package.json` presence, not `pkg/` existence. — **Claude's choice**; mandatory ordering identified by — **your correction**

---

## Dev Environment

- **`flake.nix`**: rustup, wasm-pack, bun, cargo-watch. — **joint**
- **`rust-toolchain.toml`**: nightly, `wasm32-unknown-unknown`. — **Claude's choice**

---

## CI / CD

GitHub Actions: push to `master` → install deps → `build:wasm` → `build:web` → deploy `web/dist/` to GitHub Pages via `actions/deploy-pages`. — **Claude's choice**; no custom packaging step — **your decision**
