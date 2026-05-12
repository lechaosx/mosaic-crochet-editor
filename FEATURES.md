# Product Decisions

This file records what the app does and (briefly) why. User-facing how-tos live in [README.md](README.md). Technical decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).

**your decision** = decided by the user. **Claude's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

---

## Pattern modes

- Two modes: row and round (concentric, outside-in). — **your decision**
- Round has full / half / quarter sub-modes; half and quarter fold exactly at the inner-hole boundary. — **your decision** (half/quarter folding fix)

## Drawing

- Tools: Pencil, Fill, Eraser, Overlay, Invert. — **your decision**
- **Eraser** (left = restore natural; right = paint *opposite* of natural, the exact inverse). — **your decision**
- **Overlay** tool: click *where you want a ✕*; the inward neighbour is painted with the overlay colour so the highlight pass renders a ✕ at the clicked cell. Right-click clears the ✕ by restoring that neighbour's natural colour. Symmetry mirrors the ✕ position (each orbit cell of the click gets its own ✕ with the correct per-cell colour). No-op on round-mode corners (no overlay stitch geometry exists there). — **your decision**
- Painting is blocked on inner-hole (transparent) pixels. — **Claude's choice**
- Strokes that change nothing leave no history entry and don't dirty the pattern. — **Claude's choice**
- Eraser restores each pixel to its own natural alternating colour, not the click point's. Works under symmetry. — **your decision** (behaviour); **Claude's choice** (per-orbit-cell fix)
- Invert toggles 1 ↔ 2 with symmetry; within one stroke an orbit cell can't be inverted twice. — **your decision**
- Left click paints primary, right click paints secondary on desktop. — **Claude's choice**

## Symmetry

- Five axes: vertical, horizontal, central, diagonal, anti-diagonal. — **your decision**
- Closure inference: enabling two axes that imply a third activates it automatically. Implied axes display dimmed; directly toggled ones display bright. — **your decision**
- Diagonals disabled when `(W − H)` is odd. — **your decision** (condition); **Claude's choice** (the integer-arithmetic algorithm that needs it)
- Symmetry applies to pencil, fill, eraser, and invert. — **Claude's choice**
- Active axes are drawn as dashed lines extending one pattern pixel past the pattern bounds; central symmetry as a dot. — **your decision** (lines + dot); **Claude's choice** (overhang for visibility)

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

- Auto-fit zoom on every new pattern, file load, or refresh — accounts for the current rotation's bounding box so a rotated pattern still fits. — **Claude's choice**
- Wheel zoom anchored at the cursor; pinch zoom anchored at the gesture midpoint. — **Claude's choice**
- Rotation is ±45° increments around the **pattern centre** (panned patterns rotate in place), with a 250 ms ease-out animation. Rotation accumulates unbounded; persists across refreshes. — **your decision**
- Top-of-pattern indicator fades in during rotation animation, fades out once it settles. — **Claude's choice**
- Pan is middle-mouse drag (desktop) or two-finger drag (touch); resets to centre on new pattern / load; not persisted across refresh. — **your decision** (reset on new); **Claude's choice** (input bindings)
- Two-finger gesture from a single-finger paint discards the in-flight stroke — no stray pixels from accidental gestures. — **Claude's choice**

## History

- Up to 64 history states per session. — **Claude's choice**
- History survives page refresh — snapshots persist to `localStorage` (1-bit packed, keyed under `mosaic-history-v2`). On refresh the saved stack is restored as-is. — **your decision**
- Each snapshot carries its own `state` and the colour pair (A/B), so undo / redo cross dimension, submode, and colour changes. — **your decision**
- Colour-picker changes push a snapshot on *commit* (picker close), not on every drag — undo walks back through colour changes alongside paint strokes. — **your decision**
- Redundant snapshots (same packed pixels + same state + same colours as the head) are skipped. — **Claude's choice**

## Persistence

- Tool, colour, symmetry, rotation, and pixel state auto-save to `localStorage` and restore on refresh. — **Claude's choice**

