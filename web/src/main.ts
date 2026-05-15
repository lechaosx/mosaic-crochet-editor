import { paint_pixel, flood_fill, wand_select, PlanType,
         paint_natural_row, paint_natural_round,
         paint_overlay_row, paint_overlay_round,
         clear_overlay_row, clear_overlay_round,
         lock_invalid_row, lock_invalid_round,
         cut_to_natural_row, cut_to_natural_round,
         export_start_row, export_start_round, symmetric_orbit_indices } from "@mosaic/wasm";
import { Tool, PatternState, SymKey } from "./types";
import { makeViewport, makeRendererState, observeCanvasResize,
         render, fitToView, screenToPattern, updateStatus } from "./render";
import { applyEditSettings } from "./pattern";
import { Store, SessionState } from "./store";
import { historySave, historyReset, historyEnsureInitialized, historyPeek,
         historyUndo, historyRedo, canUndo, canRedo, Restored } from "./history";
import { computeClosure, diagonalsAvailable, getSymmetryMask, pruneUnavailableDiagonals } from "./symmetry";
import { saveToLocalStorage, loadFromLocalStorage, saveToFile, loadFromFile } from "./storage";
import { mountUI, UIHandle } from "./ui";
import { mountGestures } from "./gesture";

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// Minimal sensible defaults — only used when no saved session exists. The
// first thing on fresh-boot is `freshSession()`, which replaces these with
// values read from the Edit popover defaults in the HTML.
function defaultSession(): SessionState {
    return {
        pattern:       { mode: "row", canvasWidth: 9, canvasHeight: 9 },
        pixels:        new Uint8Array(81),
        colorA:        "#000000",
        colorB:        "#ffffff",
        activeTool:    "pencil",
        primaryColor:  1,
        symmetry:        new Set<SymKey>(),
        hlOpacity:        100,
        invalidIntensity: 65,
        selection:       null,
        labelsVisible:   true,
        lockInvalid:     false,
        rotation:        0,
    };
}

// Clip a freshly-painted pixel buffer to the active selection: any cell that
// changed but isn't inside the selection is reverted to its pre-paint value.
// Returns `after` unmodified when there's no active selection.
function clipToSelection(before: Uint8Array, after: Uint8Array, selection: Uint8Array | null): Uint8Array {
    if (!selection) return after;
    const out = after.slice();
    for (let i = 0; i < out.length; i++) {
        if (selection[i] === 0) out[i] = before[i];
    }
    return out;
}

// Build a selection mask from a drag rectangle (pattern coords, inclusive),
// combined with an existing selection per the mode:
//   replace → use just the rect; null if rect doesn't overlap the canvas.
//   add     → union of existing and the (clipped) rect.
//   remove  → existing minus the (clipped) rect; null if result is empty.
// A rect entirely outside the canvas contributes no cells. Inner-hole cells
// (where pixels[idx] === 0) are treated the same as outside-canvas — never
// added to a selection, even if the rect covers them.
function commitSelectRect(
    existing: Uint8Array | null,
    pixels: Uint8Array,
    W: number, H: number,
    startX: number, startY: number, endX: number, endY: number,
    mode: SelectMode,
): Uint8Array | null {
    // Does the unclamped rect overlap the canvas at all?
    const ux1 = Math.min(startX, endX), uy1 = Math.min(startY, endY);
    const ux2 = Math.max(startX, endX), uy2 = Math.max(startY, endY);
    const overlaps = ux2 >= 0 && ux1 <= W - 1 && uy2 >= 0 && uy1 <= H - 1;

    let next: Uint8Array;
    if (mode === "replace") {
        next = new Uint8Array(W * H);
    } else {
        next = existing ? existing.slice() : new Uint8Array(W * H);
    }
    if (overlaps) {
        const x1 = Math.max(0, ux1), y1 = Math.max(0, uy1);
        const x2 = Math.min(W - 1, ux2), y2 = Math.min(H - 1, uy2);
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                const i = y * W + x;
                if (pixels[i] === 0) continue;   // hole cells: same as outside
                next[i] = mode === "remove" ? 0 : 1;
            }
        }
    }
    // null when empty so downstream "no selection" code paths kick in.
    for (let i = 0; i < next.length; i++) if (next[i] !== 0) return next;
    return null;
}

