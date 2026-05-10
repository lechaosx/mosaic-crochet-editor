# Features

**Your decision** = decided by you. **Claude's choice** = suggested and decided by Claude. **Joint** = discussed and decided together.

---

## Pattern Modes

### Row Mode
Draw a rectangular grid worked row by row.
- Width and height inputs. — **your decision**

### Round Mode
Draw a rectangular pattern worked in concentric rounds from the outside in.
- Inner width, inner height, and rounds inputs. — **your decision**
- **Full** sub-mode: full virtual space, all four sides. — **your decision**
- **Half** sub-mode: bottom half only; fold at inner hole boundary. — **your decision**
- **Quarter** sub-mode: bottom-left quarter; fold at both inner hole boundaries. — **your decision**
- Half/quarter modes fold exactly at the inner hole boundary. — **your decision (fix)**

---

## Drawing

### Pixel Painting
- Left click paints primary color, right click paints secondary color. — **Claude's choice**
- Painting is blocked on inner hole (transparent) pixels. — **Claude's choice**
- Strokes that change nothing are silently ignored — no history entry, no dirty mark. — **Claude's choice**

### Color Pickers
Click either color swatch to select it as active. Double-click (desktop) or long-press (touch / mouse, ~500 ms) opens the native color picker. Right-click on desktop still paints with the secondary colour. — **your decision (click-to-select, double-click + long-press); Claude's choice (unified pointer long-press)**

### Eraser Tool
Restores pixels to their underlying alternating color — the same formula used to initialize the pattern. Works with symmetry: each orbit cell is restored to *its own* natural colour, not the natural colour at the click point. — **your decision**

### Fill Tool
Flood-fill a contiguous region. Respects active symmetries. — **Claude's choice**

### Invert Tool
Toggles a pixel between primary and secondary on draw (1 ↔ 2; transparent stays transparent). Respects symmetry the same way the eraser does. Within a single stroke an orbit cell is never inverted twice, so dragging across a symmetry axis can't toggle pixels back to their original state mid-stroke. — **your decision**

### Tool Selection
Pencil, Fill, Eraser, Invert buttons in the top bar. Keyboard shortcuts: **P** (pencil), **F** (fill), **E** (eraser), **I** (invert). — **Claude's choice**

---

## Symmetry

Five symmetry axes as toggle buttons: **↔ Vertical**, **↕ Horizontal**, **⊕ Central**, **╲ Diagonal**, **╱ Anti-diagonal**. — **your decision**

- **Closure inference**: enabling two axes that imply a third activates it automatically. — **your decision**
- **Implied vs direct**: directly toggled axes show bright; closure-implied axes are dimmed. — **your decision**
- **Diagonal availability**: diagonals disabled when `(W − H) % 2 ≠ 0`. — **your decision**
- **Canvas visualization**: active axes drawn as dashed lines extending one pattern pixel beyond the pattern bounds; central symmetry shown as a dot. — **your decision**
- Symmetry applies to pencil, fill, eraser, and invert. — **Claude's choice**

---

## Highlight Colors

Overlay (valid stitch position) and invalid placement highlights have configurable color and opacity, shown as small swatches in the top bar. Double-click swatch to change color; opacity is a number input (0–100%). — **your decision**

---

## Undo / Redo

- Undo and Redo buttons in the top bar; disabled when operation is unavailable. — **your decision (buttons); Claude's choice (disabled state)**
- Keyboard shortcuts: **Ctrl+Z** (undo), **Ctrl+Y / Ctrl+Shift+Z** (redo). — **Claude's choice**
- Up to 64 history states per session. — **Claude's choice**
- Each new pattern gets a clean history. — **your decision**

---

## Zoom

Scroll wheel anywhere in the canvas area zooms in/out, anchored at the cursor. On touch devices, two-finger pinch zooms anchored at the gesture midpoint. Zoom is auto-fit to the viewport on each new pattern, file load, or page refresh — the auto-fit accounts for the current rotation's bounding box, so a rotated pattern still shows entirely within the viewport. — **your decision (zoom); Claude's choice (cursor anchoring, pinch zoom, rotation-aware auto-fit)**

---

## Canvas Rotation

Two rotate buttons (in the highlights/rotation group) rotate the canvas view ±45° with a 250 ms ease-out animation around the **pattern centre** — panned patterns don't sweep around the viewport. Rotation accumulates unbounded so successive clicks always feel the same direction. Rotation persists across refreshes (restored without re-animating). A small accent-coloured triangle just above the top edge of the pattern fades in while the rotation animates and fades out when it settles, so the user can tell which way is "up" mid-spin. — **your decision** (feature, accumulation, pattern-centre pivot, animated indicator)

