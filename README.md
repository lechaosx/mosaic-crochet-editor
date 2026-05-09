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

### Steps

```sh
git clone <repo>
cd mosaic-crochet-web

# Enter the dev shell (installs rustup, wasm-pack, bun, cargo-watch)
nix develop

# Install the nightly Rust toolchain (first time only)
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown

# Install JS dependencies
bun install

# Build the WASM package
bun run build:wasm

# Start the Vite dev server
bun run dev:web
```

Open [http://localhost:5173](http://localhost:5173).

For Rust hot reload, run in a separate terminal:
```sh
bun run dev:rust
```

### Production build

```sh
bun run build
```

Output is in `web/dist/`.

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via GitHub Actions. Enable Pages in the repository settings with **GitHub Actions** as the source.