const viewport = makeViewport(document.getElementById("canvas") as HTMLCanvasElement);
const ctx      = viewport.canvas.getContext("2d", { alpha: false })!;
const rs       = makeRendererState();
const saved    = loadFromLocalStorage();
const store    = new Store(saved ?? defaultSession());

// Stroke-scoped — captured at pointerdown, cleared at pointerup. Module-level
// because main.ts is the entry point (nothing imports from it); not a shared
// singleton.
let preStroke:     Uint8Array | null = null;
let invertVisited: Set<number>| null = null;
let strokeColor:   1 | 2              = 1;

type SelectMode = "replace" | "add" | "remove";
// Active rectangle-drag for the select tool. Mode is captured at pointerdown
// (before we know the cursor's pattern coord); start/end are set on the
// first `onPaintAt` and updated each subsequent move. Cleared on
// pointerup/cancel after commit. Coords stay null until the first move.
let selectDrag: { startX: number | null; startY: number | null; endX: number; endY: number; mode: SelectMode } | null = null;
// Active wand-tool drag. Mode is captured at pointerdown; each `onPaintAt`
// step that enters a new cell runs `wand_select` so the drag sweeps over
// multiple regions. After the first cell, replace mode flips to add so
// subsequent cells accumulate rather than overwriting. `startSelection`
// snapshots the pre-drag state so pointer-cancel can revert; `lastCell`
// dedupes when the cursor lingers in the same cell across moves.
let wandDrag: {
    mode: SelectMode;
    startSelection: Uint8Array | null;
    lastCell: { x: number; y: number } | null;
} | null = null;
// Active move-pixels drag. Set when the first paintAt of a Move-tool drag
// (or an Alt-modifier drag from any tool, see `altMovePending`) lands
// inside the existing selection — the float is lifted into `rs.float` and
// this records the click cell so subsequent moves compute the offset.
// The store stays untouched until release; pointer-cancel just clears the
// float and this state.
let floatDrag: { startCellX: number; startCellY: number } | null = null;
// Holding Alt temporarily switches the active tool to Move (the toolbar
// highlights it too). Releasing Alt restores the previous tool. If the
// user picks a different tool from the bar / shortcut while Alt is held,
// we drop this so the manual pick wins on release.
let altPrevTool: Tool | null = null;

function modeToCode(m: SelectMode): number {
    return m === "replace" ? 0 : m === "add" ? 1 : 2;
}

// Sync the renderer's drag state. During replace-mode drag we hide the
// committed selection (the drag is about to replace it). The drag rect is
// shown as its own marching-ants outline at the full sweep extent. The
// actual committed selection only updates on pointerup.
function syncPreview() {
    if (!selectDrag || selectDrag.startX === null) {
        rs.hideCommittedSelection = false;
        rs.dragRect               = null;
        return;
    }
    rs.hideCommittedSelection = selectDrag.mode === "replace";
    rs.dragRect = {
        x1: selectDrag.startX, y1: selectDrag.startY!,
        x2: selectDrag.endX,   y2: selectDrag.endY,
    };
}

// Lift the current selection into a transient float, source cells reset to
// natural baseline. Called from the first paintAt of a no-modifier select
// drag whose click landed inside the existing selection. The store is NOT
// mutated — `rs.float.base` carries the cut canvas for rendering, and the
// commit happens in `finishMove`. `clickX` / `clickY` anchor the drag so
// later moves compute an offset relative to the original click cell.
function startMove(clickX: number, clickY: number) {
    const { pattern, pixels, selection } = store.state;
    if (!selection) return;
    const { canvasWidth: W, canvasHeight: H } = pattern;

    const lifted = new Uint8Array(W * H);
    for (let i = 0; i < selection.length; i++) {
        if (selection[i]) lifted[i] = pixels[i];
    }

    const base = pattern.mode === "row"
        ? cut_to_natural_row(pixels, W, H, selection)
        : cut_to_natural_round(
            pixels, W, H,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds,
            selection,
        );

    rs.float  = { base, lifted, mask: selection.slice(), dx: 0, dy: 0 };
    floatDrag = { startCellX: clickX, startCellY: clickY };
    render(viewport, ctx, rs, store);
}

