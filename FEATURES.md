# Product Decisions

This file records what the app does and (briefly) why. User-facing how-tos live in [README.md](README.md). Technical decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).

**your decision** = decided by the user. **Agent's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

## Glossary

- **Float** — a "lifted" layer sitting above the canvas. Selecting always lifts: the canvas at the selected cells is reset to natural baseline and the original pixel values move into the float. Stored as a compact bounding box (`x`, `y`, `w`, `h`) with absolute canvas-cell coordinates; `pixels[i] !== 0` determines membership (no separate mask array).
- **Lift** — the verb. The cells leave the canvas and enter the float; canvas cuts to baseline.
- **Anchor / commit** — stamping the float back into the canvas at its current position and clearing the float. Triggered by deselect and operations that replace the live selection; canvas resize bakes the visible result before dropping the float.
- **Marquee** — the marching-ants outline traced around the float's non-zero pixel boundary. Same thing as the visible "selection box."
- **Stamp** — copying float pixels into canvas. Anchoring clears the float afterward; duplicate and mask-only operations can stamp while keeping it active.

---

## Pattern modes

- Two modes: row and round (concentric, outside-in). — **your decision**
- Round has full / half / quarter sub-modes; half and quarter fold exactly at the inner-hole boundary. — **your decision** (half/quarter folding fix)

## Drawing

- Tools: Pencil, Fill, Eraser, Overlay, Invert, Select, Magic Wand, Move. — **your decision**
- **Eraser** (left = restore natural; right = paint *opposite* of natural, the exact inverse). — **your decision**
- **Overlay** tool: click *where you want a ✕*; the inward neighbour is painted with the overlay colour so the highlight pass renders a ✕ at the clicked cell. Right-click clears the ✕ by restoring that neighbour's natural colour. Symmetry mirrors the ✕ position (each orbit cell of the click gets its own ✕ with the correct per-cell colour). No-op on round-mode corners (no overlay stitch geometry exists there). — **your decision**
- Painting is blocked on inner-hole (transparent) pixels. — **Agent's choice**
- Strokes that change nothing leave no history entry and don't dirty the pattern. — **Agent's choice**
- Eraser restores each pixel to its own natural alternating colour, not the click point's. Works under symmetry. — **your decision** (behaviour); **Agent's choice** (per-orbit-cell fix)
- Invert toggles 1 ↔ 2 with symmetry; within one stroke an orbit cell can't be inverted twice. — **your decision**
- Left click paints primary, right click paints secondary on desktop. — **Agent's choice**

## Selection

