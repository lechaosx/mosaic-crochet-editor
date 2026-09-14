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

- The two pattern geometries are named **Rows** and **Centre-out**; their worked units remain rows and rounds. — **your decision**
- Full, half, and quarter are authored extents: the complete centre-out chart, its bottom half, or its bottom-left quarter. They imply no transform. — **your decision**

## Drawing

- Tools: Pencil, Fill, Eraser, Overlay, Invert, Select, Magic Wand, Move. — **your decision**
- **Eraser** (left = restore natural; right = paint *opposite* of natural, the exact inverse). — **your decision**
- **Overlay** tool: click *where you want a ✕*; the inward neighbour is painted with the overlay colour so the highlight pass renders a ✕ at the clicked cell. Right-click clears the ✕ by restoring that neighbour's natural colour. Active transforms replicate the ✕ position with the correct per-cell colour. A diagonal centre-out corner pixel is a non-overlayable `(sc, ch, sc)` group; neighbouring pixels retain normal Overlay behavior. — **your decision**
- Painting is blocked on inner-hole (transparent) pixels. — **Agent's choice**
- Strokes that change nothing leave no history entry and don't dirty the pattern. — **Agent's choice**
- Eraser restores each pixel to its own natural alternating colour, not the click point's. Works under active transforms. — **your decision** (behaviour); **Agent's choice** (per-target fix)
- Invert toggles 1 ↔ 2 through active transforms; within one stroke a target cell can't be inverted twice. — **your decision**
- Left click paints primary, right click paints secondary on desktop. — **Agent's choice**

## Selection

- **Selection is a "float"** — a lifted layer above the canvas. Picking a region (rect, wand, select-all) immediately cuts those cells from the canvas to their natural baseline and moves their original values into `float.pixels`; the render path stamps the float back on top at the current offset. There is no "selection mask without lifted pixels" concept — selection and lifted-content are the same thing. — **your decision**
- **Select** tool (`S`): drag a rectangle. **Shift** adds, **Ctrl** removes, no-modifier replaces (GIMP semantics). Single click = 1×1 rect. — **your decision**
- **Magic wand** tool (`W`): click to select the connected same-colour region (4-neighbour, no tolerance; hole click is a no-op). Same Shift / Ctrl / no-modifier semantics. Wand drag sweeps the cursor across multiple regions, applying the captured mode at each new cell and committing the sweep as one undoable edit. — **your decision** (selection semantics); **Agent's choice** (one transaction per sweep)
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
- **Persistence**: the float is *session* state — it lives in `SessionState`, history snapshots, and browser recovery so it survives refresh. It is never written to `.mcw` files (still v2 schema) or to instruction output: `onSave` / `onInstructions` bake the float into a throwaway snapshot for the file/session and leave the live float alone. — **your decision**
- **Canvas resize with an active float**: `onEditChange` bakes the float into the source pixels via `visiblePixels` before passing to the resize, then drops the float (its mask coords would be invalid in the new geometry). Content carries across; selection state doesn't. — **your decision**
- **Keyboard shortcuts summary**:
  - `Ctrl+A` — lift all paintable cells into float. `Ctrl+Shift+A` / `Esc` — anchor and clear.
  - `Delete` — same all-or-nothing matching as `Ctrl+X` (see above), but re-lifts the result so the selection stays active. Pressing Delete twice always clears both float and canvas: first press makes float match canvas; second press (all match) clears canvas to baseline and re-lifts.
  - **Arrow** — nudge float (content + position) ±1 cell. **Shift+Arrow** — ±5 cells.
  - **Ctrl+Arrow** — bake the float's current position into canvas once (first press per Ctrl-down), then move the float **with its content intact** ±1 cell. **Ctrl+Shift+Arrow** — same but ±5 cells. Stamp resets when Ctrl is released.
  - **Alt+Arrow** — mask-only: stamp content into canvas once (first press per Alt-down), then move the marquee ±1 cell (float pixels mirror canvas at the new position so the marquee shape stays visible). On Alt release the canvas at the final position is re-lifted into the float. Clamped to canvas bounds; if the float is entirely off-canvas when Alt is pressed, it is destroyed instead of jumping. **Alt+Shift+Arrow** — same but ±5 cells.
  - Holding any arrow key produces one undo entry for the entire held sequence.
  — **your decision**