// Stamp the lifted float into a fresh pixels buffer at its current offset,
// shift the selection mask to match, and commit both as one snapshot. Off-
// canvas destinations and destinations over hole cells are dropped — both
// the pixel value and the selection bit. After commit `rs.float` is cleared
// so the next render reads from the store.
function finishMove() {
    if (!floatDrag || !rs.float) return;
    const { base, lifted, mask, dx: fdx, dy: fdy } = rs.float;
    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;

    const newPixels = base.slice();
    const newMask   = new Uint8Array(W * H);
    let anySelected = false;
    for (let sy = 0; sy < H; sy++) {
        const srow = sy * W;
        for (let sx = 0; sx < W; sx++) {
            if (mask[srow + sx] === 0) continue;
            const dx = sx + fdx, dy = sy + fdy;
            if (dx < 0 || dx >= W || dy < 0 || dy >= H) continue;
            const di = dy * W + dx;
            if (newPixels[di] === 0) continue;   // hole destinations drop
            newPixels[di] = lifted[srow + sx];
            newMask[di]   = 1;
            anySelected   = true;
        }
    }

    rs.float  = null;
    floatDrag = null;
    const finalSelection = anySelected ? newMask : null;
    store.commit(s => {
        s.pixels    = newPixels;
        s.selection = finalSelection;
    }, { history: true });
}

observeCanvasResize(viewport.canvas, v => { viewport.dpr = v; }, () => render(viewport, ctx, rs, store));

// Renderer + side-effect channels (Store invokes them on every `commit`).
store.setRenderer (s => render(viewport, ctx, rs, s));
store.setHistoryFn(s => historySave(s));
store.setPersistFn(s => saveToLocalStorage(s));

// Observers — run after every commit. Replace the boilerplate of
// `ui.setHistory(canUndo(), canRedo())` previously repeated at every site.
store.addObserver(() => ui.setHistory(canUndo(), canRedo()));
store.addObserver(s => updateStatus(s.plan, null, null));

