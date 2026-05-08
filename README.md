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

# Enter the dev shell (installs rustup, trunk, cargo-watch)
nix develop

# Install the nightly Rust toolchain (first time only)
rustup toolchain install nightly
rustup target add wasm32-unknown-unknown

# Start the dev server
trunk serve
```

Open [http://localhost:8080](http://localhost:8080).

Trunk watches both Rust and JS files and hot-reloads on change.

### Production build

```sh
trunk build --release
```

Output is in `dist/`.

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via GitHub Actions. Enable Pages in the repository settings with **GitHub Actions** as the source.
