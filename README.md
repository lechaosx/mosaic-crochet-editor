# Mosaic Crochet Web

A browser-based design tool for inset mosaic crochet patterns. Draw pixel patterns, get real-time stitch validation, and export human-readable crochet instructions.

Companion to the [Aseprite plugin](../aseprite/data/extensions/aseprite-mosaic-crochet).

## Features

- Row and round mode patterns (full, half, quarter)
- Real-time highlight overlay — blue for valid overlay stitches, red for invalid placements
- Symmetry tools — vertical, horizontal, central, and diagonal axes with closure inference
- Pencil and flood fill tools
- Undo/redo, zoom, touch support
- Export to `.txt` with pattern compression

See [FEATURES.md](FEATURES.md) for details.

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

This starts both the Rust watcher and the Vite dev server in parallel. Open [http://localhost:5173](http://localhost:5173).

- **TypeScript changes** reload instantly via Vite HMR.
- **Rust changes** trigger a WASM rebuild (takes a few seconds), after which Vite reloads the page automatically.

### Production build

```sh
bun run build
```

Output is in `web/dist/`.

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via GitHub Actions. Enable Pages in the repository settings with **GitHub Actions** as the source.