/* ── Paint ─────────────────────────────────────────────────────────────────── */
function paintAt(clientX: number, clientY: number) {
    const { pattern, pixels } = store.state;
    const { x, y } = screenToPattern(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation, pattern, clientX, clientY,
    );
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const inCanvas = x >= 0 && x < W && y >= 0 && y < H;
    const tool = store.state.activeTool;

    // Select tool: extend the in-progress drag rect; re-render to preview.
    // Commit happens in `onPaintEnd`.
    if (tool === "select") {
        if (!selectDrag) return;
        selectDrag.endX = x;
        selectDrag.endY = y;
        render(viewport, ctx, rs, store);
        return;
    }

    // Magic wand: drag-able. Each new cell the cursor enters runs a wand
    // select against the current selection using the captured mode verbatim.
    //   replace → each step replaces with the current cell's region (drag
    //             previews what would commit on release; overshoot is
    //             corrected by dragging back).
    //   add     → each step adds the current region to the selection
    //             (drag sweeps and accumulates).
    //   remove  → each step removes the current region (drag peels off).
    // History snapshot happens on pointerup; pointer-cancel reverts.
    if (tool === "wand") {
        if (!wandDrag) return;
        if (!inCanvas || pixels[y * W + x] === 0) return;
        if (wandDrag.lastCell && wandDrag.lastCell.x === x && wandDrag.lastCell.y === y) return;
        wandDrag.lastCell = { x, y };

        const existing = store.state.selection ?? new Uint8Array(0);
        const next = wand_select(pixels, W, H, x, y, modeToCode(wandDrag.mode), existing);
        let any = false;
        for (let i = 0; i < next.length; i++) if (next[i]) { any = true; break; }
        store.commit(s => { s.selection = any ? next : null; }, { recompute: false });
        return;
    }

    // The overlay tool is the only one that handles clicks in the gutter
    // (just outside the canvas, where boundary ! markers render).
    // Everything else wants an in-canvas, non-hole pixel.
    if (!inCanvas && tool !== "overlay") return;
    if (inCanvas && pixels[y * W + x] === 0) return;
    // When a selection is active, the click cell itself must be in it.
    // Necessary because some tools (notably overlay) paint a *different*
    // cell from the click cell, so clip-after alone would let a click
    // outside the selection still produce a visible mark inside it.
    if (inCanvas && store.state.selection && store.state.selection[y * W + x] === 0) return;

    const mask   = getSymmetryMask(store.state.symmetry, W, H);
    const before = pixels;
    let next: Uint8Array;
    if (tool === "fill") {
        next = flood_fill(pixels, W, H, x, y, strokeColor, mask, store.state.selection ?? new Uint8Array(0));
    } else if (tool === "eraser") {
        // Left-click restores the natural alternating baseline; right-click
        // paints the opposite (deliberately wrong placements).
        const invert = strokeColor !== store.state.primaryColor;
        if (pattern.mode === "row") {
            next = paint_natural_row(pixels, W, H, x, y, mask, invert);
        } else {
            const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
            next = paint_natural_round(pixels, W, H, vw, vh, ox, oy, rounds, x, y, mask, invert);
        }
    } else if (tool === "overlay") {
        // Right-click clears existing overlays / boundary ! markers; left-click
        // paints new ✕ overlays at the clicked cell.
        const clear = strokeColor !== store.state.primaryColor;
        if (pattern.mode === "row") {
            next = clear
                ? clear_overlay_row(pixels, W, H, x, y, mask)
                : paint_overlay_row(pixels, W, H, x, y, mask);
        } else {
            const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
            next = clear
                ? clear_overlay_round(pixels, W, H, vw, vh, ox, oy, rounds, x, y, mask)
                : paint_overlay_round(pixels, W, H, vw, vh, ox, oy, rounds, x, y, mask);
        }
    } else if (tool === "invert") {
        next = pixels.slice();
        const indices = symmetric_orbit_indices(W, H, x, y, mask);
        for (const idx of indices) {
            if (invertVisited!.has(idx)) continue;
            invertVisited!.add(idx);
            const cur = next[idx];
            if      (cur === 1) next[idx] = 2;
            else if (cur === 2) next[idx] = 1;
        }
    } else {
        next = paint_pixel(pixels, W, H, x, y, strokeColor, mask);
    }
    // Clip to selection: revert any cells that changed but aren't in the
    // selection. Skipped for the overlay tool — its painted cell is the
    // *inward neighbour* of the click cell (the implementation detail that
    // makes the ✕ render at the click position), not the click cell itself,
    // so clip-after would block the user's intended placement near the
    // selection border. The click-cell gate above is the user-intent check.
    if (tool !== "overlay") next = clipToSelection(before, next, store.state.selection);
    if (store.state.lockInvalid) next = lockAlwaysInvalid(pattern, before, next);
    store.commit(s => { s.pixels = next; });
    updateStatus(store.plan, x, y);
}

function lockAlwaysInvalid(p: PatternState, before: Uint8Array, after: Uint8Array): Uint8Array {
    return p.mode === "row"
        ? lock_invalid_row(before, after, p.canvasWidth, p.canvasHeight)
        : lock_invalid_round(
            before, after,
            p.canvasWidth, p.canvasHeight,
            p.virtualWidth, p.virtualHeight,
            p.offsetX, p.offsetY, p.rounds,
          );
}

/* ── Symmetry ────────────────────────────────────────────────────────────── */
function refreshSymmetryUi() {
    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
    const closure = computeClosure(store.state.symmetry, diagonalsAvailable(W, H));
    ui.setSymmetry(store.state.symmetry, closure);
    ui.setDiagonalEnabled(diagonalsAvailable(W, H));
}
function toggleSym(k: SymKey) {
    store.commit(s => {
        const next = new Set(s.symmetry);
        if (next.has(k)) next.delete(k); else next.add(k);
        s.symmetry = next;
    }, { recompute: false });
    refreshSymmetryUi();
}