## Save / Load / Export

- File format is `.mcw` (JSON). Browsers with the File System Access API show a save dialog; others download immediately. — **Claude's choice**
- Save / Load / New each prompt to discard or cancel if the pattern is dirty. — **your decision**
- Export emits pattern text line-by-line with a live progress counter; closing the modal cancels generation. — **your decision** (line-by-line, cancellation); **Claude's choice** (progress counter)
- Alternate-direction toggle below the modal header re-generates immediately on change. — **your decision**
- Warning banner shown when the pattern has invalid placements; export is not blocked. — **Claude's choice**

### Export limitations

- Round joins are not emitted; add manually.
- Foundation method is not indicated.
- Zero inner hole emits `(ch × 4)` for the innermost round — replace with 4 sc into a magic ring.

## Input model

- Single pointer-event path for mouse, pen, and touch. — **Claude's choice**
- Swatches: tap to select; double-click (desktop) or long-press (any pointer) to edit the colour. Right-click on desktop also paints with the secondary colour without re-selecting. — **your decision** (click + double-click + long-press); **Claude's choice** (unified pointer long-press)
- Every button has a hover label. Keyboard shortcuts: P/F/E/I (tools), V/H/C/D/A (symmetry), R / Shift+R (rotation), 1/2 (swatches), Ctrl+Z / Ctrl+Y (undo/redo). — **your decision** (hover labels + shortcuts); **Claude's choice** (specific bindings)

## Toolbar

- Five groups in fixed visual order on a wide screen: file/history, tools, symmetry, colours, highlights/rotation. — **your decision**
- On narrow screens the toolbar reflows to two rows (file/history + highlights/rotation on row 1; tools + symmetry + colours on row 2), each row distributed with `space-between`. — **your decision**
- When even the two-row layout would overflow, button height and font size shrink to fit. The two breakpoints come from runtime measurements of each group's intrinsic width — they kick in exactly when content stops fitting, never sooner. — **your decision** (auto-shrink); **Claude's choice** (measure-driven)

## Pattern popover

- Single **Pattern** toolbar button — handles both "create from scratch" and "edit in place" via the same popover (no separate New button). Mode toggle (row/round), dimensions, submode all editable; light-dismiss on outside click and Esc. — **your decision**
- Live preview as inputs change. Painted cells are preserved across resizing / submode toggles where they map (row: bottom-anchored vertically, centre-anchored horizontally; round: centre-anchored in virtual space). Mode switch (row↔round) is inherently a wipe. — **your decision**
- Live preview always derives from the pre-edit snapshot, so destructive scrubbing is reversible without committing: reduce rounds to 1 and back to 20 brings the original pattern back. — **your decision**
- **Keep painted** toggle: on by default, the user can flip it off to force a wipe even when preservation is possible. Disabled automatically for inherently-destructive changes (mode switch, inner-W/H change). — **your decision**
- Closing the popover (Esc, click outside, or clicking the canvas) commits the current preview to history. Undo (Ctrl+Z) is the universal revert — no Cancel/Apply buttons, no lossy confirmation modal. — **your decision**
- Live preview always re-derives from the head, so destructive scrubbing (rounds 20 → 1 → 20, full → quarter → full) brings the original pattern back without losing data, even while the popover is open. — **your decision**
- **Wipe** toggle: user preference (default off = preserve painted). Disabled with a visibly greyed appearance for inherently destructive changes (mode switch, inner-W/H change); the disabled state forces wipe but doesn't alter the checked value, so when the user backs out of the destructive change their preference takes over again and the preview restores to painted unless they explicitly checked Wipe. — **your decision**
- Numeric inputs typed below the field's minimum are normalised on blur. — **your decision**

## Load

- File picker → loads the picked `.mcw` → pushes a snapshot. Reverting is via undo (Ctrl+Z), which now restores the prior state, pixels *and* colours together. No separate revert bar. — **your decision**