- **Selection is a "float"** — a lifted layer above the canvas. Picking a region (rect, wand, select-all) immediately cuts those cells from the canvas to their natural baseline and moves their original values into `float.pixels`; the render path stamps the float back on top at the current offset. There is no "selection mask without lifted pixels" concept — selection and lifted-content are the same thing. — **your decision**
- **Select** tool (`S`): drag a rectangle. **Shift** adds, **Ctrl** removes, no-modifier replaces (GIMP semantics). Single click = 1×1 rect. — **your decision**
- **Magic wand** tool (`W`): click to select the connected same-colour region (4-neighbour, no tolerance; hole click is a no-op). Same Shift / Ctrl / no-modifier semantics. Wand drag sweeps the cursor across multiple regions, applying the captured mode at each new cell. — **your decision**
- **Add lifts new cells; remove stamps back the unselected cells.** Shift adds: just the new region cells get lifted into the existing float at `(canvas − offset)` source positions, canvas at those positions cuts to baseline; the rest of the float (lifted content, offset) is untouched. Ctrl removes: each overlapping cell is stamped back at its current visible position, mask shrinks; the rest of the float keeps moving. Replace anchors any active float and lifts the region fresh. — **your decision**
- **Move tool** (`M`): a drag inside the float repositions it; release records the new position in history — no anchor. Click outside is a no-op. **Ctrl+drag** pre-stamps the float into canvas at paintdown so the duplicate is visible during the drag. **Alt+drag** is mask-only: stamps at paintdown, then the drag carries the same marquee shape (float pixels mirror canvas content at the new position so the marquee stays visible), release re-lifts the canvas at the new position. The float is clipped to canvas-visible cells when entering Alt mode; if entirely off-canvas, Alt destroys it instead of jumping. Alt dominates Ctrl. — **your decision**
- **Mask move toggle** enables mask-only Move drags without a keyboard modifier. It remains active until toggled off or another tool is selected. — **Agent's choice**
- **Copy** (`Ctrl+C`): yanks the float to the in-memory clipboard. Non-destructive — canvas and float are unchanged. — **your decision**
- **Cut** (`Ctrl+X`): yanks the float to clipboard and drops it. Canvas cells are cleared to natural baseline only when **every** float cell's value matches the underlying canvas — any mismatch leaves the canvas untouched. This lets `Ctrl+X` act as a pattern-eraser (all-match = clear canvas) or a pure float-dropper (any mismatch = leave canvas alone). — **your decision**
- **Paste** (`Ctrl+V`): anchors any active float, then creates a non-destructive uncut float at the clipboard's original canvas coordinates — `pixels` underneath is *not* modified, the float sits on top. Auto-switches to the Move tool. A regular Move-drag of the paste-float gives copy semantics out of the box (origin stays pristine because the lift never cut anything). — **your decision**
- **Painting through a float**: when a float exists, paint tools (pencil, fill, eraser, invert) operate on the *visible* canvas (`pixels + float stamped at offset`), and the resulting changes are split — cells inside the float's shifted mask write to `float.pixels`; cells outside the mask are clipped (no-op). The Overlay tool is gated by click-cell-inside-mask but its painted inward-neighbour can land in either canvas or float depending on position. Selection clipping keeps the user's marquee meaningful: paint stays inside the lifted region. — **your decision**
- **Tool switching keeps the float alive.** Picking another tool doesn't anchor — paint, fill, etc. just clip to the existing float. The float persists until explicit deselect (`Ctrl+Shift+A`), `Ctrl+A` (lift all + replace), canvas resize, file load, or another modifying operation that needs to anchor first. — **your decision**
- Inner-hole cells behave as outside-the-canvas — never lifted into a float, never affected by paint through one, never outlined. A float can partially or fully extend off-canvas (e.g. after moving it to the edge); off-canvas cells are invisible and skipped on anchor. — **your decision**
- **Marquee rendering**: marching-ants outline along the float's shifted mask boundary, one continuous closed loop per connected component (dashes flow around the perimeter rather than restarting per cell-edge). Drawn in the palette-aware `contrastingColor`, animated as discrete jumps (~8 ticks/sec, dash-offset snapped to 3-screen-px steps), speed zoom-independent. During a Select drag a static unclamped rect outline overlays the same style; in replace mode the existing float's outline is hidden during the drag. — **your decision**
- **Live highlights**: `store.plan` is recomputed from `visiblePixels(state)` on every commit, so the ✕ / ! markers reflect the float's current position automatically — no per-frame WASM rebuild. — **your decision**
- **Persistence**: the float is *session* state — it lives in `SessionState`, history snapshots, and localStorage (`mosaic-pattern-v4` schema) so it survives refresh. It is never written to `.mcw` files (still v2 schema) or to export output: `onSave` / `onExport` bake the float into a throwaway snapshot for the file/session and leave the live float alone, so the marquee persists across save. — **your decision**
- **Canvas resize with an active float**: `onEditChange` bakes the float into the source pixels via `visiblePixels` before passing to the resize, then drops the float (its mask coords would be invalid in the new geometry). Content carries across; selection state doesn't. — **your decision**
- **Keyboard shortcuts summary**:
  - `Ctrl+A` — lift all paintable cells into float. `Ctrl+Shift+A` / `Esc` — anchor and clear.
  - `Delete` — same all-or-nothing matching as `Ctrl+X` (see above), but re-lifts the result so the selection stays active. Pressing Delete twice always clears both float and canvas: first press makes float match canvas; second press (all match) clears canvas to baseline and re-lifts.
  - **Arrow** — nudge float (content + position) ±1 cell. **Shift+Arrow** — ±5 cells.
  - **Ctrl+Arrow** — bake the float's current position into canvas once (first press per Ctrl-down), then move the float **with its content intact** ±1 cell. **Ctrl+Shift+Arrow** — same but ±5 cells. Stamp resets when Ctrl is released.
  - **Alt+Arrow** — mask-only: stamp content into canvas once (first press per Alt-down), then move the marquee ±1 cell (float pixels mirror canvas at the new position so the marquee shape stays visible). On Alt release the canvas at the final position is re-lifted into the float. Clamped to canvas bounds; if the float is entirely off-canvas when Alt is pressed, it is destroyed instead of jumping. **Alt+Shift+Arrow** — same but ±5 cells.
  - Holding any arrow key produces one undo entry for the entire held sequence.
  — **your decision**

## Symmetry

