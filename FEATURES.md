# Features

**Your decision** = decided by you. **Agent's choice** = suggested and decided by Agent. **Joint** = discussed and decided together.

---

## Pattern Modes

### Row Mode
Draw a rectangular grid worked row by row.
- Width and height inputs. — **your decision**

### Round Mode
Draw a rectangular pattern worked in concentric rounds from the outside in.
- Inner width, inner height, and rounds inputs. — **your decision**
- **Full** sub-mode: full virtual space, all four sides. — **your decision**
- **Half** sub-mode: bottom half only; fold along inner hole boundary. — **your decision**
- **Quarter** sub-mode: bottom-left quarter; fold along both inner hole boundaries. — **your decision**
- Half/quarter modes fold exactly at the inner hole boundary, preserving the full specified inner dimensions. — **your decision (fix)**

---

## Drawing

### Pixel Painting
- Left click paints Color A, right click paints Color B. — **Agent's choice**
- Painting is blocked on inner hole (transparent) pixels. — **Agent's choice**

### Color Pickers
Click either color swatch to open the native color picker and change Color A or Color B. Canvas re-renders immediately. — **your decision**

### Fill Tool
Flood-fill a contiguous region with the active color. Respects active symmetries. — **Agent's choice**

### Tool Selection
Pencil and Fill buttons in the sidebar. Keyboard shortcuts: **P** (pencil), **F** (fill). — **Agent's choice**

---

## Symmetry

Five symmetry axes selectable as toggle buttons: **↔ Vertical**, **↕ Horizontal**, **⊕ Central**, **╲ Diagonal**, **╱ Anti-diagonal**. — **your decision**

- **Closure inference**: enabling two axes that mathematically imply a third automatically activates the third. — **your decision**
- **Implied vs direct**: directly toggled axes show at full opacity; closure-implied axes are dimmed. — **your decision**
- **Diagonal availability**: diagonal buttons are disabled when `(W − H) % 2 ≠ 0`, since no exact pixel reflection exists in that case. — **your decision**
- **Canvas visualization**: active symmetry axes drawn as dashed lines; central symmetry shown as a dot. Directly active brighter than implied. — **your decision**
- Symmetry applies to both pencil and fill tools. — **Agent's choice**

---

## Undo / Redo

- **Undo** and **Redo** buttons in the sidebar. — **your decision**
- Keyboard shortcuts: **Ctrl+Z** (undo), **Ctrl+Y / Ctrl+Shift+Z** (redo). — **Agent's choice**
- Up to 64 history states per session. — **Agent's choice**

---

## Zoom

Scroll wheel zooms in/out anywhere in the canvas area, excluding the sidebar. — **your decision (area exclusion)**; scroll-to-zoom itself — **Agent's choice**

---

## Real-time Highlights

As you draw, the highlight overlay updates:
- **Blue** pixels: valid overlay stitch locations. — **your decision (from plugin)**
- **Red** pixels: invalid placements. — **your decision (from plugin)**

---

## Export

Clicking **Export Pattern** opens a modal. — **your decision**

- Pattern text in a scrollable read-only textarea. — **your decision**
- **Alternate direction** checkbox re-renders text immediately on toggle. — **your decision**
- **Copy to clipboard** button. — **Agent's choice**
- **Download .txt** button. — **your decision**
- Warning banner when invalid placements exist; export is not blocked. — **Agent's choice** (you specified always-disabled was wrong)

---

## Persistence

Pattern and settings auto-saved to `localStorage` and restored on next visit. — **Agent's choice**

---

## Status Bar

Displays cursor coordinates and counts of valid overlay and invalid pixels. — **Agent's choice**

---

## Touch Support

Touch events mapped to drawing, enabling tablet use. — **Agent's choice**
