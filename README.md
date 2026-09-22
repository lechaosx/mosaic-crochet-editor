# Mosaic Crochet Editor

A browser-based editor for alternating-yarn mosaic crochet charts. Draw pixel patterns, review derived overlay positions, and export a chart-derived work sequence.

**▶ [Try it now](https://lechaosx.github.io/mosaic-crochet-editor/)** — no install, runs in your browser.

Companion to the [Aseprite plugin](https://github.com/lechaosx/aseprite-mosaic-crochet) for the same workflow inside Aseprite.

---

<table>
<tr>
<td><img src="doc/screenshot.png" alt="Web editor with a row pattern and the symmetry-axis popover open"></td>
<td><img src="doc/photo.jpg" alt="Finished crocheted square"></td>
</tr>
</table>

```
Round 1: ([sc, ch] × 4)
Round 2: [(sc, ch, sc), oc] × 4
Round 3: [(sc, ch, sc), oc, sc, oc] × 4
Round 4: [(sc, ch, sc), oc, [sc, oc] × 2] × 4
Round 5: [(sc, ch, sc), oc, [sc, oc] × 3] × 4
Round 6: [(sc, ch, sc), oc, [sc × 3, oc] × 2] × 4
Round 7: [(sc, ch, sc), [oc, sc] × 2, sc × 3, [sc, oc] × 2] × 4
Round 8: [(sc, ch, sc), oc, [sc × 3, oc] × 3] × 4
Round 9: [(sc, ch, sc), oc, sc × 4, [sc, oc] × 2, sc × 5, oc] × 4
Round 10: [(sc, ch, sc), oc, [sc × 7, oc] × 2] × 4
Round 11: [(sc, ch, sc), oc, sc × 17, oc] × 4
Round 12: [(sc, ch, sc), sc, [sc, oc, sc × 2] × 5] × 4
Round 13: [(sc, ch, sc), oc, sc × 2, [sc, oc] × 8, sc × 3, oc] × 4
Round 14: [(sc, ch, sc), oc, sc × 2, [sc × 3, oc] × 4, sc × 5, oc] × 4
Round 15: [(sc, ch, sc), sc × 27] × 4
```

---

For updates, see [RELEASE_NOTES.md](RELEASE_NOTES.md). For decisions and rationale, see [FEATURES.md](FEATURES.md) (product) and [ARCHITECTURE.md](ARCHITECTURE.md) (technical).

---

## Using the app

The workspace separates global document commands from mode-specific panels. One stable canvas fills the workspace while Design tools and Crochet instructions overlay its left edge on wide screens or its bottom edge on narrower screens. The current Crochet instruction also appears alone in a translucent bottom float centred on the same canvas axis as a fitted pattern, so long rows and rounds remain readable. The document bar keeps document commands at the left and one centred Crochet transition: **Begin Crocheting**, **Continue Crocheting**, or **Back to Design**. Pattern and Settings open without leaving Crochet; an effective Pattern canvas change returns to Design, as do Open, Undo, and Redo. Save remains available without leaving Crochet. Pattern, Selection, Global Mirror, and Settings share a right-edge or bottom-sheet inspector; its close button dismisses the current section. None of these panels resize or shift the canvas. At phone widths, lower-frequency document commands and Settings move into **More**. Controls retain their pointer or touch minimum size and grow when the browser's text size is increased; on short screens, panels scroll instead of collapsing the canvas.

The app opens **About** on the first visit and once whenever the newest entry in `RELEASE_NOTES.md` changes. The dialog keeps its Release notes heading, current-year copyright, project link, and three bottom actions visible while the complete notes scroll: **New** creates a blank row pattern and opens the normal Pattern inspector, **Open** loads an editable `.mcw` file, and **Example** loads a small chart that demonstrates Colour, Overlay, Global Mirror, and Crochet. Canceling the file picker leaves About open. Close About with **×**, **Escape**, or a click outside it; reopen it from **Settings → About Mosaic Crochet Editor**.

### Patterns

Click **Pattern** to edit the pattern's dimensions and colours. Shape and size come first; below them, Yarn A/B use direct colour pickers and **⇄** exchanges the two colours as one undoable edit. Danger and accent colour pickers sit beside the yarns because their contrast is judged against the current pattern; they remain app-wide preferences and each has a Reset action.

Two geometry modes are available:

- **Rows** — a rectangular grid worked row by row, numbered from the bottom row as Row 1.
- **Centre-out** — concentric rounds numbered from the innermost band outward. Set centre opening width / height / rounds, plus an authored extent:
  - **Full** — all four sides.
  - **Half** — bottom half only.
  - **Quarter** — bottom-left quarter only.

Settings update the canvas live. While a dimension is changing, the inspector briefly reports the resulting size and the cells added or removed; the message disappears when the edit finishes. Destructive scrubbing within one field remains reversible until change or blur. Pattern adjustments collapse into one before-and-after Undo state until another document edit occurs: closing and reopening the inspector does not split that state, Undo restores the pattern from before the first adjustment, and Redo restores the final result. **Clear drawing** immediately restores every cell to its natural alternating yarn, while switching between Rows and Centre-out immediately creates the selected geometry. Pattern remains open while you draw or navigate the canvas. Close it with the Pattern button, its close button, or **Escape**; panel visibility does not change history. Invalid input keeps the last valid preview while the field remains active and restores the field's starting state when focus leaves it.

Canvas dimensions may contain up to 16,777,216 cells total, with either axis up to 1,048,576 cells for unusually long, narrow patterns. The Pattern inspector reports an inline error without replacing the current canvas when those safety bounds are exceeded; invalid `.mcw` dimensions are rejected during load.

### Drawing

Eight tools, grouped in the authoring dock:

The authoring tools, Global Mirror, and Navigate use the same monochrome visual language. Tool names remain available as button labels or hover descriptions, and the selected action uses the same filled-and-outlined state throughout the app.

- **Pencil** — paint the active colour.
- **Fill** — flood-fill a connected region (stops at the selection boundary when a selection is active).
- **Eraser** — left click restores pixels to the underlying alternating colour; right click paints the *opposite* (the exact inverse).
- **Overlay Place / Clear / Invert** — choose the action explicitly, then draw where the ✕ belongs. Place adds a mark, Clear removes one, and Invert toggles its presence independently at every transformed target. Right-click is the opposite Place/Clear shortcut; Invert behaves identically with either button. **O** selects Place and **Shift+O** selects Clear. A diagonal round-corner pixel is not overlayable because it emits the complete `(sc, ch, sc)` group; neighbouring pixels retain normal Overlay behavior.
- **Invert** — flip pixels between primary and secondary on draw. Within one stroke, no pixel is inverted twice.
- **Select** — drag a rectangle to **lift** those cells into a floating selection: their values move into the float, the canvas below them resets to the natural alternating colour. Choose **Replace**, **Add**, or **Subtract** in the Selection inspector; the drag shows the resulting selection outline and its width, height, and cell count before release. **Shift** temporarily adds and **Ctrl** temporarily subtracts without changing the chosen mode. A single click lifts one cell.
- **Magic wand** — click a cell to lift its connected same-colour region as a float. It shares the visible Replace/Add/Subtract choice and temporary Shift/Ctrl overrides with Select. Dragging can sweep across regions; the entire sweep is one Undo step. Leaving Select or Wand resets the choice to Replace.
- **Move** — drag inside the float to reposition it. Release just stops dragging; the float stays alive across tool changes and saving until you deselect (`Ctrl+Shift+A`), replace the selection, resize the pattern, or load another file. **Ctrl+drag** stamps the float into the canvas at its current position the moment you press, so you visibly drag a duplicate. **Alt+drag** is mask-only: the float's content is baked into the canvas at the start, the drag carries the same marquee shape, and on release the canvas content at the new position is re-lifted as the new float (the original content stays where it was). The Selection inspector exposes **Move content**, **Duplicate**, and **Move area** as persistent modifier-free outcomes and shows their keyboard equivalents. Choosing one activates Move; close the inspector when you are ready to drag. **Shift+drag** has no special meaning on the Move tool — it behaves as a regular move.

Global Mirror's **Apply while drawing** switch controls mirror axes. Each saved repeat has its own **Repeat while drawing** switch. The five drawing tools respect both active choices, and the eraser restores each affected pixel to *its own* natural colour rather than the click point's.

Hovering the chart reports only the current cell coordinates. Drawing begins on contact; there is no speculative colour, rectangle, or dot preview to obscure the committed pattern. Rejected gestures explain the immediate constraint in the context strip.

When a selection is active, painting tools clip to its visible marquee: changes inside the float go to the float's pixels; clicks outside the marquee do nothing. The boundary appears as marching ants in a palette-aware accent colour. Holes (transparent cells) behave as outside the selection — never lifted, never affected by paint through the float.

Open **Selection** in the authoring dock for Replace/Add/Subtract, Move/Duplicate/Move area, Copy, Cut, Paste, and Deselect actions alongside their keyboard hints. The context strip is passive: active-gesture information takes priority, followed by constraints, cursor coordinates, and the selection summary. Deselect places the floating content into the pattern before removing the selection. After Cut or Deselect, the Selection trigger shows the number of copied cells while the in-memory clipboard remains available.

`Ctrl+C` copies the float to the clipboard (non-destructive — canvas and marquee stay unchanged). `Ctrl+X` cuts: clipboard gets the content and the selection drops; canvas cells are cleared to baseline only when every cell's value matches the float (all-or-nothing — if anything differs, the canvas is left alone). `Ctrl+V` pastes from the clipboard back at the original copy location as a non-destructive float — moving it leaves the canvas underneath alone, so paste-then-move is duplicate by default.

**Mouse:** colour tools use the active yarn on left click and the other yarn on right click. Overlay uses right-click as the opposite Place/Clear shortcut.
**Touch / pen:** single-finger drag paints with the active yarn. Select Yarn A or B by tapping its labelled swatch or pressing **1** or **2**. Tap the selected-cell count for selection and clipboard actions or a modifier-free move outcome.

A ✕ marks valid overlay-stitch positions in the other yarn colour; a ! marks invalid placements in the configured danger colour. Selections and transform guides share the configured canvas accent.

Opening an inspector explicitly moves keyboard focus to its first available control. Close it with its close button or **Escape**. Dismissal happens before canvas shortcuts and returns focus to the opener. If that opener is no longer available, focus returns to **More** on compact layouts or to the active authoring tool.

### Global Mirror and saved repeats

New patterns start without mirror axes or saved repeats. **Global Mirror** adds any of five axis kinds: **↔ Vertical**, **↕ Horizontal**, **⊕ Central**, **╲ Diagonal**, or **╱ Anti-diagonal**. Each axis has its own enable/disable and delete controls, whose hover and accessibility labels identify the axis kind and position. Keyboard focus follows an axis when it is toggled or deleted. You can add multiple axes of the same kind.

Active Global Mirror axes are drawn as dashed guides; central rotation is shown as a dot. While **Global Mirror** is open, guides can be dragged without switching away from the current drawing tool. Each axis row also has an exact position field. With the inspector closed, the **Move** tool can still drag guides. Vertical, horizontal, and central axes snap to half-cells; diagonals snap to whole cells. Dragging an axis beyond its useful canvas range deletes it, and resizing drops only axes that no longer have a useful mirror. Diagonal axes work on rectangular canvases of any parity.

Active axes compose automatically: for example, vertical and horizontal mirrors together produce the corresponding four-cell orbit without adding a separate central-axis entry.

Saved repeats live in **Selection**, separately from Global Mirror. Lift the source cells and choose **Save selection**. One recipe is active at a time, follows Move content, Duplicate, and Move area, and deactivates when its source selection no longer exists.

In **Grid** mode, set additional copies independently to the left, right, up, and down. Columns advance by the packed source width plus the horizontal gap and can shift vertically; rows advance by the packed source height plus the vertical gap and can shift horizontally. These two offsets make diagonal and 45° grids possible. Either direction can keep the same orientation or mirror every other instance. Mirrored directions alternate the primary and alternate gap symmetrically outward from the source. Packing uses occupied source cells, so sparse selections keep their holes instead of reserving the whole bounding box.

In **Rotation** mode, enter a centre and select any combination of 90°, 180°, and 270° copies. Rotation and Grid are mutually exclusive within a recipe. The rotation centre accepts whole- or half-cell coordinates when the selected turns map cells exactly. It stays at that absolute chart position when cells are added to or removed from the selection, and follows explicit Move, Duplicate, and Move area translations. This saved-repeat rotation is distinct from Global Mirror’s **⊕ Central** point mirror and its live global axes.

Enable **Repeat while drawing** to apply edits made at the source or any repeat instance across the active saved repeat. Fill and mirror targets remain clipped to the complete extended selection. **Apply current selection** copies the source selection to all configured instances as one undoable edit; it reports overlaps or out-of-chart instances inline and leaves the source selected.

Each saved-repeat grid accepts at most 4,096 positions. Every recipe is limited to 1,048,576 source-to-destination claims, including selected rotation copies, before it can render or paint.

Global Mirror's **Apply while drawing** affects future pencil, fill, eraser, overlay, and invert operations only. **Apply Global Mirror** applies the active axes to content already in the floating selection even when live mirroring is paused. Choose it or press **T**; the source selection stays active and the entire stamp is one undo step. Off-canvas sources and inner-hole destinations are skipped. If differently coloured source cells claim the same destination, the action reports the conflict in Global Mirror and leaves the canvas unchanged.

The Global Mirror button reports whether axes are absent, applying while drawing, or paused. Saved-repeat state appears in Selection instead of on the mirror button.

### Yarns

The labelled **Yarn A** and **Yarn B** swatches remain directly available at every dock size. A visible check and outline identify the active yarn independently of colour. Click, tap, Enter, or Space selects a yarn. Colour editing and Swap live in Pattern; double-clicking or long-pressing a dock swatch opens Pattern and invokes that yarn's picker directly. Swapping does not change the pattern's A/B cells or the active logical yarn, and Undo restores the previous colours.

### Highlights

The **⚙** button in the document bar opens Settings in the inspector:

- **Guidance opacity** — fades visible ✕ / ! glyphs from 0–100%. Guidance is always available; 0% hides it.
- **Show numbers** — row numbers in the left gutter, starting with Row 1 at the bottom; round numbers start with Round 1 at the innermost band and appear above half/quarter charts or in the corner cells of full charts.
- **Prevent impossible overlay placements** — on for fresh sessions. It blocks new impossible marks (top row in Rows; outermost ring and diagonal corners in Centre-out), but still permits correcting an already-wrong cell. Turn it off for free sketching; saved sessions keep their prior choice.
- **About Mosaic Crochet Editor** — opens the release notes, copyright, project information, and New/Open/Example actions.

### Zoom, pan, rotation

- **Zoom**: use **−** / **+** in the canvas controls, scroll the wheel, or pinch with two fingers. Buttons preserve the canvas-centre focal cell; wheel and pinch use the pointer or gesture midpoint. New patterns, loaded files, and refreshes auto-fit to the viewport.
- **Fit**: centres the whole pattern, including visible row or round numbers, in the unobscured canvas workspace and fits its current rotated bounds there. Turning numbers on also reframes the view to keep them visible.
- **Pan**: in Design, choose **Navigate** and drag with mouse, pen, or one finger; choose an authoring tool to leave Navigate. Crochet is already navigation-only, so it omits the redundant Navigate toggle. Hold **Space** while dragging in Design for momentary Navigate. Middle-mouse drag and two-finger drag remain direct shortcuts.
- If the browser or operating system cancels an active drawing pointer, the unfinished edit is discarded. Starting a two-finger gesture also discards any unfinished one-finger edit before navigation begins.
- **Rotate view**: ↺ / ↻ rotate ±45° around the pattern centre. The persistent arrow in the view controls follows the current orientation and resets the view upright.

### Saving

- **Save** saves the editable pattern as a `.mcw` file (JSON). Modern browsers (Chrome/Edge) open a save dialog; Firefox downloads immediately. Cancelling the save dialog does nothing; a file-system failure appears in the document-bar alert.
- **Open** opens a file picker and restores pattern geometry, pixels, colours, Global Mirror axes, and saved-repeat definitions. A different project drops the active float and active recipe link, while an identical project leaves workspace state intact. Legacy v1/v2 files open without axes or saved repeats. Unreadable or invalid files and files from a newer unsupported `.mcw` version are reported in a dismissible document-bar alert without blocking the workspace or replacing the current pattern.
- The Crochet transition keeps one canvas fixed in the workspace, including its pan, zoom, and rotation; switching changes only the mode panel and mode-specific canvas chrome above it. Design shows authoring tools, Navigate, and the authoring context cluster. Crochet makes the canvas navigation-only, omits those redundant Design controls, and shows the complete crochet-order instruction list in its mode panel; the current instruction is repeated in a floating bottom card for readability. Row instructions begin with the bottom foundation as Row 1; round instructions begin with the innermost band as Round 1. Each list row uses its yarn colour as the number badge background and carries an accessible Row/Round and Yarn label. Choose any instruction to move progress directly to it; **Back** and **Forward** move one whole row or round and disable on the first and last instruction. The canvas shows chart-derived work through the end of the current line while future rows, rounds, and overlay contributions remain absent, with an arrow at each generated row or round start. Stitch edits preserve the current row or round. Opening a different authored pattern clears Crochet progress, while reopening an identical chart keeps it. Progress is excluded from `.mcw` and project Undo and reports a browser-storage failure inline. The copy icon copies the complete compressed instruction dump. **Alternate direction** reverses cached instruction direction immediately without regenerating unchanged work. Each `oc` belongs to the worked row or round containing its visible ✕, while the covered supporting pixel remains an internal chart detail.
- Before opening Crochet, invalid overlay placements add a `!` and an accessible error count to the Crochet control. They do not block progress; generated rows and rounds emit affected work as `oc`, mark the affected instruction when it maps to one, and retain any unmapped errors in the overall count.

Tool, colour, Global Mirror axes and live mode, saved repeats and their active source link, rotation, the active float, and the committed canvas auto-save to browser-local recovery and restore on refresh. Display preferences use their own app-global browser record: they survive New, Open, Undo, and Redo but are not stored in recovery snapshots or `.mcw` files. The document bar appears only when a session was **Recovered** or recovery **failed**; routine successful writes stay quiet. This automatic recovery is separate from **Save** and never means an editable pattern file was updated. Drawing remains live on the canvas while dragging and updates recovery storage when the stroke is released. Existing v4/v5 browser recovery and Undo history migrate automatically to the current version. `.mcw` v3 files contain pattern geometry, pixels, colours, Global Mirror axes, and saved-repeat definitions; the active float and active recipe link remain workspace state. Save and Instructions bake the visible float into their output without changing the live selection.

In Design, the passive canvas context stays hidden until it has useful information. It shows one priority at a time: active-gesture details, a rejected-action explanation, hovered coordinates, or the selection/clipboard summary. Selection actions open from the authoring dock instead of from the status surface. Crochet omits this authoring context because its current-line and progress context are already visible in the instruction panel.

When a canvas action cannot proceed, the context strip explains the immediate cause: the pointer is outside the selection, Move needs a selection or must start inside it, an Overlay target has no inward supporting cell, or Settings skipped a protected destination. Repeated blocked cells in one drag produce one message; beginning another canvas action clears it.

### Responsive workspace

Authoring is tool-led rather than controlled by a global strategy switch. **Colour** contains Pencil, Fill, Eraser, and Invert; **Overlay** places the chart-required overlay operation; **Arrange** contains Select, Magic wand, Move, and Global Mirror. Pressed controls identify the active tool. Wide layouts use a single-control-width Design tool rail; compact layouts retain the same ordered controls in a bottom dock.

Controls use a minimum 36 × 36 CSS-pixel target on wide fine-pointer layouts and 44 × 44 CSS pixels when touch input is available or space is compact. Mode panels and inspectors overlay the canvas instead of resizing it: wide layouts place them at the left or right edge, while constrained layouts use bottom sheets. Canvas navigation remains in the top-right and the status cluster in the bottom-right of the unobscured area, moving around an open inspector or sheet without changing the canvas view. The current phone dock keeps all eight authoring tools and both yarns visible across up to three rows; lower-frequency document commands and Settings move into **More**, while Design and Crochet remain direct mode controls. Opening More focuses its first command; use Up/Down or Home/End to move through the menu without moving selected canvas content. Escape returns to More, while Tab or Shift+Tab closes the menu and continues through the page.

### Keyboard shortcuts

Toolbar tools and yarn swatches expose their selected state to assistive technology. Yarn swatches respond to Enter and Space. Pattern geometry and authored extent are named radio groups, and their choices and switches remain native controls that use the standard arrow and Space keys.

The shared canvas is exposed as **Editable pattern chart** in Design and **Crochet progress chart** in Crochet. Hold Space and drag to pan without applying a tool. Arrow keys do not navigate individual chart cells; with Move active, Arrow and Shift+Arrow retain their one- and five-cell selection nudges. Form controls keep their native keys.

| Action | Key |
|---|---|
| Pencil / Fill / Eraser / Overlay / Invert / Select / Wand / Move | **P** / **F** / **E** / **O** / **I** / **S** / **W** / **M** |
| Add Vertical / Horizontal / Central axis | **V** / **H** / **C** |
| Add Diagonal ╲ / Anti-diagonal ╱ axis | **D** / **A** |
| Apply Global Mirror to the selection | **T** |
| Rotate clockwise / counter-clockwise | **R** / **Shift+R** |
| Select Yarn A / Yarn B | **1** / **2** |
| Select all paintable cells / Deselect / Clear selection | **Ctrl+A** / **Ctrl+Shift+A** / **Esc** |
| Delete selection content (keeps selection active) | **Delete** |
| Nudge float / Nudge ×5 | **Arrow** / **Shift+Arrow** with Move active |
| Bake position into canvas, nudge float | **Ctrl+Arrow** / **Ctrl+Shift+Arrow** with Move active |
| Mask-only nudge (stamp + move marquee, re-lifts on release) | **Alt+Arrow** / **Alt+Shift+Arrow** with Move active |
| Copy selection / Cut to clipboard / Paste as a free float | **Ctrl+C** / **Ctrl+X** / **Ctrl+V** |
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
bun run test
```

Builds the generated WASM package and production web bundle, then runs all three test layers:

- **Rust** (`cargo test`) — geometry, walk generators, pattern compression.
- **TS unit + properties** (`bun run test:logic` for pure logic, `bun run test:web` for IO layer, Vitest) — store / selection / paint / clipboard / symmetry / saved repeats / storage / pattern + `fast-check`-generated property assertions for pack/unpack round-trips, lift-anchor identity, wand BFS invariants, history undo/redo balance; plus history and localStorage persistence.
- **E2E** (`bun run test:e2e`, Playwright, desktop Chromium) — full UX flows: adaptive workspace, tool switching, paint pixel verification via `getImageData`, selection / move / copy / cut / paste, symmetry and repeat transforms, Pattern inspector.

CI rejects Rust formatting drift and reports Clippy warnings with `cargo fmt --all -- --check` and `cargo clippy --workspace`.

Run a subset:

```sh
bun run test:logic                    # Vitest — pure logic (logic/tests/)
bun run test:web                      # Vitest — IO layer (web/tests/)
bun run --cwd web test:watch          # Vitest interactive
bun run --cwd web test:coverage       # Istanbul HTML report at web/coverage/index.html
bun run test:mutation                 # Stryker mutation sweep on logic (report at logic/reports/mutation/mutation.html)
bun run test:e2e                      # Production build + Playwright
```

> On NixOS, the dev shell provides `playwright-driver.browsers` and sets `PLAYWRIGHT_BROWSERS_PATH` for you. The `@playwright/test` npm version is pinned to match nixpkgs's bundled chromium.

### Production build

```sh
bun run build
```

Output is in `web/dist/`.

### Deployment

Pushes to `master` automatically deploy to GitHub Pages via GitHub Actions. Enable Pages in the repo settings with **GitHub Actions** as the source.