## Symmetry and repeat

- Fresh sessions have no axes. The **Mirror & Repeat** inspector and V/H/C/D/A shortcuts add vertical, horizontal, central, diagonal, or anti-diagonal axes; multiple axes of the same kind coexist. — **your decision**
- Each axis is independently enabled or deleted from the **Mirror & Repeat** inspector. Active transforms compose without synthetic closure entries in the UI. — **your decision** (per-axis controls); **Agent's choice** (closure-free model)
- Diagonal axes work on every canvas size because they are placed at an integer line constant instead of requiring a canonical centred diagonal. — **your decision**
- **Apply while drawing** independently controls whether the configured symmetry and repeat recipe applies to future pencil, fill, eraser, overlay, and invert operations. It defaults on, persists as session state, and is not part of undo history. — **your decision**
- The transform dock button distinguishes no configured recipe, configured with live drawing, and configured with live drawing paused. — **Agent's choice**
- A single repeat grid has tile width and height plus horizontal and vertical copy counts per side. Copies extend in both directions, their Cartesian product includes the source position, and symmetry completes before the grid tiles the motif. — **your decision**
- Repeat state survives refresh and undo but is not stored in `.mcw`; file load and canvas resize retain it. — **your decision**
- Repeat grids are limited to 4,096 configured positions. An operation aborts atomically when it would exceed 1,048,576 transformed claims. — **your decision**
- Dotted tile guides preview while the transform inspector is open and remain visible while repeat is enabled. — **your decision**
- An active selection previews its transformed copies while the transform inspector is open, using the same target evaluator as application and preserving sparse source masks. Enabled repeat directions expose direct distance handles paired with exact whole-cell fields; one handle drag is one undoable edit. — **your decision** (exact previews and direct manipulation); **Agent's choice** (distance-line handles)
- **Stamp transformed copies** (`T`) applies the configured symmetry and repeat recipe to a floating selection regardless of the live-drawing toggle, without anchoring the source. The action is atomic and creates one undo snapshot; off-canvas sources and inner-hole destinations are skipped, while different source colours claiming one destination reject the whole action. — **your decision**
- Stamp conflicts and safety-limit failures appear inline in the transform inspector; changing editor state or completing a stamp clears the transient message. — **Agent's choice**
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
- Two sliders in the Settings inspector (behind the **⚙** button):
  - **Highlight opacity** (default 100%) — dims both ✕ and !.
  - **Invalid marker intensity** (default 65%) — adjusts only the ! marker's HSL saturation, full range 0–100%. Hue and lightness stay algorithmic; the user can tune the "vibe" without bypassing the palette-aware hue choice. — **your decision**
- **Lock invalid** toggle (off by default): silently reverts any paint/fill/invert write to an always-invalid cell (outermost row, outermost ring, or round-mode diagonal) when the cell was already correctly coloured. Fixing an already-wrong cell still works. — **your decision**

## Labels

- Row labels leave the bottom foundation unnumbered; the first worked row above it is Row 1. — **your decision**
- Round labels: innermost ring numbered 1, outermost = R. — **your decision**
- Round placement: full mode → top-left corner cell of each ring; half/quarter → above the canvas, centred on column r. — **your decision**
- Glyphs stay upright regardless of canvas rotation; positions follow the pattern's pan/zoom/rotation. — **your decision**
- Toggleable via a switch in the Settings inspector. — **your decision**

## View

- Auto-fit zoom on every new pattern, file load, or refresh — accounts for the current rotation's bounding box so a rotated pattern still fits. — **Agent's choice**
- Wheel zoom anchored at the cursor; pinch zoom anchored at the gesture midpoint. — **Agent's choice**
- A persistent canvas cluster exposes Fit, Zoom out, rendered cell size, Zoom in, Navigate, Rotate view left/right, and Reset view rotation. Fit uses the whole pattern; button zoom preserves the canvas-centre focal cell. — **Agent's choice**
- Rotation is ±45° increments around the **pattern centre** (panned patterns rotate in place), with a 250 ms ease-out animation. Rotation accumulates unbounded; persists across refreshes. — **your decision**
- Top-of-pattern indicator fades in during rotation animation, fades out once it settles. — **Agent's choice**
- Pan is middle-mouse drag (desktop) or two-finger drag (touch); resets to centre on new pattern / load; not persisted across refresh. — **your decision** (reset on new); **Agent's choice** (input bindings)
- Navigate is a view-only mode distinct from Move: its button latches single-pointer panning without changing the selected authoring tool, choosing an authoring tool exits it, and Space-drag enables it only while Space is held. — **Agent's choice**
- Two-finger gesture from a single-finger paint discards the in-flight stroke — no stray pixels from accidental gestures. — **Agent's choice**
- Browser or operating-system pointer cancellation restores the complete pre-edit state without adding an undo snapshot. — **Agent's choice**

