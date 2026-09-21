# Product Decisions

This file records what the app does and (briefly) why. User-facing how-tos live in [README.md](README.md). Technical decisions live in [ARCHITECTURE.md](ARCHITECTURE.md).

**your decision** = decided by the user. **Agent's choice** = proposed and implemented without explicit instruction. **joint** = discussed and decided together.

- The product name is **Mosaic Crochet Editor**. — **your decision**

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
- **Overlay** has explicit Place, Clear, and Invert actions. Right-click performs the opposite Place/Clear action, while Invert is button-independent and deduplicates repeated targets within one stroke. **O** selects Place and **Shift+O** selects Clear. A diagonal centre-out corner pixel remains a non-overlayable `(sc, ch, sc)` group. — **your decision**
- Painting is blocked on inner-hole (transparent) pixels. — **Agent's choice**
- Strokes that change nothing leave no history entry and don't dirty the pattern. — **Agent's choice**
- Eraser restores each pixel to its own natural alternating colour, not the click point's. Works under active transforms. — **your decision** (behaviour); **Agent's choice** (per-target fix)
- Invert toggles 1 ↔ 2 through active transforms; within one stroke a target cell can't be inverted twice. — **your decision**
- Colour tools paint the primary yarn with left click and the secondary yarn with right click on desktop; Overlay uses the separate opposite Place/Clear rule. — **Agent's choice** (colour tools); **your decision** (Overlay shortcut)

## Selection