- Fresh sessions have no axes. The Symmetry popover and V/H/C/D/A shortcuts add vertical, horizontal, central, diagonal, or anti-diagonal axes; multiple axes of the same kind coexist. — **your decision**
- Each axis is independently enabled or deleted from the Symmetry popover. Active transforms compose in the orbit walker without synthetic closure entries in the UI. — **your decision** (per-axis controls); **Agent's choice** (closure-free model)
- Diagonal axes work on every canvas size because they are placed at an integer line constant instead of requiring a canonical centred diagonal. — **your decision**
- Symmetry applies to pencil, fill, eraser, overlay, and invert. — **Agent's choice**
- Active axes are drawn as dashed lines extending one pattern pixel past the pattern bounds; central symmetry as a dot. — **your decision** (lines + dot); **Agent's choice** (overhang for visibility)
- **Drag a guide to move the mirror.** With the Move tool, clicking near an active guide repositions it, snapped to half-cells (V/H/C) or whole cells (D1/D2). Dragging it beyond the range that can mirror two distinct canvas cells deletes it. — **Agent's choice**
- **Intersection drag picks one axis per kind.** Clicking where multiple axes cross grabs one of each kind, so they move together. Overlapping parallel axes of the same kind are resolved to one entry so they can be separated. — **your decision**

## Highlights