## History

- Up to 64 history states per session. — **Agent's choice**
- History survives page refresh — independently versioned snapshots persist to `localStorage` under the stable `mosaic-history` key. — **your decision** (persistence); **Agent's choice** (versioned envelope and key)
- Each snapshot carries its own `state` and the colour pair (A/B), so undo / redo cross dimension, submode, and colour changes. — **your decision**
- Colour-picker changes push a snapshot on *commit* (picker close), not on every drag — undo walks back through colour changes alongside paint strokes. — **your decision**
- Symmetry-axis and repeat-grid state are part of undo. Undo restores the axis list, every axis position, and the repeat settings. — **your decision**
- Redundant snapshots (same packed pixels + same state + same colours as the head) are skipped. — **Agent's choice**

## Persistence

- Editor session state, including axes, repeat settings, live-transform mode, and an active float, auto-saves to `localStorage` and restores on refresh. — **Agent's choice** (session persistence); **your decision** (transform lifetime)
- A continuous paint stroke renders every update but writes session recovery once on release. — **Agent's choice**
- Legacy v4 recovery and Undo data migrate once into independently versioned v5 envelopes; a failed recovery migration write keeps the usable legacy copy. — **Agent's choice**
- The document bar reports browser recovery as saved, restored, or failed independently from the explicitly named **Save .mcw** file action. — **Agent's choice**

## Save / Load / Instructions

- File format is `.mcw` (JSON). Browsers with the File System Access API show a save dialog; others download immediately. — **Agent's choice**
- `.mcw` stores pattern geometry, pixels, and colours; symmetry axes, repeat settings, and floats remain session-only. Loading keeps the current transforms and drops the active float. — **your decision** (float and repeat boundaries); **Agent's choice** (axis boundary)
- Instructions is a peer workspace to Design. It opens on a read-only Overview that pairs the finished chart with a structured row/round list; selecting a unit focuses its chart path without changing project data or progress. Landscape places chart and list side by side, while portrait stacks them. — **Agent's choice**
- Instructions Text retains exact compressed Copy/Download output for valid charts, a notation legend, alternate-direction generation, and the live editor state when returning to Design. — **Agent's choice**
- Instructions emits structured work units line-by-line with a live progress counter; returning to Design cancels generation. — **your decision** (line-by-line, cancellation); **Agent's choice** (structured units, progress counter)
- Instructions assigns `oc` to the worked row or round containing the visible ✕, independently of the inward supporting pixel used to derive it. — **your decision**
- Alternate-direction toggle in Instructions Text re-generates immediately on change. — **your decision**
- Invalid overlay placements are blockers linked to their chart coordinates. Overview remains available and Text remains copyable as a labelled draft, using `?` for unresolved in-sequence work and one coordinate-bearing unresolved line per blocker. — **Agent's choice**
- Optional Live Instructions reuses the finished editor-style chart and advances at complete row/round boundaries with Done and Back. It shows the current path, yarn, and compressed work; unresolved overlays disable Live, confirmed progress resumes locally only for the same complete structured plan, and failed progress writes remain visibly warned. — **your decision** (optional Live, shared visuals, local progress); **Agent's choice** (row/round prototype boundary, exact-plan reset, and scoped recovery warning)

### Instructions limitations

- Round joins are not emitted. — **Agent's choice**
- Foundation method is not indicated. — **Agent's choice**
- A zero inner hole emits `(ch × 4)` for the innermost round. — **Agent's choice**

## Input model

