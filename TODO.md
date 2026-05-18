# TODO — Selection / transforms / library

Working plan for the next big feature set. Six phases, each shippable on its own. Don't try to land more than one phase per sitting. Update checkboxes as items land; capture decisions inline so future-Agent can pick up cold.

> **Status note (post-Phase-2 refactor):** Phases 1 + 2 shipped, then converged via a separate "selection = float" refactor: `SessionState.selection: Uint8Array | null` is gone — `SessionState.float: { mask, pixels, dx, dy } | null` IS the selection. Selecting always lifts (canvas at lift cells → natural baseline, original values into `float.pixels`); moving updates the offset; deselect / save / etc. anchor the float by stamping back. All the Phase 2 modifier matrix (move, copy, mask-only, copy/cut/paste) was reworked on top of this unified state and is documented in `FEATURES.md` / `ARCHITECTURE.md`. The Phase-2 checkbox entries below are kept for the decision log even where the implementation no longer matches verbatim.

---

## Design principles (locked in)

- Live symmetry includes the selection mask — both the visible selection and the paint clip use the mirrored bitset.
- Every action commits atomically. No "Apply" buttons, no floating-layer commit dance between drags. Undo handles everything.
- Paint cells outside the selection: silently dropped. No ghost preview in v1 — only add if real users hit confusion.
- Bottom-left anchor preference carries through (already in `transfer_preserved_*`).
- Selection is **session state**, not pattern data: persist in localStorage (survives refresh) but NOT in `.mcw` (shareable pattern files don't carry transient editing state).
- Selection is part of **undo / redo**. History snapshots include the current selection alongside `pattern` / `pixels` / `colors`. Pure selection-only changes (e.g. drawing a marquee, deselecting) push their own snapshot.
- **Hole cells behave as outside the canvas** for selection. They are never added to a selection (rect-select skips them; select-all skips them). Magic wand (Phase 2) and move/copy (Phase 2) must follow the same rule.
- Modifier semantics depend on cursor position relative to selection:
  - Click **outside** current selection → selection-editing modifiers: pure replaces, Shift adds, Ctrl removes (GIMP convention).
  - Click **inside** current selection → operate-on-contents modifiers: pure moves pixels, Ctrl copies.
- "Floating layer" is the underlying mechanic, with two lifecycles sharing the same `{ pixels, mask, x, y, name?, id }` struct:
  - **Transient** float: lives for one drag (lift → move → commit on release).
  - **Persistent** float: stored in `SessionState.floats`, lives until deleted. Library items.

## Open decisions (resolve when you reach the relevant phase)

- [x] **Esc on transient float**: commit/anchor (GIMP). — **your decision**
- [ ] **Selection serialisation**: 1 bit / cell (matches existing pixel packing) or 1 byte / cell (simpler)? Suggested: 1 bit, reuse the existing packPixels machinery.
- [x] ~~**Library panel position**~~: moot — Phase 3 cancelled. — **your decision**
- [ ] **Mirror axis position**: snap to cell grid or pixel-precise? Suggested: snap to grid — half-integer placements (between cells) are useful (even mirrors), integer are useful (odd mirrors with a cell on the axis), but no in-between.

---

## Phase 1 — Selection foundation

**Ships:** rectangle marquee with shift/ctrl modifiers; painting clipped to selection.

- [x] Add `SessionState.selection: Uint8Array | null` (1 byte/cell in memory, 1 bit/cell on disk).
- [x] Selection tool in the toolbar (one new slot, shortcut `S`). Single-click = 1×1, drag = rect.
- [x] Modifier-aware `pointerdown` in `gesture.ts`: shift adds, ctrl removes, no-mod replaces. (Cursor-vs-selection hit-test for "inside vs outside" is **deferred to Phase 2** — Phase 1 always edits selection on a select-tool drag.)
- [x] Selection clipping for painting tools: TS-side "clip-after" (revert any cells outside selection in the result). No WASM signature changes in Phase 1.
- [x] Render selection as dashed outline. Outline cells where `selection[idx] && !selection[neighbor]` for each of the 4 neighbours. **Static dashes — marching-ants animation is a Phase 1 follow-up.**
- [x] `Ctrl+A` (select all) / `Ctrl+Shift+A` (deselect) shortcuts.
- [x] Clear selection on canvas resize (in `onEditChange`).
- [x] Persist selection in localStorage (NOT in `.mcw` — see Design principles). Optional field on `LocalSaveV2`; missing → null.
- [x] Selection in undo snapshots: extended `Snapshot` / `Restored`; selection-only changes push their own snapshot via `commit(..., { history: true })`.
- [ ] **Rust tests skipped** — no WASM changes in this phase.

**Phase 1 follow-ups (queue before Phase 2):**
- [x] Marching-ants animation: dash-offset advanced in `frame()` while any selection is visible; `render()` kicks off the rAF when needed.
- [x] Selection-aware `flood_fill` walker (Rust): BFS stops at unselected cells. 3 new Rust tests cover empty-selection (unchanged), stop-at-boundary, and disconnected-islands (the previously-broken case where same-colour paths through unselected cells leaked fill into another island).

**Phase 2 follow-ups (queue with Phase 2 ops):**
- [x] Move per-tool clipping into Rust: `paint_pixel`, `paint_natural_*` take a `selection: &[u8]` param (empty = no clip) and skip writes at the source. Overlay stays parameterless (click-gate covers it). TS clip-after loop removed. — **your decision**

**Risk noted:** Marching-ants edge computation. Done — single `beginPath()` per render call batches all edges.

## Phase 2 — Operations on selection

**Ships:** magic wand, move, copy, move-mask, clipboard.

> The status-note at the top reflects the post-Phase-2 refactor: `SessionState.float` *is* the selection. The bullets below describe the final shipped behaviour, not the iteration path — see `FEATURES.md` / `ARCHITECTURE.md` for full per-decision rationale.

- [x] **Magic wand tool** (`W` shortcut). `wand_select` in Rust (BFS, same shape as `flood_fill`); the TS `applySelectionMod` applies replace / add / remove locally so each mode keeps the float's existing lift state intact. Hole click is a no-op. Drag-sweep through multiple regions; one history snapshot per drag. Rust tests for the BFS itself; Vitest tests for the wrapper; property tests verify the BFS colour + 4-connectivity invariants.
- [x] **Move tool (`M`)**. Drag inside the float updates `float.dx/dy`; release records the new offset. Click outside the float is a no-op. Click-outside-popover capture-phase listener ensures the Edit popover commits before any outside button / shortcut handler runs.
- [x] **Ctrl+drag = duplicate.** At paintdown the float is pre-stamped into the canvas at its current position (visible duplicate carried through the drag), then the drag proceeds as a regular move. Single history snapshot at release.
- [x] **Alt+drag = mask only** (changed from Shift+drag — Alt now consistently means "alternate/mask operation"). At paintdown the float's pixels are zeroed and the canvas absorbs the previous content; the empty marquee drags around; release re-lifts the canvas content at the new mask position. Alt dominates Ctrl.
- [x] **`Ctrl+C` (copy).** Yanks the float (bbox-bounded clipboard) AND stamps it into the base canvas at its current position. The float stays alive.
- [x] **`Ctrl+X` (cut).** Yanks to clipboard AND clears the base canvas under the float to natural baseline. Drops the float entirely (Photoshop-style: destructive op deselects).
- [x] **`Ctrl+V` (paste).** Anchors any prior float, then creates a *non-destructive uncut* float at the clipboard's original canvas coordinates. Canvas underneath is untouched, so a follow-up Move-drag of the paste-float gives duplicate semantics for free. Auto-switches to the Move tool.
- [x] **`Ctrl+A` / `Ctrl+Shift+A`.** Select-all routes through the same `applySelectionMod("replace")` path so the existing float anchors first. Deselect anchors and clears.
- [x] **`applySelectionMod` add / remove semantics.** Add lifts only the new cells into the existing float at `(canvas − offset)` source positions (existing lift state preserved); remove stamps overlapping cells back at their *current visible position* and shrinks the mask. Source-position out-of-bounds add cells drop silently — rare in practice, not worth a re-anchor.
- [x] **Float survives across save / export / tool switch.** `onSave` / `onExport` bake the float into a throwaway snapshot for the file/export and leave the live float intact. Switching tools doesn't anchor — paint tools clip to the float's shifted mask and write back into `float.pixels`.
- [x] **Off-canvas float cells stay in the mask during drag** (rendered as a gap, not pruned) so dragging back restores them; commit / save / export drops them via the existing pixels-skip rules.
- [x] **Tests:** Rust unit tests for `wand_select` / `cut_to_natural_*` / `paint_natural_*`. Vitest unit tests for `selection.ts`, `clipboard.ts`, `paint.ts`, `store.ts`, `history.ts`, `storage.ts`, `pattern.ts`, `types.ts` (97 cases). Vitest property tests for pack/unpack round-trips, lift-anchor identity, add-idempotence, wand BFS invariants, history undo/redo balance (9 properties, ~900 generated inputs). Playwright E2E for tool switching, paint pixel verification, selection / move / cut / copy / paste flows (31 specs).
- [x] **Arrow keys nudge the float by 1 cell; Shift+Arrow by 5; Ctrl+Arrow stamps content once (per Ctrl press) then moves the empty marquee; Ctrl+Shift+Arrow stamps once then moves 5 cells.** Holding counts as one undo step. Alt+Arrow is a no-op. — **your decision**
- [x] **Esc clears selection** (stamps float + drops, identical to `Ctrl+Shift+A`). — **your decision**
- [x] **Delete clears selection content and keeps selection active** — cuts canvas at the float's current display position to natural baseline, re-lifts those cleared cells so the float stays alive with baseline content. No yank. Ctrl+X still drops the float. — **your decision**
- [x] **Alt+move removed** — Alt temporary Move-tool swap dropped; `M` key is the explicit path. — **your decision**
- [x] **Two-consecutive-moves cumulative test.** Atomic-history-snapshot move flow gives this naturally; covered in `tests/selection.test.ts` ("cumulative move").

**Decided not to ship:**

- ~~Esc cancels transient float~~ — explicitly rejected by user ("commit-on-outside-click + Ctrl+Z covers abort"). Out of scope.

**Risk (mitigated):** Modifier-semantics depend on cursor location. The `pointerdown` / `paintAt` flow hit-tests against the current float's shifted mask before deciding. Covered by E2E specs.

## Phase 3 — Persistent floats (library) **— CANCELLED**

Built (state + lift gesture + stamp gesture + scratch-area render + hover/click), then removed in the same sitting. Reason: the foundation worked, but every follow-up question (paint into items, eraser baseline, edge-anchored resize, ctrl+drag clone, layer-order rules) required guessing user workflows we don't actually have. The user called the result "very clunky" and chose to roll back rather than design speculatively. The `library: LibItem[]` field, the `library.ts` module, the renderer's scratch-area pass, and the gesture hooks all came out. The `Library panel position` Open decision is moot. — **your decision**

If this comes back, the design needs:
- Painting parity: paint tools target the layer under the cursor (currently they assume canvas).
- Edge-anchored library items so canvas resize doesn't strand or absorb them.
- Ctrl+drag clone, no hover outline, item visible during drag.
- Decisions on cross-layer selection, eraser baseline on items, symmetry/highlight scope.

Don't pick this up again until there are real users doing real motif workflows.

## Phase 4 — Custom symmetry axes

**Ships:** AA + 45° diagonal mirror axes at arbitrary positions, replacing the 5-flag mask.

Cut into two slices because the type/state refactor touches every symmetry call site while the new placement UX is independent additive work.

### Slice A — pure refactor (no new UX) **— SHIPPED**

- [x] Replace `SessionState.symmetry: Set<SymKey>` with `SessionState.axes: Axis[]`. `Axis` is a discriminated union keyed on `kind: V|H|D1|D2|C`; each variant carries its kind-specific position fields (`x` / `y` / `c` / `(x,y)`). Position fields are stored but unused in Slice A — the Rust BFS still takes a u8 mask, compiled from `kind` + `active` by `axesToMask`. C is kept as a kind (per Open-decision answer) so existing C-only sessions migrate cleanly. — **your decision** (keep C, presets deletable)
- [x] Migration: old `symmetry: string[]` payloads load via `axesFromLegacySet` — five canonical-position presets, active flag transferred per kind. localStorage stays at v4 (loader prefers new `axes` field; falls back to legacy `symmetry` field). History snapshots don't carry symmetry by design (pre-existing), so no history migration needed. — **Agent's choice** (legacy fallback over version bump)
- [x] Closure dropped from the model. `computeClosure` is gone; the BFS handles composition naturally (V + H mask = 3, the orbit still includes the C-equivalent cell via V∘H). UI loses the "implied" dim styling — small visible regression, accepted as cleaner model. — **Agent's choice**
- [x] Renderer reads `axes[]`. Each active axis at its canonical position is drawn in the bright style; no dim/closure rendering. — **Agent's choice**
- [x] `pruneUnavailableDiagonals` deactivates D1/D2 presets when the canvas becomes diagonal-incompatible (vs deleting them); preset returns when canvas re-allows diagonals. — **your decision** (presets deletable, so preserving the slot is less destructive)

### Slice B — drag-to-move axes **— SHIPPED**

- [x] Rust `symmetric_orbit` takes `axes: &[f64]` (3 doubles per axis: kind, a, b) instead of the u8 mask. Per-axis reflection: `V(a): x → 2a − x`, `H(a): y → 2a − y`, `D1(a): (px, py) → (py + a, px − a)`, `D2(a): (px, py) → (a − py, a − px)`, `C(a, b): (2a − x, 2b − y)`. WASM bindings updated; the `f64 → i32` cast forced enabling `nontrapping-float-to-int` in the wasm-opt config. — **Agent's choice**
- [x] TS compiles axes to a flat `Float64Array` via `axesToFlat`; `paintOps`'s `symMask: number` is now `symAxes: Float64Array`. — **Agent's choice**
- [x] Renderer draws each active axis's guide at its actual position (V/H lines at `a.x + 0.5` / `a.y + 0.5`; D1/D2 lines parameterised by `c`; C dot at the rotation point). — **Agent's choice**
- [x] Move-tool drag near an active guide grabs the axis instead of starting a float-move. Snap-to-grid: half-integer for V/H/C; integer for D1/D2 (diagonals can't sit between cells without breaking the cell-to-cell mirror invariant). One history snapshot per drag; cancel reverts. Hit tolerance is 0.4 cell-units. — **Agent's choice**; snap-to-grid resolution — **your decision** (Open decision pre-answered)
- [x] Tests: 5 new Rust `symmetric_orbit` cases (canonical V, off-canonical V, half-integer H on even canvas, C rotation, V+H composition without C in axes); 13 new logic specs (axesToFlat shape, distanceToAxis, pickAxisAt, setAxisPosition, snap helpers); 1 E2E (V axis dragged left changes the mirror partner). — **Agent's choice**

### Slice C — placement UX (deferred)

- [ ] Axis-placement: 4 toolbar buttons ("Add V / H / D1 / D2 axis"). Click on canvas places at the click cell (snap-to-grid). C kind doesn't need a placement button — Move-drag a V or H to wherever, compose to C via BFS.
- [ ] Axis-list UI in the symmetry panel: per-row toggle + delete + position display.
- [ ] Decide: does each placement produce a new id (multiple V axes can coexist), or replace the existing kind's preset? Likely the former, but the renderer / hit-test path already handles arbitrary ids — so this is a UX question, not a code one.

**Risk:** Orbit BFS could grow large with many user-added interacting axes. For ≤ 50×50 canvases the orbit is bounded by total cells (~thousands). Cap iterations as a safety net.

## Phase 5 — Apply-to-selection

**Ships:** one-shot "replicate selected pixels through active transforms" action.

- [ ] New action: for every selected cell, walk its orbit through the active axes. For each orbit cell, copy the source cell's value to the destination (replace semantics, with the hole-skip rules both ways).
- [ ] Triggered by a button in the selection panel + a keyboard shortcut (e.g. `Ctrl+T`).
- [ ] Same active-axes list as live mode — no separate config.
- [ ] Push snapshot to undo.

**Risk:** small. Most of the work is Phase 4's generalisation.

## Phase 6 — Repeat grids

**Ships:** translation transforms (live or one-shot apply).

- [ ] Extend `Axis` → `Transform`, a tagged union: `Reflect { kind, offset }` | `Translate { dx, dy, count? }`.
- [ ] Grid-config UI: tile width / tile height. Optional bounded count; default extends to canvas edges.
- [ ] Render grid as faint guides while painting (prevents the "I clicked once and got 100 dots" surprise).
- [ ] Live mode: each paint stroke replicates at every grid offset. Selection-clipping still in force.
- [ ] Apply mode: reuses Phase 5's mechanism.
- [ ] Safety cap: warn if a single click would produce more than ~100 replications.

**Risk:** UX surprise from live grids if guides aren't shown clearly enough. Render guides BEFORE the user enables live mode (i.e., grid config preview).

---

## Dependency graph

```
Phase 1 (selection foundation)
  ├── Phase 2 (operations on selection)
  └── Phase 5 (apply-to-selection)  [also needs Phase 4]

Phase 4 (custom axes)
  └── Phase 5 (apply-to-selection)
        └── Phase 6 (repeat grids)
```

Phases 1 and 4 are independent — can be done in either order. Phase 3 (library) is cancelled.

## Suggested next move

**Phase 4.** Phases 1 and 2 are shipped; Phase 3 is cancelled; Phase 4 is the next independent piece, replacing the 5-flag symmetry mask with arbitrary user-placed axes. Self-contained — doesn't touch selection / paint internals.

---

## Cross-cutting backlog (not phase-bound)

### Touch-friendly mask-only move

Keyboard path done (Alt+Arrow). Touch/drag: no modifier-free drag path yet. Pick one when ready: (a) dragging the marquee outline on the Select tool moves the mask, (c) a dedicated "Move Selection" tool, (d) a Move-tool mode toggle in the toolbar.



### Test tightening (Stryker-driven)

Mutation score after the May 2026 pass: **81%** on `logic/src/` (target: ≥80% on every module). History and storage-io are not Stryker targets — they are I/O shells covered by E2E. Remaining below target in logic:

- **`selection.ts` (73%, 66 survivors)** — coordinate arithmetic in `applySelectionMod` (offset math, bounds checks). `outOfBounds`/`forEachCell` helpers extracted and tested (98 → 66 survivors). Remaining are narrow boundary tests — diminishing returns.
- **`clipboard.ts` (80%, 31 survivors)** — at target; survivors are minor.

Run with `bun run test:mutation`; HTML report at `logic/reports/mutation/mutation.html`.