- **Selection is a "float"** — a lifted layer above the canvas. Picking a region (rect, wand, select-all) immediately cuts those cells from the canvas to their natural baseline and moves their original values into `float.pixels`; the render path stamps the float back on top at the current offset. There is no "selection mask without lifted pixels" concept — selection and lifted-content are the same thing. — **your decision**
- **Select** tool (`S`): drag a rectangle. **Shift** adds, **Ctrl** removes, no-modifier replaces (GIMP semantics). Single click = 1×1 rect. — **your decision**
- **Magic wand** tool (`W`): click to select the connected same-colour region (4-neighbour, no tolerance; hole click is a no-op). Same Shift / Ctrl / no-modifier semantics. Wand drag sweeps the cursor across multiple regions, applying the captured mode at each new cell and committing the sweep as one undoable edit. — **your decision** (selection semantics); **Agent's choice** (one transaction per sweep)
- Select and Wand share visible Replace/Add/Subtract modes; leaving them resets to Replace, modifiers remain temporary overrides, and rectangle drags preview the resulting membership. — **Agent's choice**
- **Add lifts new cells; remove stamps back the unselected cells.** Shift adds: just the new region cells get lifted into the existing float at `(canvas − offset)` source positions, canvas at those positions cuts to baseline; the rest of the float (lifted content, offset) is untouched. Ctrl removes: each overlapping cell is stamped back at its current visible position, mask shrinks; the rest of the float keeps moving. Replace anchors any active float and lifts the region fresh. — **your decision**
- **Move tool** (`M`): a drag inside the float repositions it; release records the new position in history — no anchor. Click outside is a no-op. **Ctrl+drag** pre-stamps the float into canvas at paintdown so the duplicate is visible during the drag. **Alt+drag** is mask-only: stamps at paintdown, then the drag carries the same marquee shape (float pixels mirror canvas content at the new position so the marquee stays visible), release re-lifts the canvas at the new position. The float is clipped to canvas-visible cells when entering Alt mode; if entirely off-canvas, Alt destroys it instead of jumping. Alt dominates Ctrl. — **your decision**
- The Selection inspector owns Move content, Duplicate, and Move area as modifier-free outcomes. The chosen outcome activates Move and remains selected across tool changes; Ctrl and Alt remain temporary gesture overrides. — **your decision**
- **Copy** (`Ctrl+C`): yanks the float to the in-memory clipboard. Non-destructive — canvas and float are unchanged. — **your decision**
- **Cut** (`Ctrl+X`): yanks the float to clipboard and drops it. Canvas cells are cleared to natural baseline only when **every** float cell's value matches the underlying canvas — any mismatch leaves the canvas untouched. This lets `Ctrl+X` act as a pattern-eraser (all-match = clear canvas) or a pure float-dropper (any mismatch = leave canvas alone). — **your decision**
- **Paste** (`Ctrl+V`): anchors any active float, then creates a non-destructive uncut float at the clipboard's original canvas coordinates — `pixels` underneath is *not* modified, the float sits on top. Auto-switches to the Move tool. A regular Move-drag of the paste-float gives copy semantics out of the box (origin stays pristine because the lift never cut anything). — **your decision**
- **Painting through a float**: when a float exists, paint tools (pencil, fill, eraser, invert) operate on the *visible* canvas (`pixels + float stamped at offset`), and the resulting changes are split — cells inside the float's shifted mask write to `float.pixels`; cells outside the mask are clipped (no-op). The Overlay tool is gated by click-cell-inside-mask but its painted inward-neighbour can land in either canvas or float depending on position. Selection clipping keeps the user's marquee meaningful: paint stays inside the lifted region. — **your decision**
- **Tool switching keeps the float alive.** Picking another tool doesn't anchor — paint, fill, etc. just clip to the existing float. The float persists until explicit deselect (`Ctrl+Shift+A`), `Ctrl+A` (lift all + replace), canvas resize, file load, or another modifying operation that needs to anchor first. — **your decision**
- Inner-hole cells behave as outside-the-canvas — never lifted into a float, never affected by paint through one, never outlined. A float can partially or fully extend off-canvas (e.g. after moving it to the edge); off-canvas cells are invisible and skipped on anchor. — **your decision**
- **Marquee rendering**: marching-ants outline along the float's shifted mask boundary, one continuous closed loop per connected component (dashes flow around the perimeter rather than restarting per cell-edge). Drawn in the configured canvas accent, animated as discrete jumps (~8 ticks/sec, dash-offset snapped to 3-screen-px steps), speed zoom-independent. During a Select drag a static unclamped rect outline overlays the same style; in replace mode the existing float's outline is hidden during the drag. — **your decision**
- **Live highlights**: `store.plan` is recomputed from `visiblePixels(state)` on every commit, so the ✕ / ! markers reflect the float's current position automatically — no per-frame WASM rebuild. — **your decision**
- **Persistence**: the float is *session* state — it lives in `SessionState`, history snapshots, and browser recovery so it survives refresh. It is never written to `.mcw` files (still v2 schema) or to instruction output: `onSave` / `onInstructions` bake the float into a throwaway snapshot for the file/session and leave the live float alone. — **your decision**
- **Canvas resize with an active float**: `onEditChange` bakes the float into the source pixels via `visiblePixels` before passing to the resize, then drops the float (its mask coords would be invalid in the new geometry). Content carries across; selection state doesn't. — **your decision**
- **Keyboard shortcuts summary**:
  - `Ctrl+A` — lift all paintable cells into float. `Ctrl+Shift+A` / `Esc` — anchor and clear.
  - `Delete` — same all-or-nothing matching as `Ctrl+X` (see above), but re-lifts the result so the selection stays active. Pressing Delete twice always clears both float and canvas: first press makes float match canvas; second press (all match) clears canvas to baseline and re-lifts.
  - On the focused canvas, plain **Arrow** and **Space** do not edit cells. Space-drag remains momentary Navigate.
  - With Move active, **Arrow** nudges the float (content + position) ±1 cell. **Shift+Arrow** — ±5 cells.
  - With Move active, **Ctrl+Arrow** bakes the float's current position into canvas once (first press per Ctrl-down), then moves the float **with its content intact** ±1 cell. **Ctrl+Shift+Arrow** — same but ±5 cells. Stamp resets when Ctrl is released.
  - With Move active, **Alt+Arrow** is mask-only: stamp content into canvas once (first press per Alt-down), then move the marquee ±1 cell (float pixels mirror canvas at the new position so the marquee shape stays visible). On Alt release the canvas at the final position is re-lifted into the float. Clamped to canvas bounds; if the float is entirely off-canvas when Alt is pressed, it is destroyed instead of jumping. **Alt+Shift+Arrow** — same but ±5 cells.
  - Holding any arrow key produces one undo entry for the entire held sequence.
  — **your decision** (selection shortcut outcomes); **Agent's choice** (canvas cursor and Move scoping)

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
- Mirror & Repeat exposes editable guide handles and exact axis-position fields without requiring Move; outside that inspector, Move-based dragging remains available. — **Agent's choice**
- **Intersection drag picks one axis per kind.** Clicking where multiple axes cross grabs one of each kind, so they move together. Overlapping parallel axes of the same kind are resolved to one entry so they can be separated. — **your decision**