- Colour editing, Overlay placement, and Arrange operations are explicit tool groups rather than persistent global authoring strategies. Wide rails show the group headings; compact layouts preserve the same tool order and identify the active intent in the canvas context. — **your decision** (retain both colour and overlay workflows); **Agent's choice** (tool-led grouping instead of strategy state)
- Single pointer-event path for mouse, pen, and touch. — **Agent's choice**
- Active tool and yarn controls expose pressed state; visually styled radios and switches retain native focus and keyboard behavior. — **Agent's choice**
- Yarn A/B swatches are visibly labelled and expose a check marker plus pressed state for the active logical yarn. Tap, click, Enter, or Space selects; visible Edit follows the active yarn, while double-click or long-press edits a specific yarn directly. Swap exchanges the two colours as one undoable edit without changing pixel values or the active logical yarn. Right-click on the canvas temporarily uses the other yarn. — **your decision** (click + double-click + long-press, A/B semantics); **Agent's choice** (visible labels/actions, keyboard activation, unified pointer long-press)
- Every button has a hover label. Keyboard shortcuts cover all tools, add each symmetry-axis kind, apply active transforms to a selection, rotate, select colours, edit the selection, and undo/redo. — **your decision** (hover labels + shortcuts); **Agent's choice** (specific bindings)
- Dynamic symmetry-axis actions identify the affected axis kind and position in hover and accessibility labels. Focus follows a toggled axis or the nearest remaining row after deletion. — **Agent's choice**
- Closing an inspector restores focus to its visible opener, compact overflow trigger, or active authoring tool. — **Agent's choice**
- An actionable selection count opens a labelled Selection card on every input type. It exposes Move content, Duplicate content, Move selection area, Copy, Cut, Paste, and Deselect using the existing float semantics; after the selection is removed, a clipboard count keeps Paste discoverable. Move outcomes are temporary UI state and reset to Move content after leaving Move. — **Agent's choice**
- The context strip reports why a canvas gesture was rejected when painting outside the selection, starting Move without or outside a selection, choosing a geometrically unavailable Overlay target, or editing a protected cell. Repeated rejection within one gesture is coalesced into one polite status announcement. — **Agent's choice**

## Workspace shell

- Document and history commands occupy a top document bar; paint, transform, and yarn controls occupy a separate authoring dock without changing their established order. — **Agent's choice**
- At 64rem and wider the dock is a left rail and an open inspector is a right column. Constrained layouts place the dock below the canvas and present the same inspector content as a non-modal bottom sheet. — **Agent's choice**
- Pattern, Selection, Mirror & Repeat, and Settings use one explicitly opened and closed inspector host. Responsive recomposition preserves the active section and its uncommitted fields. — **Agent's choice**
- Controls use a minimum 36 × 36 CSS-pixel target on wide fine-pointer layouts and 44 × 44 CSS pixels when touch input is available or space is compact. The interim phone dock keeps all eight authoring tools and both yarns visible while lower-frequency document commands and Settings move into More. — **Agent's choice**
- The compact document-bar breakpoint derives from its groups' measured intrinsic widths rather than device labels. — **Agent's choice**
- A wrapping canvas context strip shows the active tool and yarn, hovered coordinates, an actionable selection or clipboard count, valid and invalid overlay counts, and live/paused transform state when transforms are configured. — **Agent's choice**

## Adaptive workspace conventions

These decisions constrain continued development beyond the first adaptive shell.