/* ── Tool / colour / settings handlers ─────────────────────────────────── */
function setTool(t: Tool) {
    if (altPrevTool !== null) {
        // Alt is held — the visible tool is Move and clicking another tool
        // button just *queues* it as the return tool, applied when the user
        // releases Alt. (Picking Move queues Move; restore is a no-op.)
        altPrevTool = t;
        return;
    }
    applyTool(t);
}
// Lower-level set used by both `setTool` (user picks) and the Alt swap, so
// the swap can set the tool without clobbering its own `altPrevTool`.
function applyTool(t: Tool) {
    store.commit(s => { s.activeTool = t; }, { recompute: false, render: false });
    ui.setTool(t);
}
function setPrimary(slot: 1 | 2) {
    store.commit(s => { s.primaryColor = slot; }, { recompute: false, render: false });
    ui.setPrimary(slot);
}
function onColorInput() {
    const a = (document.getElementById("color-a") as HTMLInputElement).value;
    const b = (document.getElementById("color-b") as HTMLInputElement).value;
    store.commit(s => { s.colorA = a; s.colorB = b; }, { recompute: false });
    ui.setColors(a, b);
}
// `change` fires when the picker closes — that's the user's "I'm done" signal
// and the right moment to push a history snapshot.
function onColorCommit() {
    store.commit(() => {}, { recompute: false, render: false, history: true });
}
function onHlOpacityInput() {
    const v = parseInt((document.getElementById("hl-opacity") as HTMLInputElement).value);
    store.commit(s => { s.hlOpacity = v; }, { recompute: false });
}
function onInvalidIntensityInput() {
    const v = parseInt((document.getElementById("invalid-intensity") as HTMLInputElement).value);
    store.commit(s => { s.invalidIntensity = v; }, { recompute: false });
}
function onLabelsToggle() {
    const v = (document.getElementById("labels-on") as HTMLInputElement).checked;
    store.commit(s => { s.labelsVisible = v; }, { recompute: false });
}
function onLockInvalidToggle() {
    const v = (document.getElementById("lock-invalid") as HTMLInputElement).checked;
    store.commit(s => { s.lockInvalid = v; }, { recompute: false, render: false });
}
function rotate(delta: number) {
    store.commit(s => { s.rotation += delta; }, { recompute: false });
}

function selectAll() {
    // Hole cells behave as outside the canvas — exclude them from select-all.
    const { pixels } = store.state;
    const all = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) all[i] = 1;
    store.commit(s => { s.selection = all; }, { recompute: false, history: true });
}
function deselect() {
    if (!store.state.selection) return;
    store.commit(s => { s.selection = null; }, { recompute: false, history: true });
}

/* ── Pattern (Edit) popover ─────────────────────────────────────────────── */
// No separate snapshot — the history head is already the pre-edit state.
// Live preview mutates `state` / `pixels` in memory without touching history;
// light-dismiss (Esc / outside click) commits via `onEditClose`.
function onEditOpen() {
    ui.syncEditInputs(store.state.pattern);
}
function onEditChange() {
    // Always derive the preview from the head (= pre-edit state), so reducing
    // and then restoring a value (e.g. rounds 1 → 20) brings the original
    // pattern back instead of permanently losing trimmed cells.
    const head: Restored | null = historyPeek();
    const { pattern, pixels } = applyEditSettings(head ?? undefined);
    // Fit BEFORE commit so the render inside commit uses the new viewport.
    fitToView(viewport.canvas, viewport.view, pattern, store.state.rotation);
    store.commit(s => {
        s.pattern  = pattern;
        s.pixels   = pixels;
        s.symmetry = pruneUnavailableDiagonals(s.symmetry, pattern.canvasWidth, pattern.canvasHeight);
        // Selection coords no longer make sense after a resize — clearer to
        // drop than try to remap (and trivially undoable via the same edit).
        s.selection = null;
    });
    refreshSymmetryUi();
}
// Light-dismiss commits the live-previewed state to history. Undo (Ctrl+Z) is
// the universal revert path — no Cancel/Apply buttons. `historySave` dedupes
// against the head so no-op edits don't grow it.
function onEditClose() {
    store.commit(() => {}, { recompute: false, render: false, history: true });
}