## Highlights

- Live overlay during drawing: **✕** marks valid overlay positions, **!** marks invalid placements. Both render on the overlay layer (one cell outward from the wrong pixel) — so the wrong cell stays visually clean and the marker explains "what's wrong about the overlay above." — **your decision**
- ! markers for boundary cells (top row / outermost ring) render *outside* the canvas in the gutter, visually consistent with the rest. Right-clicking the gutter ! with the Overlay tool clears it. — **your decision**
- Round-mode corners (diagonal cells) show **two** ! markers — one on each perpendicular outward side — because the corner has no single outward axis. — **your decision**
- Foundation row (bottom) is overlay-able: there's no inner row to clash with, so any colour there is a valid overlay onto the row above. — **your decision**
- **✕** is drawn in the *other* pixel colour (auto-contrast — on an A-cell it uses colour B, and vice versa). The ✕ literally shows the colour that would land there if you overlaid. — **your decision**
- **!** uses one configurable danger colour; selections, mirror axes, and repeat guides use one configurable canvas accent. Both have fixed contrasting defaults and explicit Reset actions in Pattern beside the yarn colours, with no automatic palette computation. — **your decision**
- **Guidance opacity** is always available from 0–100%; 0% is the single way to hide ✕ / ! guidance. — **your decision**
- **Prevent impossible overlay placements** reverts paint/fill/invert writes to an always-invalid cell (outermost row, outermost ring, or round-mode diagonal) when it was correctly coloured; a contextual explanation appears and corrective edits still work. Fresh sessions start with prevention on, while saved sessions retain their setting. — **your decision** (protected-cell rule); **Agent's choice** (name, feedback, fresh default)
- Settings keeps explanations in control hover text rather than persistent paragraphs. — **your decision**

## Labels

- Row labels number the bottom row as Row 1 and continue upward. — **your decision**
- Round labels: innermost ring numbered 1, outermost = R. — **your decision**
- Round placement: full mode → top-left corner cell of each ring; half/quarter → above the canvas, centred on column r. — **your decision**
- Glyphs stay upright regardless of canvas rotation; positions follow the pattern's pan/zoom/rotation. — **your decision**
- Toggleable via a switch in the Settings inspector. — **your decision**

## View

