# Mosaic Crochet Web

A browser-based design tool for inset mosaic crochet patterns. Draw pixel patterns, get real-time stitch validation, and export human-readable crochet instructions.

**▶ [Try it now](https://lechaosx.github.io/mosaic-crochet-editor/)** — no install, runs in your browser.

Companion to the [Aseprite plugin](../aseprite/data/extensions/aseprite-mosaic-crochet).

For decisions and rationale, see [FEATURES.md](FEATURES.md) (product) and [ARCHITECTURE.md](ARCHITECTURE.md) (technical).

---

## Using the app

### Patterns

Click **New** to create a fresh pattern. Two modes:

- **Row** — a rectangular grid worked row by row. Set width and height.
- **Round** — concentric rounds worked from the outside in. Set inner width / height / rounds, plus a sub-mode:
  - **Full** — all four sides.
  - **Half** — bottom half only; the pattern folds at the inner-hole boundary.
  - **Quarter** — bottom-left quarter; folds at both inner-hole boundaries.

Settings update the canvas live. Closing the popover keeps your changes. If you have unsaved work, you'll be asked to discard or cancel first.

### Drawing

Four tools, in the toolbar's tools group:

- **Pencil** — paint the active colour.
- **Fill** — flood-fill a connected region.
- **Eraser** — restore pixels to the underlying alternating colour.
- **Invert** — flip pixels between primary and secondary on draw. Within one stroke, no pixel is inverted twice.

All four respect the active symmetries. The eraser restores each mirrored pixel to *its own* natural colour, not the click point's.

**Mouse:** left click paints with the primary colour, right click paints with the secondary.
**Touch / pen:** single-finger drag paints with the primary colour. Selecting the secondary swatch (tap it, or press **2**) paints with the secondary instead.

A blue overlay marks valid overlay-stitch positions; red marks invalid placements. Both update as you draw.

### Symmetry

Five axes — **↔ Vertical**, **↕ Horizontal**, **⊕ Central**, **╲ Diagonal**, **╱ Anti-diagonal** — toggled from the symmetry group. Active axes are drawn as dashed lines on the canvas.

Two axes that imply a third turn the third on automatically (closure inference). Directly toggled axes display brightly; closure-implied ones are dimmed. Diagonals are unavailable when `(W − H)` is odd.

### Colours

Two swatches: primary (left) and secondary (right). Click to select; double-click or long-press to edit the colour. The active swatch has a glowing outline.

### Highlights

The **⊙** button opens a popover where you can change the overlay colour, the invalid-placement colour, and the highlight opacity.

### Zoom, pan, rotation

- **Zoom**: scroll wheel (anchored at the cursor) or two-finger pinch on touch (anchored at the gesture midpoint). Auto-fits to the viewport on every new pattern, file load, or refresh — including when the pattern is rotated.
- **Pan**: middle-mouse drag, or two-finger drag on touch.
- **Rotate**: ↺ / ↻ buttons. Rotates ±45° around the pattern centre with a 250 ms animation. A small accent triangle near the top edge of the pattern fades in during the animation so you can tell which way is "up".

### Saving

- **Save** downloads the pattern as a `.mcw` file (JSON). Modern browsers (Chrome/Edge) open a save dialog; Firefox downloads immediately.
- **Load** opens a file picker and restores the entire pattern, including colours and symmetry.
- **Export** opens a modal where the pattern is converted to text line-by-line. Toggle **Alternate direction** to flip the work direction. Copy or download the result.

Tool, colour, symmetry, rotation, and pixel state auto-save to `localStorage` and restore on refresh.

### Keyboard shortcuts

| Action | Key |
|---|---|
| Pencil / Fill / Eraser / Invert | **P** / **F** / **E** / **I** |
| Vertical / Horizontal / Central symmetry | **V** / **H** / **C** |
| Diagonal ╲ / Anti-diagonal ╱ | **D** / **A** |
| Rotate clockwise / counter-clockwise | **R** / **Shift+R** |
| Select primary / secondary swatch | **1** / **2** |
| Undo / Redo | **Ctrl+Z** / **Ctrl+Y** (or **Ctrl+Shift+Z**) |

Every button has a hover label that shows the same info.

---

## Running locally

### Prerequisites

- [Nix](https://nixos.org/) with flakes enabled

### First-time setup

```sh
# Enter the dev shell (installs rustup, wasm-pack, bun, cargo-watch)
nix develop

# Install the nightly Rust toolchain
rustup toolchain install nightly

# Install JS dependencies
bun install
```

### Development

```sh
bun run dev
```

Starts the Rust watcher and the Vite dev server in parallel. Open [http://localhost:5173](http://localhost:5173).

- TypeScript changes reload instantly via Vite HMR.
- Rust changes trigger a WASM rebuild (a few seconds), after which Vite reloads the page.

### Tests

```sh
cargo test
```

Runs the pure-Rust unit tests in `core/` (highlight computation, walk generators, pattern compression).

### Production build

```sh
bun run build
```

Output is in `web/dist/`.

### Deployment

Pushes to `master` automatically deploy to GitHub Pages via GitHub Actions. Enable Pages in the repo settings with **GitHub Actions** as the source.