- Desktop, tablet, and phone use one recognisable interaction model. Placement and density may adapt, but tool names, grouping, ordering, state, and meaning remain consistent. Tablets, especially 10–11 inch landscape tablets with touch or pen, are a reference authoring posture rather than an enlarged phone afterthought. — **your decision**
- Layout responds to available space while interaction enhancements respond to actual pointer, keyboard, and pen capabilities. Hybrid devices are not classified exclusively as desktop or touch, and no fixed orientation is required. — **Agent's choice**
- Wide layouts use a document bar, authoring tool rail, central canvas, contextual inspector, and status area. Constrained layouts recompose the same controls into a compact app bar, bottom or side authoring dock, context strip, and non-modal inspector sheet. — **Agent's choice**
- Fine-pointer controls may use 36 × 36 CSS-pixel targets; direct touch controls use at least 44 × 44 CSS pixels. Typography and spacing scale with user text settings, and controls reflow instead of shrinking below their applicable target. — **Agent's choice**
- Command surfaces preserve logical grouping and never require horizontal scrolling. When a group no longer fits, the workspace recomposes or moves lower-frequency commands into labelled overflow instead of unpredictably shrinking controls. — **Agent's choice**
- Frequent and contextual actions remain directly visible. Lower-frequency commands may move into More or an inspector, where icon-only actions gain text labels; essential actions never depend solely on hover, right-click, long-press, modifier keys, or pen hover. Those inputs remain accelerators. — **Agent's choice**
- Dragging and direct manipulation provide an explicit click/tap or mode-based alternative where the operation permits one. Mouse, touch, pen, and keyboard routes produce the same document outcomes. — **Agent's choice**
- Active, selected, unavailable, warning, and error states use visible non-colour cues. Disabled actions that need explanation remain discoverable and explain their prerequisite locally; contextually meaningless actions may be omitted. — **Agent's choice**
- Multi-step and previewed edits expose clear pending state and explicit completion or cancellation. Undo and Redo remain predictable recovery paths, while modal confirmation is reserved for consequential actions that cannot be safely reversed. — **Agent's choice**
- Recomposition preserves the canvas focal cell, selection, active tool, inspector context, and uncommitted transaction. Inspector content remains the same whether pinned, presented as a drawer, or shown as a bottom sheet. — **Agent's choice**
- The workspace supports increased text size, visible keyboard focus, reduced motion, forced colours/high contrast, safe-area insets, and browser zoom outside custom canvas gestures. Short motion is used only to clarify spatial or state relationships. — **Agent's choice**
- The canvas remains the visual priority. Persistent state appears near its owning affordance, immediate coordinates and interaction feedback use the context strip, and completion or failure feedback appears without unexpectedly dismissing or committing work. — **Agent's choice**

## Pattern inspector

- Single **Pattern** document-bar button handles both "create from scratch" and "edit in place" via the same inspector section (no separate New button). Mode, dimensions, and submode remain editable with a live canvas preview. — **your decision**
- Live preview as inputs change. Painted cells are preserved across resizing / submode toggles where they map:
  - **Row mode** — bottom-left anchored: the foundation stays put vertically; column 0 stays put horizontally. Adding rows grows upward, adding columns grows to the right; shrinking truncates from the same far edges. — **your decision**
  - **Round mode** — bottom-left anchored, partitioned into 4 corner blocks (`rounds × rounds` each, one per canvas corner) and 4 straight strips between them. Each region transfers independently: corner blocks anchor to their canvas corner; horizontal strips (top/bottom) anchor to top/bottom vertically and are left-anchored within the strip; vertical strips (left/right) anchor to left/right horizontally and are bottom-anchored within the strip (so detail near the foundation stays put when inner height changes). No collisions; shrinking inner dims drops cells from the side opposite the strip's anchor. — **your decision**
  - **Rounds count change** — composes with the inner-dim rule above by giving every cell an inward shift of Δrounds (so old ring 1 stays ring 1; the new outermost ring wraps around with natural colour). — **your decision**
  - **Mode switch** (row↔round) is inherently a wipe. — **your decision**
- Live preview always derives from the state captured when Pattern opens, so destructive scrubbing is reversible without committing: reduce rounds to 1 and back to 20 brings the original pattern back. — **your decision** (reversible preview); **Agent's choice** (transaction baseline)
- **Apply** commits the current valid preview as one Undo step. **Cancel** and **Escape** restore the opening state without history; invalid input retains the last valid preview and disables Apply. Outside authoring and command input is blocked without dismissing the transaction, while canvas zoom remains available. — **Agent's choice**
- **Wipe** defaults off so compatible edits preserve painted pixels. Mode switches force it on and disabled; switching back before closing restores the user's preference. — **your decision**
- Numeric inputs typed below the field's minimum are normalised on blur. — **your decision**
- Canvas dimensions are limited to 16,777,216 cells total and 1,048,576 cells per axis. Invalid Pattern edits leave the current preview intact and show an inline error; invalid saved dimensions are rejected before pixel allocation. — **joint**

## Load

- File picker → loads the picked `.mcw` → pushes a snapshot. Reverting is via undo (Ctrl+Z), which now restores the prior state, pixels *and* colours together. No separate revert bar. — **your decision**
- Invalid, truncated, and unsupported future `.mcw` files are rejected before session replacement; a future version is identified explicitly. — **Agent's choice**
