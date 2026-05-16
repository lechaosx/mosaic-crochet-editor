# TODO — Selection / transforms / library

Working plan for the next big feature set. Six phases, each shippable on its own. Don't try to land more than one phase per sitting. Update checkboxes as items land; capture decisions inline so future-Claude can pick up cold.

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
  - Click **inside** current selection → operate-on-contents modifiers: pure moves pixels, Ctrl copies, Alt moves selection mask only.
- "Floating layer" is the underlying mechanic, with two lifecycles sharing the same `{ pixels, mask, x, y, name?, id }` struct:
  - **Transient** float: lives for one drag (lift → move → commit on release).
  - **Persistent** float: stored in `SessionState.floats`, lives until deleted. Library items.

## Open decisions (resolve when you reach the relevant phase)

- [ ] **Esc on transient float**: cancel (Photoshop) or commit (GIMP)? Suggested: cancel — safer, still undoable.
- [ ] **Selection serialisation**: 1 bit / cell (matches existing pixel packing) or 1 byte / cell (simpler)? Suggested: 1 bit, reuse the existing packPixels machinery.
- [ ] **Library panel position**: sidebar, floating modal, or another popover? Affects toolbar layout.
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
- [ ] Move per-tool clipping into Rust: `paint_pixel`, `paint_natural_*` take a `selection: &[u8]` param (empty = no clip) and skip writes at the source rather than via TS clip-after. Overlay variants stay parameterless (click-gate covers them). Drops the TS `clipToSelection` helper.
- [ ] **Touch-friendly mask-only move.** Currently the only way to move the selection outline without moving its pixels is Shift+drag on the Move tool — keyboard-only, and Shift+Alt collides with the OS keyboard-layout switcher. Pick one of: (a) dragging the marquee outline on the Select tool moves the mask, (b) arrow-key nudge moves the selection alone (Shift+arrow = pixels+selection), (c) a dedicated "Move Selection" tool, (d) a Move-tool mode toggle stored in `SessionState` and exposed in the toolbar. Whichever path: it must work on touch with no modifier keys.

**Risk noted:** Marching-ants edge computation. Done — single `beginPath()` per render call batches all edges.

## Phase 2 — Operations on selection

**Ships:** magic wand, move, copy, move-mask, clipboard.

> The status-note at the top reflects the post-Phase-2 refactor: `SessionState.float` *is* the selection. The bullets below describe the final shipped behaviour, not the iteration path — see `FEATURES.md` / `ARCHITECTURE.md` for full per-decision rationale.

- [x] **Magic wand tool** (`W` shortcut). `wand_select` in Rust (BFS, same shape as `flood_fill`); the TS `applySelectionMod` applies replace / add / remove locally so each mode keeps the float's existing lift state intact. Hole click is a no-op. Drag-sweep through multiple regions; one history snapshot per drag. Rust tests for the BFS itself; Vitest tests for the wrapper; property tests verify the BFS colour + 4-connectivity invariants.
- [x] **Move tool (`M`)** + Alt-temporary-Move swap. Drag inside the float updates `float.dx/dy`; release records the new offset. Click outside the float is a no-op. Hold Alt with any tool to temporarily swap to Move (toolbar reflects it); release / window blur restores the previous tool. Click-outside-popover capture-phase listener ensures the Edit popover commits before any outside button / shortcut handler runs.
- [x] **Ctrl+drag = duplicate.** At paintdown the float is pre-stamped into the canvas at its current position (visible duplicate carried through the drag), then the drag proceeds as a regular move. Single history snapshot at release.
- [x] **Shift+drag = mask only.** At paintdown the float's pixels are zeroed and the canvas absorbs the previous content; the empty marquee drags around; release re-lifts the canvas content at the new mask position.
- [x] **`Ctrl+C` (copy).** Yanks the float (bbox-bounded clipboard) AND stamps it into the base canvas at its current position. The float stays alive.
- [x] **`Ctrl+X` (cut).** Yanks to clipboard AND clears the base canvas under the float to natural baseline. Drops the float entirely (Photoshop-style: destructive op deselects).
- [x] **`Ctrl+V` (paste).** Anchors any prior float, then creates a *non-destructive uncut* float at the clipboard's original canvas coordinates. Canvas underneath is untouched, so a follow-up Move-drag of the paste-float gives duplicate semantics for free. Auto-switches to the Move tool.
- [x] **`Ctrl+A` / `Ctrl+Shift+A`.** Select-all routes through the same `applySelectionMod("replace")` path so the existing float anchors first. Deselect anchors and clears.
- [x] **`applySelectionMod` add / remove semantics.** Add lifts only the new cells into the existing float at `(canvas − offset)` source positions (existing lift state preserved); remove stamps overlapping cells back at their *current visible position* and shrinks the mask. Source-position out-of-bounds add cells drop silently — rare in practice, not worth a re-anchor.
- [x] **Float survives across save / export / tool switch.** `onSave` / `onExport` bake the float into a throwaway snapshot for the file/export and leave the live float intact. Switching tools doesn't anchor — paint tools clip to the float's shifted mask and write back into `float.pixels`.
- [x] **Off-canvas float cells stay in the mask during drag** (rendered as a gap, not pruned) so dragging back restores them; commit / save / export drops them via the existing pixels-skip rules.
- [x] **Tests:** Rust unit tests for `wand_select` / `cut_to_natural_*` / `paint_natural_*`. Vitest unit tests for `selection.ts`, `clipboard.ts`, `paint.ts`, `store.ts`, `history.ts`, `storage.ts`, `pattern.ts`, `types.ts` (97 cases). Vitest property tests for pack/unpack round-trips, lift-anchor identity, add-idempotence, wand BFS invariants, history undo/redo balance (9 properties, ~900 generated inputs). Playwright E2E for tool switching, paint pixel verification, selection / move / cut / copy / paste flows (31 specs).
- [ ] **Arrow keys nudge the float by 1 cell; Shift+arrow by 5.** Quality-of-life, keyboard-only; not implemented.
- [x] **Two-consecutive-moves cumulative test.** Atomic-history-snapshot move flow gives this naturally; covered in `tests/selection.test.ts` ("cumulative move").