---

## Pan

Middle-mouse drag pans the canvas freely on desktop. On touch devices, two-finger drag pans (combined with pinch-zoom in the same gesture). Pan resets to center when opening the New Pattern widget or loading a file. Pan is not persisted across refreshes. — **your decision (reset on New); Claude's choice (middle-mouse, two-finger touch)**

---

## Real-time Highlights

As you draw, the highlight overlay updates:
- **Overlay color** (default blue): valid overlay stitch locations. — **your decision (from plugin)**
- **Invalid color** (default red): invalid placements. — **your decision (from plugin)**

---

## New Pattern

Clicking **New** opens a popover anchored to the button. It light-dismisses on outside click or Esc. Every settings change immediately updates the canvas and commits (baseline reset, history reset, session saved). — **your decision**

- If the current pattern has unsaved changes, a Discard / Cancel dialog appears first. — **your decision**

---

## Export

Clicking **Export** opens a modal. The pattern text appears line by line as it is generated, with a live progress counter in the header. Closing the modal cancels generation immediately. — **your decision (line-by-line, cancellation); Claude's choice (progress counter)**

- **Alternate direction** toggle below the modal header; re-generates immediately on change. — **your decision**
- **Copy to clipboard** and **Download .txt** buttons; disabled while generating. — **Claude's choice / your decision**
- Warning banner when invalid placements exist; export is not blocked. — **Claude's choice**

### Stitch notation
- `sc` — single crochet; `oc` — overlay crochet; `ch` — corner chain.
- `(sc oc)` — stitches worked into same parent (increase).
- `sc × 6` — repeated stitch; `[sc, oc] × 4` — repeated group.

### Known limitations
- Round joins not emitted; add manually.
- Foundation method not indicated.
- Zero inner hole emits `(ch × 4)` for the innermost round — replace with 4 sc into a magic ring.

---

## Save / Load

- **Save** — downloads the pattern as a `.mcw` file (JSON). On browsers with the File System Access API (Chrome/Edge), opens a native save dialog and resets the dirty baseline on success. On others (Firefox) the file downloads immediately with no confirmation possible. — **Claude's choice**
- **Load** — opens a file picker and restores the complete pattern including colors and symmetry. Opening the New Pattern widget after a load shows the loaded pattern's dimensions as defaults. — **your decision**
- Both operations prompt to **Discard** or **Cancel** if there are unsaved changes. — **your decision**
- **Dirty detection** is computed by diffing current pixels against the baseline snapshot, not a stored flag — drawing a pixel then erasing it is not dirty. — **your decision**

---

## Persistence

Tool, color, symmetry, and pixel state auto-save to `localStorage` and restore on refresh. — **Claude's choice**

---

## Touch Support

Single-finger drag draws (any of the four tools, with active symmetry). Putting a second finger down switches into a pan-and-pinch-zoom gesture and **discards** whatever the first finger had drawn so far — so an accidental two-finger pan from a single-finger touch leaves no stray pixels behind. Long-press on a swatch opens the native colour picker. The whole UI uses pointer events, so touch, pen, and mouse share one code path. — **Claude's choice (gesture model, pointer-event unification, paint-cancel on second pointer)**

## Highlight Settings

Highlight overlay/invalid colour and opacity live in a popover triggered by the **⊙** button (in the same toolbar group as the rotation buttons). Tap the small swatches inside to open the colour picker; the opacity slider is below. — **Claude's choice (popover placement so the inputs no longer crowd the toolbar)**

---

## Toolbar Layout

The toolbar holds five groups: **file/history** (New, Load, Save, Export, Undo, Redo), **tools** (Pencil, Fill, Eraser, Invert), **symmetry** (5 axes), **colours** (two swatches), **highlights/rotation** (⊙, ↺, ↻).

- **Wide screen** — single row. Visual order: file, tools, symmetry, colours, highlights/rotation.
- **Narrow screen** — two rows: row 1 = file + highlights/rotation; row 2 = tools + symmetry + colours.
- **Very narrow** — buttons and labels shrink so the toolbar still fits.

Wrapping and shrinking thresholds are derived from each group's measured width at runtime, so they kick in exactly when content stops fitting — never sooner. Browser page-zoom behaves the same as a smaller screen. — **your decision**