- Live overlay during drawing: **✕** marks valid overlay positions, **!** marks invalid placements. Both render on the overlay layer (one cell outward from the wrong pixel) — so the wrong cell stays visually clean and the marker explains "what's wrong about the overlay above." — **your decision**
- ! markers for boundary cells (top row / outermost ring) render *outside* the canvas in the gutter, visually consistent with the rest. Right-clicking the gutter ! with the Overlay tool clears it. — **your decision**
- Round-mode corners (diagonal cells) show **two** ! markers — one on each perpendicular outward side — because the corner has no single outward axis. — **your decision**
- Foundation row (bottom) is overlay-able: there's no inner row to clash with, so any colour there is a valid overlay onto the row above. — **your decision**
- **✕** is drawn in the *other* pixel colour (auto-contrast — on an A-cell it uses colour B, and vice versa). The ✕ literally shows the colour that would land there if you overlaid. — **your decision**
- **!** is drawn in a *third palette colour* computed at render time: the hue around the colour wheel that maximises the minimum hue-distance to both user colours, at moderate saturation/lightness (HSL 65% / 50%). The marker pops against any palette without ever blending in (auto-contrast can collide with high-saturation pixel colours; a third colour can't). — **your decision**
- Two sliders in the Settings popover (behind the **⚙** button):
  - **Highlight opacity** (default 100%) — dims both ✕ and !.
  - **Invalid marker intensity** (default 65%) — adjusts only the ! marker's HSL saturation, full range 0–100%. Hue and lightness stay algorithmic; the user can tune the "vibe" without bypassing the palette-aware hue choice. — **your decision**
- **Lock invalid** toggle (off by default): silently reverts any paint/fill/invert write to an always-invalid cell (outermost row, outermost ring, or round-mode diagonal) when the cell was already correctly coloured. Fixing an already-wrong cell still works. — **your decision**

## Labels

- Row labels in the left gutter; row 1 at the bottom (mosaic convention). — **your decision**
- Round labels: innermost ring numbered 1, outermost = R. — **your decision**
- Round placement: full mode → top-left corner cell of each ring; half/quarter → above the canvas, centred on column r. — **your decision**
- Glyphs stay upright regardless of canvas rotation; positions follow the pattern's pan/zoom/rotation. — **your decision**
- Toggleable via a switch in the Settings popover. — **your decision**

## View

- Auto-fit zoom on every new pattern, file load, or refresh — accounts for the current rotation's bounding box so a rotated pattern still fits. — **Agent's choice**
- Wheel zoom anchored at the cursor; pinch zoom anchored at the gesture midpoint. — **Agent's choice**
- Rotation is ±45° increments around the **pattern centre** (panned patterns rotate in place), with a 250 ms ease-out animation. Rotation accumulates unbounded; persists across refreshes. — **your decision**
- Top-of-pattern indicator fades in during rotation animation, fades out once it settles. — **Agent's choice**
- Pan is middle-mouse drag (desktop) or two-finger drag (touch); resets to centre on new pattern / load; not persisted across refresh. — **your decision** (reset on new); **Agent's choice** (input bindings)
- Two-finger gesture from a single-finger paint discards the in-flight stroke — no stray pixels from accidental gestures. — **Agent's choice**

## History

- Up to 64 history states per session. — **Agent's choice**
- History survives page refresh — snapshots persist to `localStorage` (1-bit packed, keyed under `mosaic-history-v4`). On refresh the saved stack is restored as-is. — **your decision**
- Each snapshot carries its own `state` and the colour pair (A/B), so undo / redo cross dimension, submode, and colour changes. — **your decision**
- Colour-picker changes push a snapshot on *commit* (picker close), not on every drag — undo walks back through colour changes alongside paint strokes. — **your decision**
- Symmetry axis state is part of undo: adding, enabling, disabling, deleting, or moving axes pushes a snapshot. Undo restores the list and every axis position. — **your decision**
- Redundant snapshots (same packed pixels + same state + same colours as the head) are skipped. — **Agent's choice**

## Persistence

- Editor session state, including axes and an active float, auto-saves to `localStorage` and restores on refresh. — **Agent's choice**

## Save / Load / Export

- File format is `.mcw` (JSON). Browsers with the File System Access API show a save dialog; others download immediately. — **Agent's choice**
- `.mcw` stores pattern geometry, pixels, and colours; symmetry axes and floats remain session-only. Loading keeps the current axes and drops the active float. — **your decision** (float boundary); **Agent's choice** (axis boundary)
- Export emits pattern text line-by-line with a live progress counter; closing the modal cancels generation. — **your decision** (line-by-line, cancellation); **Agent's choice** (progress counter)
- Alternate-direction toggle below the modal header re-generates immediately on change. — **your decision**
- Warning banner shown when the pattern has invalid placements; export is not blocked. — **Agent's choice**

### Export limitations

- Round joins are not emitted. — **Agent's choice**
- Foundation method is not indicated. — **Agent's choice**
- A zero inner hole emits `(ch × 4)` for the innermost round. — **Agent's choice**

## Input model

- Single pointer-event path for mouse, pen, and touch. — **Agent's choice**
- Swatches: tap to select; double-click (desktop) or long-press (any pointer) to edit the colour. Right-click on desktop also paints with the secondary colour without re-selecting. — **your decision** (click + double-click + long-press); **Agent's choice** (unified pointer long-press)
- Every button has a hover label. Keyboard shortcuts cover all tools, add each symmetry-axis kind, rotate, select colours, edit the selection, and undo/redo. — **your decision** (hover labels + shortcuts); **Agent's choice** (specific bindings)

## Toolbar

- Five groups in fixed visual order on a wide screen: file/history, highlights/rotation, paint tools, transform/symmetry, colours. — **your decision**
- On narrow screens the toolbar reflows to two rows (file/history + highlights/rotation on row 1; paint tools + transform/symmetry + colours on row 2), each row distributed with `space-between`. — **your decision**
- When even the two-row layout would overflow, button height and font size shrink to fit. The two breakpoints come from runtime measurements of each group's intrinsic width — they kick in exactly when content stops fitting, never sooner. — **your decision** (auto-shrink); **Agent's choice** (measure-driven)

## Pattern popover

- Single **Pattern** toolbar button — handles both "create from scratch" and "edit in place" via the same popover (no separate New button). Mode toggle (row/round), dimensions, submode all editable; light-dismiss on outside click and Esc. — **your decision**
- Live preview as inputs change. Painted cells are preserved across resizing / submode toggles where they map:
  - **Row mode** — bottom-left anchored: row 1 (foundation) stays put vertically; column 0 stays put horizontally. Adding rows grows upward, adding columns grows to the right; shrinking truncates from the same far edges. — **your decision**
  - **Round mode** — bottom-left anchored, partitioned into 4 corner blocks (`rounds × rounds` each, one per canvas corner) and 4 straight strips between them. Each region transfers independently: corner blocks anchor to their canvas corner; horizontal strips (top/bottom) anchor to top/bottom vertically and are left-anchored within the strip; vertical strips (left/right) anchor to left/right horizontally and are bottom-anchored within the strip (so detail near the foundation stays put when inner height changes). No collisions; shrinking inner dims drops cells from the side opposite the strip's anchor. — **your decision**
  - **Rounds count change** — composes with the inner-dim rule above by giving every cell an inward shift of Δrounds (so old ring 1 stays ring 1; the new outermost ring wraps around with natural colour). — **your decision**
  - **Mode switch** (row↔round) is inherently a wipe. — **your decision**
- Live preview always derives from the pre-edit snapshot, so destructive scrubbing is reversible without committing: reduce rounds to 1 and back to 20 brings the original pattern back. — **your decision**
- Closing the popover (Esc, click outside, or clicking the canvas) commits the current preview to history. Undo (Ctrl+Z) is the universal revert — no Cancel/Apply buttons, no lossy confirmation modal. — **your decision**
- **Wipe** defaults off so compatible edits preserve painted pixels. Mode switches force it on and disabled; switching back before closing restores the user's preference. — **your decision**
- Numeric inputs typed below the field's minimum are normalised on blur. — **your decision**

## Load

- File picker → loads the picked `.mcw` → pushes a snapshot. Reverting is via undo (Ctrl+Z), which now restores the prior state, pixels *and* colours together. No separate revert bar. — **your decision**