**Decided not to ship:**

- ~~Esc cancels transient float~~ — explicitly rejected by user ("commit-on-outside-click + Ctrl+Z covers abort"). Out of scope.

**Risk (mitigated):** Modifier-semantics depend on cursor location. The `pointerdown` / `paintAt` flow hit-tests against the current float's shifted mask before deciding. Covered by E2E specs.

## Phase 3 — Persistent floats (library)

**Ships:** off-canvas storage for named motifs; drag in/out of canvas.

- [ ] Add `SessionState.floats: Float[]` where `Float = { id: string, pixels: Uint8Array, mask: Uint8Array, x: number, y: number, name?: string }`.
- [ ] Lift gesture: drag a selection past the canvas border → instead of disposing the transient float on release, insert it into `floats`.
- [ ] Stamp gesture: drag a persistent float onto the canvas → on release, stamp into canvas pixels + dispose from `floats`.
- [ ] Render floats in the scratch area (extend view past the canvas border — gesture can already pan there; just need to render them and the canvas boundary visually).
- [ ] Library panel UI: list of floats, name field, delete button. (See Open decision for placement.)
- [ ] Save/load: serialise `floats` alongside canvas pixels. Bump file/localStorage version.
- [ ] Hover on a float in the scratch area shows its outline; click acts like a selection of just that float's cells.

**Risk:** Scratch-area UX. Need a clear visual demarcation between canvas (real pattern) and scratch (library). Probably: canvas keeps current background; scratch is one shade darker with a faint grid showing it's free space. Get this wrong and the canvas border is invisible.

## Phase 4 — Custom symmetry axes

**Ships:** AA + 45° diagonal mirror axes at arbitrary positions, replacing the 5-flag mask.

- [ ] Replace `SessionState.symmetry: Set<SymKey>` with `SessionState.axes: Axis[]` where `Axis = { id: string, kind: "V"|"H"|"D1"|"D2", offset: number, active: boolean }`.
- [ ] Migration: existing 5 symmetries become 5 preset axes at canonical positions, all initially in the list. Old saved sessions auto-upgrade.
- [ ] Axis-placement tools: 4 buttons in the symmetry panel — "Add V axis", "Add H axis", "Add D1 axis", "Add D2 axis". Click on canvas to place.
- [ ] Generalise Rust `symmetric_orbit` to take `&[Axis]` instead of mask byte. Same BFS; transforms derived per axis.
- [ ] Render each axis as a guide line (extend `renderSymmetryGuides`).
- [ ] Axis-list UI in the existing symmetry panel: each row = position + active toggle + delete button. Presets are styled differently from user-added axes (visual hint).
- [ ] Closure semantics: drop the implied-axis logic from `computeClosure`. With arbitrary axes the closure is the orbit; let the BFS handle it.

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
  │     └── Phase 3 (persistent floats / library)
  └── Phase 5 (apply-to-selection)  [also needs Phase 4]

Phase 4 (custom axes)
  └── Phase 5 (apply-to-selection)
        └── Phase 6 (repeat grids)
```

Phases 1 and 4 are independent — can be done in either order. Everything else has dependencies as drawn.

## Suggested first move

**Phase 1.** Smallest viable ship, unlocks Phases 2 and 3, doesn't touch the symmetry refactor (Phase 4). Selection-aware paint is a one-time tax on every WASM tool function; pay it once and the rest is gravy.

---

## Cross-cutting backlog (not phase-bound)

### Test tightening (Stryker-driven)

Mutation score baseline after the May 2026 pass: **72.98%** overall (target: ≥80% on every logic module). Already tightened: `storage` / `clipboard` / `pattern` / `selection`. Open:

- [ ] **`store.ts` (68%, 28 survivors)** — *next immediate step*. Mostly uncovered `commit` options (`persist: false`, `history: false`, `recompute: false`). These are architectural invariants (the chain that fires the renderer / history / persistence / observer on every state change); tests should pin which of the four side effects each option suppresses. Also `visiblePixels` stamping edges (off-canvas drop, hole skip) — already covered indirectly but not via direct assertions.
- [ ] **`paint.ts` (66%, 8 survivors)** — small file, probably 2–3 targeted tests cover most of it. Look at the eraser / overlay mode branches and the `invertVisited` dedup.
- [ ] **`history.ts` (72%, 23 survivors)** — most are localStorage error-handling paths (quota-exceeded retry, malformed-blob recovery). Hard to unit-test cleanly without a jsdom-storage mock; possibly drop to E2E for the recovery flows.

Run with `bun run --cwd web test:mutation`; HTML report at `web/reports/mutation/mutation.html` shows per-line survivor breakdown.