- Auto-fit zoom on every new pattern, file load, or refresh uses the same visual bounds as Fit. — **Agent's choice**
- Wheel zoom anchored at the cursor; pinch zoom anchored at the gesture midpoint. — **Agent's choice**
- A persistent canvas cluster exposes Fit, Zoom out/in, Navigate, Rotate view left/right, and an orientation arrow that resets upright. Fit uses the unobscured workspace around open panels and canvas chrome, plus the pattern's visual bounds including visible row or round numbers and the current rotation; turning numbers on reframes them into view. Button zoom preserves the canvas-centre focal cell. — **Agent's choice**
- Rotation is ±45° increments around the **pattern centre** (panned patterns rotate in place), with a 250 ms ease-out animation. Rotation accumulates unbounded; persists across refreshes. — **your decision**
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
- Guidance opacity, danger colour, canvas accent, number visibility, and invalid-placement protection are app-global preferences. They persist independently of project recovery and are excluded from `.mcw`, snapshots, and Undo/Redo; legacy recovery imports them once when no preference record exists. — **your decision** (lifetime); **Agent's choice** (migration boundary)
- About opens on the first visit and once when the newest release-note heading or notes differ from the last acknowledged content, independently of browser recovery, dates, and release versioning. It presents concise product-facing release notes with project information and New/Open/Example actions; New resets to a blank row pattern and opens the modeless Pattern inspector. The dialog light-dismisses, has an explicit close action, and reopens from Settings. — **your decision**
- A continuous paint stroke renders every update but writes session recovery once on release. — **Agent's choice**
- Legacy v4/v5 recovery migrates once into the v6 recovery envelope; legacy display settings move to the independent preference record. Undo data remains independently versioned, and a failed recovery migration write keeps the usable legacy copy. — **Agent's choice**
- The document bar reports only browser recovery restore or failure; routine successful recovery writes stay quiet and remain independent from the explicitly named **Save** file action. — **your decision**

## Save / Load / Crochet

- File format is `.mcw` (JSON). Browsers with the File System Access API show a save dialog; others download immediately. — **Agent's choice**
- `.mcw` stores pattern geometry, pixels, and colours; symmetry axes, repeat settings, and floats remain session-only. Loading keeps the current transforms and drops the active float. — **your decision** (float and repeat boundaries); **Agent's choice** (axis boundary)
- Unreadable, invalid, or unsupported `.mcw` files report a dismissible inline document error and leave the active session unchanged. Starting another open clears the previous error; dismissal returns focus to Open or compact More. — **Agent's choice**
- Cancelling a native save picker is quiet; picker or write failures use the dismissible document error and return focus to Save or compact More. — **Agent's choice**
- One centred Crochet transition states whether to begin, continue, or return to Design; document and secondary commands stay at the left. One canvas remains fixed beneath mode-specific overlay panels, preserving its screen geometry, pan, zoom, and rotation; authoring is disabled in Crochet. — **your decision** (transition, command placement, and overlay-panel canvas model); **Agent's choice** (one persistent DOM canvas)
- Pattern and Settings open without leaving Crochet; an effective Pattern canvas change returns to Design, as do Open, Undo, and Redo. Save remains available without leaving Crochet. — **your decision**
- Crochet keeps its responsive edge panel and adds a translucent bottom float containing only the current instruction text, centred on the same canvas axis as Fit. Each vertically scrollable list row uses its actual yarn colour as the number badge background and exposes Row/Round and Yarn in its accessible label; choosing a line moves progress directly to it. Back and Forward move whole-line boundaries and disable on the first and last lines. The current line is highlighted, and the canvas shows the finished appearance through it while future work and overlay contributions remain absent. A canvas arrow identifies the true start and direction of every generated unit, including Alternate direction. — **your decision**
- Crochet emits structured work units line-by-line with a generation counter and reuses unchanged units after a cheap semantic signature pass; stitches preserve the numeric progress boundary. Open and New clear progress only when their incoming authored geometry or cells differ from the current chart. Returning to Design during generation cancels the unfinished plan. — **your decision** (cache and progress boundaries); **Agent's choice** (semantic-signature boundary and counter)
- The complete compressed instruction dump remains available through an icon-only copy action; copy success or failure is reported inline, and there is no separate Text mode or download action. Alternate direction reverses the cached compression tree without regenerating the instruction plan. — **your decision**
- Crochet instructions assign `oc` to the worked row or round containing the visible ✕, independently of the inward supporting pixel used to derive it. — **your decision**
- Crochet reports invalid overlay placements on the closed Crochet control with `!`, retains a global singular or plural count while open, and marks generated units containing invalid work. They do not block progress; generation emits affected work as `oc`, while unmapped errors remain in the global count. — **your decision**
- A failed Crochet progress write is visibly warned. — **Agent's choice**

### Crochet instruction limitations

