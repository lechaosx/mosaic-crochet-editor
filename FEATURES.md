# Product Decisions

This file records what the app does and (briefly) why. User-facing how-tos live in [README.md](README.md). Technical decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).

**your decision** = decided by the user. **Claude's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

---

## Pattern modes

- Two modes: row and round (concentric, outside-in). — **your decision**
- Round has full / half / quarter sub-modes; half and quarter fold exactly at the inner-hole boundary. — **your decision** (half/quarter folding fix)

## Drawing

- Tools: Pencil, Fill, Eraser, Invert. — **your decision**
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

- Live overlay during drawing — blue for valid overlay positions, red for invalid placements. — **your decision**
- Overlay/invalid colour and opacity are user-configurable, in a popover behind the **⊙** button. — **your decision** (configurability); **Claude's choice** (popover placement)
- Rendered as ✕ symbols in the highlight colour by default; a toggle in the popover switches to a solid colour fill. — **your decision**

## Labels

- Row labels in the left gutter; row 1 at the bottom (mosaic convention). — **your decision**
- Round labels: innermost ring numbered 1, outermost = R. — **your decision**
- Round placement: full mode → top-left corner cell of each ring; half/quarter → above the canvas, centred on column r. — **your decision**
- Glyphs stay upright regardless of canvas rotation; positions follow the pattern's pan/zoom/rotation. — **your decision**
- Toggleable via a switch in the highlight popover. — **your decision**

## View

- Auto-fit zoom on every new pattern, file load, or refresh — accounts for the current rotation's bounding box so a rotated pattern still fits. — **Claude's choice**
- Wheel zoom anchored at the cursor; pinch zoom anchored at the gesture midpoint. — **Claude's choice**
- Rotation is ±45° increments around the **pattern centre** (panned patterns rotate in place), with a 250 ms ease-out animation. Rotation accumulates unbounded; persists across refreshes. — **your decision**
- Top-of-pattern indicator fades in during rotation animation, fades out once it settles. — **Claude's choice**
- Pan is middle-mouse drag (desktop) or two-finger drag (touch); resets to centre on new pattern / load; not persisted across refresh. — **your decision** (reset on new); **Claude's choice** (input bindings)
- Two-finger gesture from a single-finger paint discards the in-flight stroke — no stray pixels from accidental gestures. — **Claude's choice**

## History

- Up to 64 history states per session. — **Claude's choice**
- Each new pattern starts with a clean history. — **your decision**
- Dirty detection diffs current pixels against a baseline snapshot, not a stored flag — drawing then erasing back to the original is clean. — **your decision**

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

## New-pattern dialog

- Opens as a popover anchored to the **New** button; light-dismisses on outside click and Esc. — **your decision**
- Settings update the canvas live as they change. — **your decision**
- Numeric inputs typed below the field's minimum are normalised on blur. — **your decision**