/* ── Undo / redo ─────────────────────────────────────────────────────────── */
function applyRestored(r: Restored) {
    // Refit only when canvas dims changed — paint-stroke undos preserve the
    // user's manual zoom; dim-changing undos (Edit popover) snap to fit.
    const dimsChanged = r.pattern.canvasWidth  !== store.state.pattern.canvasWidth
                     || r.pattern.canvasHeight !== store.state.pattern.canvasHeight;
    if (dimsChanged) fitToView(viewport.canvas, viewport.view, r.pattern, store.state.rotation);
    store.replace(
        { ...store.state, pattern: r.pattern, pixels: r.pixels, selection: r.selection,
          colorA: r.colorA, colorB: r.colorB },
        { persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = r.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = r.colorB;
    ui.setColors(r.colorA, r.colorB);
    ui.syncEditInputs(r.pattern);
    refreshSymmetryUi();
}
function undo() { const r = historyUndo(); if (r) applyRestored(r); }
function redo() { const r = historyRedo(); if (r) applyRestored(r); }

/* ── Save / load ─────────────────────────────────────────────────────────── */
async function onSave() { await saveToFile(store.state); }
async function onLoad() {
    const loaded = await loadFromFile(); if (!loaded) return;
    // Fit BEFORE replace so the render inside replace uses the new viewport.
    // `fitToView` also resets panX/Y to 0, so no separate reset needed.
    fitToView(viewport.canvas, viewport.view, loaded.pattern, store.state.rotation);
    store.replace(
        { ...store.state, pattern: loaded.pattern, pixels: loaded.pixels,
          colorA: loaded.colorA, colorB: loaded.colorB,
          selection: null /* loaded pattern's cells don't match prior selection's coords */ },
        { history: true, persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = loaded.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = loaded.colorB;
    ui.setColors(loaded.colorA, loaded.colorB);
    ui.syncEditInputs(loaded.pattern);
    refreshSymmetryUi();
}

/* ── Export ──────────────────────────────────────────────────────────────── */
async function onExport() {
    const dlg = ui.openExport();
    let cancelled = false;
    dlg.onClose(() => { cancelled = true; });
    // Plan stride 4; element 0 is the type (PlanType.Valid / Invalid).
    let hasInvalid = false;
    const plan = store.plan;
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] === PlanType.Invalid) { hasInvalid = true; break; }
    }
    dlg.setWarning(hasInvalid);

    const startSession = (alt: boolean) => {
        const { pattern, pixels } = store.state;
        const { canvasWidth: W, canvasHeight: H } = pattern;
        if (pattern.mode === "row") return export_start_row(pixels, W, H, alt);
        const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
        return export_start_round(pixels, W, H, vw, vh, ox, oy, rounds, alt);
    };

    let runId = 0;
    const run = async () => {
        const myRun = ++runId;
        dlg.setBusy(true);
        dlg.clearText();
        const session = startSession(dlg.alternate());
        const total = session.total();
        let count = 0;
        let line: string | undefined;
        while ((line = session.next()) !== undefined) {
            if (cancelled || myRun !== runId) { session.free(); dlg.endProgress(); return; }
            dlg.appendLine(line);
            dlg.setProgress(++count, total);
            await new Promise<void>(res => requestAnimationFrame(() => res()));
        }
        session.free();
        dlg.endProgress();
        dlg.setBusy(false);
    };

    dlg.onAlternate(run);
    run();
}

/* ── Mount UI + gestures ────────────────────────────────────────────────── */
const ui: UIHandle = mountUI({
    onTool: setTool,
    onPrimaryColor: setPrimary,
    onColorChange:  onColorInput,
    onColorCommit,
    onSym: toggleSym,
    onHighlightChange:         onHlOpacityInput,
    onInvalidIntensityChange:  onInvalidIntensityInput,
    onLabelsVisibleChange:     onLabelsToggle,
    onLockInvalidChange:   onLockInvalidToggle,
    onUndo: undo,
    onRedo: redo,
    onRotate: rotate,
    onEditOpen, onEditChange, onEditClose,
    onSave, onLoad, onExport,
});

// Wire client-coords → pattern-coords for gesture. Closes over `viewport`,
// `rs.visualRotation`, and the current pattern from the store.
const clientToPattern = (cx: number, cy: number) => {
    const pattern = store.state.pattern;
    const { x, y } = screenToPattern(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation, pattern, cx, cy,
    );
    const inside = x >= 0 && y >= 0 && x < pattern.canvasWidth && y < pattern.canvasHeight;
    return { x, y, inside };
};

mountGestures(viewport.canvas, viewport.view, clientToPattern, {
    primaryColor: () => store.state.primaryColor,
    onPaintStart: (color, mods) => {
        if (store.state.activeTool === "move") {
            // Move tool: first paintAt decides lift vs. no-op. Nothing to
            // initialise here. (Alt-held is the same code path because Alt
            // swaps the active tool to Move at the keyboard layer.)
            return;
        }
        if (store.state.activeTool === "select") {
            // Mode captured here; start/end filled in on the first onPaintAt
            // (gesture fires onPaintAt immediately after onPaintStart, so the
            // null window is one synchronous step).
            selectDrag = {
                startX: null, startY: null, endX: 0, endY: 0,
                mode: mods.shift ? "add" : (mods.ctrl ? "remove" : "replace"),
            };
            return;
        }
        if (store.state.activeTool === "wand") {
            wandDrag = {
                mode: mods.shift ? "add" : (mods.ctrl ? "remove" : "replace"),
                startSelection: store.state.selection,
                lastCell: null,
            };
            return;
        }
        strokeColor   = color;
        preStroke     = store.state.pixels.slice();
        invertVisited = store.state.activeTool === "invert" ? new Set<number>() : null;
    },
    onPaintAt:    (cx, cy) => {
        // Move tool: first paintAt resolves the click cell, decides lift,
        // subsequent moves update the float offset. Click outside any
        // selection is a no-op (the gesture is consumed; nothing paints).
        if (store.state.activeTool === "move" || floatDrag) {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (!floatDrag) {
                const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
                const sel = store.state.selection;
                const insideSel = sel !== null
                    && p.x >= 0 && p.x < W && p.y >= 0 && p.y < H
                    && sel[p.y * W + p.x] === 1;
                if (!insideSel) return;
                startMove(p.x, p.y);
                return;
            }
            if (rs.float) {
                rs.float.dx = p.x - floatDrag.startCellX;
                rs.float.dy = p.y - floatDrag.startCellY;
                render(viewport, ctx, rs, store);
            }
            return;
        }
        if (store.state.activeTool === "select" && selectDrag) {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (selectDrag.startX === null) {
                selectDrag.startX = p.x;
                selectDrag.startY = p.y;
            }
            selectDrag.endX = p.x;
            selectDrag.endY = p.y;
            syncPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        paintAt(cx, cy);
    },
    onPaintEnd:   () => {
        // Float drag owns the gesture until release regardless of the tool
        // that started it (Alt-down can swap the tool mid-air, but the
        // gesture state machine doesn't care).
        if (floatDrag) {
            finishMove();
            return;
        }
        if (store.state.activeTool === "select" && selectDrag) {
            const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
            const next = selectDrag.startX === null
                ? store.state.selection   // never moved → no change
                : commitSelectRect(
                    store.state.selection, store.state.pixels, W, H,
                    selectDrag.startX, selectDrag.startY!,
                    selectDrag.endX,   selectDrag.endY,
                    selectDrag.mode,
                );
            selectDrag = null;
            syncPreview();
            store.commit(s => { s.selection = next; },
                { recompute: false, history: true });
            return;
        }
        if (store.state.activeTool === "wand" && wandDrag) {
            // Drag steps committed without history; push one snapshot now
            // covering the whole sweep. `historySave` dedupes against the
            // head, so a no-op drag (no cell processed) won't push.
            if (wandDrag.lastCell !== null) {
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            wandDrag = null;
            return;
        }
        if (preStroke && !arraysEqual(preStroke, store.state.pixels)) {
            store.commit(() => {}, { recompute: false, render: false, history: true });
        }
        preStroke = null;
        invertVisited = null;
    },
    onPaintCancel: () => {
        if (floatDrag || rs.float) {
            floatDrag = null;
            rs.float  = null;
            render(viewport, ctx, rs, store);
            return;
        }
        if (store.state.activeTool === "select") {
            selectDrag = null;
            syncPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (store.state.activeTool === "wand" && wandDrag) {
            // Two-finger gesture started — revert to the pre-drag selection.
            const startSel = wandDrag.startSelection;
            wandDrag = null;
            store.commit(s => { s.selection = startSel; }, { recompute: false });
            return;
        }
        // Two-finger gesture started — revert the partial stroke.
        if (preStroke) {
            const snap = preStroke;
            store.commit(s => { s.pixels = snap; });
        }
        preStroke = null;
        invertVisited = null;
    },
    onHover:      (x, y) => updateStatus(store.plan, x, y),
    onView:       () => render(viewport, ctx, rs, store),
});

/* ── Keyboard shortcuts ──────────────────────────────────────────────────── */
// Restore the pre-Alt tool. Used by Alt keyup and window blur (since blur
// can swallow keyup if the user Alt-tabs away).
function restoreFromAlt() {
    if (altPrevTool === null) return;
    const prev  = altPrevTool;
    altPrevTool = null;
    applyTool(prev);
}

document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    // Alt is a momentary swap to the Move tool. `repeat` filters key-hold
    // re-fires; the activeTool check prevents re-saving Move-over-Move.
    if (e.key === "Alt") {
        if (!e.repeat && altPrevTool === null && store.state.activeTool !== "move") {
            altPrevTool = store.state.activeTool;
            applyTool("move");
        }
        e.preventDefault();   // suppress menu-bar focus on platforms that listen for bare Alt
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z"))) { e.preventDefault(); redo(); }
        else if (e.key === "a" && !e.shiftKey) { e.preventDefault(); selectAll(); }
        else if (e.key === "A" ||  (e.shiftKey && e.key === "a")) { e.preventDefault(); deselect(); }
        return;
    }
    // Alt held: don't fire any of our shortcuts. The browser's own Alt+key
    // bindings (Firefox menu activations, etc.) are then the user's problem
    // to live with — they just won't use shortcuts mid-Alt-hold.
    if (e.altKey) return;
    const k = e.key.toLowerCase();
    if      (k === "p") setTool("pencil");
    else if (k === "f") setTool("fill");
    else if (k === "e") setTool("eraser");
    else if (k === "o") setTool("overlay");
    else if (k === "i") setTool("invert");
    else if (k === "s") setTool("select");
    else if (k === "w") setTool("wand");
    else if (k === "m") setTool("move");
    else if (k === "v") toggleSym("V");
    else if (k === "h") toggleSym("H");
    else if (k === "c") toggleSym("C");
    else if (k === "d") toggleSym("D1");
    else if (k === "a") toggleSym("D2");
    else if (k === "r") rotate(e.shiftKey ? -45 : 45);
    else if (k === "1") setPrimary(1);
    else if (k === "2") setPrimary(2);
});

document.addEventListener("keyup", e => {
    if (e.key === "Alt") {
        restoreFromAlt();
        e.preventDefault();
    }
});

// If the user Alt-tabs away, the keyup never reaches us — restore on blur
// so they don't come back stuck on Move.
window.addEventListener("blur", restoreFromAlt);

/* ── Initial DOM-input sync + first render ───────────────────────────────── */
function syncDomInputs(s: Readonly<SessionState>) {
    (document.getElementById("color-a") as HTMLInputElement).value = s.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = s.colorB;
    (document.getElementById("hl-opacity")         as HTMLInputElement).value   = String(s.hlOpacity);
    (document.getElementById("invalid-intensity")  as HTMLInputElement).value   = String(s.invalidIntensity);
    (document.getElementById("labels-on")          as HTMLInputElement).checked = s.labelsVisible;
    (document.getElementById("lock-invalid") as HTMLInputElement).checked = s.lockInvalid;
}

syncDomInputs(store.state);
ui.setTool(store.state.activeTool);
ui.setPrimary(store.state.primaryColor);
ui.setColors(store.state.colorA, store.state.colorB);
ui.syncEditInputs(store.state.pattern);
ui.setHistory(canUndo(), canRedo());

if (saved) {
    fitToView(viewport.canvas, viewport.view, store.state.pattern, store.state.rotation);
    refreshSymmetryUi();
    historyEnsureInitialized(store.state);
    render(viewport, ctx, rs, store);
} else {
    const { pattern, pixels } = applyEditSettings();
    fitToView(viewport.canvas, viewport.view, pattern, store.state.rotation);
    store.commit(s => { s.pattern = pattern; s.pixels = pixels; });
    refreshSymmetryUi();
    historyReset(store.state);
    ui.setHistory(canUndo(), canRedo());
}