- Round joins are not emitted. — **Agent's choice**
- Foundation method is not indicated. — **Agent's choice**
- A zero inner hole emits `(ch × 4)` for the innermost round. — **Agent's choice**

## Input model

- Colour editing, Overlay placement, and Arrange operations are explicit tool groups rather than persistent global authoring strategies. Wide rails show the group headings; compact layouts preserve the same tool order and identify the active intent in the canvas context. — **your decision** (retain both colour and overlay workflows); **Agent's choice** (tool-led grouping instead of strategy state)
- Single pointer-event path for mouse, pen, and touch. — **Agent's choice**
- Active tool and yarn controls expose pressed state; Pattern geometry and authored extent are named radio groups; visually styled radios and switches retain native focus and keyboard behavior. — **Agent's choice**
- Yarn A/B swatches are visibly labelled and expose a check marker plus pressed state for the active logical yarn. Tap, click, Enter, or Space selects; double-click or long-press opens Pattern and invokes that yarn's picker. Pattern owns both direct yarn pickers, an icon-only Swap action, and the canvas contrast colours. Swap exchanges yarn colours as one undoable edit without changing pixel values or the active logical yarn. Right-click on colour drawing temporarily uses the other yarn. — **your decision**
- Every button has a hover label. Keyboard shortcuts cover all tools, add each symmetry-axis kind, apply active transforms to a selection, rotate, select colours, edit the selection, and undo/redo. — **your decision** (hover labels + shortcuts); **Agent's choice** (specific bindings)
- Dynamic symmetry-axis actions identify the affected axis kind and position in hover and accessibility labels. Focus follows a toggled axis or the nearest remaining row after deletion. — **Agent's choice**
- Explicitly opening an inspector focuses its first available control, while automatic error-driven opening does not steal focus. Escape closes the active inspector before canvas shortcuts run; dismissal restores focus to its visible opener, compact overflow trigger, or active authoring tool. — **Agent's choice**
- Compact More exposes standard menu semantics: opening focuses the first command, arrow and boundary keys navigate commands, Escape restores the trigger, and Tab dismisses the menu before continuing sequential focus. Commands return to ordinary button semantics in the wide document bar. — **Agent's choice**
- Composite keyboard widgets consume their navigation keys so compact More cannot also move selected canvas content. — **Agent's choice**
- A toolbar Selection action opens the labelled Selection inspector on every input type. It owns selection composition, Move outcomes, Copy, Cut, Paste, and Deselect with shortcut hints; its label reports selected or copied cell count when present. — **your decision**
- The passive context strip shows one priority at a time: active-gesture details, a coalesced constraint, cursor coordinates, then selection or clipboard summary. It contains no panel-opening controls. — **your decision**
- Mouse and pen hover show coordinates only; drawing has no speculative colour, rectangle, dot, or transformed-result preview. — **your decision**
- Authoring tools, Mirror & Repeat, and Navigate use a consistent yarn-neutral visual language; accessible names and shortcuts remain stable, and the active action uses the shared filled-and-outlined state rather than an underline. — **your decision**
- The Design canvas has no logical-cell keyboard cursor or Space-to-paint path. Arrow keys act only on an active Move selection; Space remains momentary navigation and form controls retain native keys. — **your decision**
- Design and Crochet expose the shared canvas under a mode-appropriate accessible name; labelled controls and context remain the operable interface. — **Agent's choice**

## Workspace shell

- Document and history commands occupy a top document bar; paint, transform, and yarn controls occupy a separate authoring dock without changing their established order. — **Agent's choice**
- The wide-screen Design tool rail is only one control wide to preserve as much canvas space as possible. — **your decision**
- Mode panels and inspectors overlay the canvas so their changing size never shifts its geometry. At 64rem and wider they occupy the left or right edge; constrained layouts use bottom sheets. — **your decision**
- Pattern, Selection, Mirror & Repeat, and Settings use one explicitly opened and closed inspector host. Responsive recomposition preserves the active section and its uncommitted fields. — **Agent's choice**
- Controls use a minimum 36 × 36 CSS-pixel target on wide fine-pointer layouts and 44 × 44 CSS pixels when touch input is available or space is compact, growing with increased root text size. The interim phone dock keeps all eight authoring tools and both yarns visible while lower-frequency document commands and Settings move into More; when enlarged controls cannot fit a short viewport, the dock scrolls instead of collapsing the canvas. — **Agent's choice**
- The compact document-bar breakpoint derives from its groups' measured intrinsic widths rather than device labels. — **Agent's choice**
- A compact floating canvas context appears only for active-gesture details, rejected actions, hovered coordinates, or passive selection/clipboard summaries. Tool, yarn, transform, overlay, and panel-opening actions stay in their owning controls. Navigation and context follow the unobscured right/bottom edges around overlay panels without resizing the canvas. — **your decision** (content and visual anchoring); **Agent's choice** (measured insets)
- Crochet omits the Design-only Navigate toggle and authoring context cluster; Fit, zoom, rotation, and direct canvas navigation remain available beside Crochet progress. — **joint**

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
- Pattern groups every colour editor: project yarn colours and Swap retain project/history semantics, while danger and accent retain app-global preference semantics. — **your decision**
- Live preview as inputs change. Painted cells are preserved across resizing / submode toggles where they map:
  - **Row mode** — bottom-left anchored: the foundation stays put vertically; column 0 stays put horizontally. Adding rows grows upward, adding columns grows to the right; shrinking truncates from the same far edges. — **your decision**
  - **Round mode** — bottom-left anchored, partitioned into 4 corner blocks (`rounds × rounds` each, one per canvas corner) and 4 straight strips between them. Each region transfers independently: corner blocks anchor to their canvas corner; horizontal strips (top/bottom) anchor to top/bottom vertically and are left-anchored within the strip; vertical strips (left/right) anchor to left/right horizontally and are bottom-anchored within the strip (so detail near the foundation stays put when inner height changes). No collisions; shrinking inner dims drops cells from the side opposite the strip's anchor. — **your decision**
  - **Rounds count change** — composes with the inner-dim rule above by giving every cell an inward shift of Δrounds (so old ring 1 stays ring 1; the new outermost ring wraps around with natural colour). — **your decision**
  - **Mode switch** (row↔round) is inherently a wipe. — **your decision**
- A field preview derives from the state captured when that field starts changing, so destructive scrubbing is reversible until change or blur. The first effective Pattern adjustment creates one history state and later Pattern adjustments replace its final state; closing and reopening the panel does not split the group. A non-Pattern document edit or Undo/Redo ends the group, so Undo restores its original state and Redo restores its exact final state. Returning exactly to the original state removes the no-op entry. — **your decision**
- Pattern is modeless: authoring, canvas navigation, document commands, and other inspector sections remain available. The Pattern trigger, close button, and Escape close the panel without reverting committed changes; an invalid field retains its last valid preview while active and reverts that uncommitted preview when focus leaves. — **your decision** (modeless panel); **Agent's choice** (invalid-preview boundary)
- **Clear drawing** is a direct, undoable action that restores natural alternating yarn values. Compatible geometry edits preserve painted pixels; a mode switch clears them because Rows and Centre-out have no stable cell mapping. — **your decision**
- While a field is active, Pattern reports the resulting dimensions and exact added or removed cell counts; settled properties show no transaction-style summary. — **Agent's choice**
- Numeric inputs typed below the field's minimum are normalised on blur. — **your decision**
- Canvas dimensions are limited to 16,777,216 cells total and 1,048,576 cells per axis. Invalid Pattern edits leave the current preview intact and show an inline error; invalid saved dimensions are rejected before pixel allocation. — **joint**

## Load

- File picker → loads the picked `.mcw` → pushes a snapshot. Reverting is via undo (Ctrl+Z), which now restores the prior state, pixels *and* colours together. No separate revert bar. — **your decision**
- Invalid, truncated, and unsupported future `.mcw` files are rejected before session replacement; a future version is identified explicitly. — **Agent's choice**
