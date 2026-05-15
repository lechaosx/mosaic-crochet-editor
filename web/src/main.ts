import { paint_pixel, flood_fill, wand_select, PlanType,
         paint_natural_row, paint_natural_round,
         paint_overlay_row, paint_overlay_round,
         clear_overlay_row, clear_overlay_round,
         lock_invalid_row, lock_invalid_round,
         cut_to_natural_row, cut_to_natural_round,
         export_start_row, export_start_round, symmetric_orbit_indices } from "@mosaic/wasm";
import { Tool, PatternState, SymKey, Float } from "./types";
import { makeViewport, makeRendererState, observeCanvasResize,
         render, fitToView, screenToPattern, updateStatus } from "./render";
import { applyEditSettings } from "./pattern";
import { Store, SessionState, visiblePixels } from "./store";
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

// Minimal sensible defaults — only used when no saved session exists.
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
        float:           null,
        labelsVisible:   true,
        lockInvalid:     false,
        rotation:        0,
    };
}

// ── Float helpers ────────────────────────────────────────────────────────────
// Commit the float into the canvas: stamp `float.pixels` at offset, clear
// `float`. Returns the new pixels buffer; caller passes back into the store.
function commitFloatToPixels(s: SessionState): Uint8Array {
    return visiblePixels(s);
}

// Cut cells from `pixels` to natural baseline, returning the new buffer.
function cutCells(pixels: Uint8Array, pattern: PatternState, mask: Uint8Array): Uint8Array {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    return pattern.mode === "row"
        ? cut_to_natural_row(pixels, W, H, mask)
        : cut_to_natural_round(
            pixels, W, H,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds,
            mask,
        );
}

// Lift the cells indicated by `liftMask` from `pixels` into a new (or
// extended) float. The float is created at dx=dy=0; if `into` is supplied,
// its mask is merged with `liftMask` (only the *new* cells get cut). The
// caller is responsible for ensuring `into.dx == 0 && into.dy == 0` —
// extending a displaced float would put new cells at the wrong source
// positions. `liftMask` should already exclude holes.
function liftCells(
    pixels: Uint8Array, pattern: PatternState, liftMask: Uint8Array, into: Float | null,
): { pixels: Uint8Array; float: Float | null } {
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    const n = W * H;
    const newMask   = into ? into.mask.slice()   : new Uint8Array(n);
    const newLifted = into ? into.pixels.slice() : new Uint8Array(n);
    const cutMask   = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (!liftMask[i]) continue;
        if (newMask[i])    continue;   // already in the float
        newMask[i]   = 1;
        newLifted[i] = pixels[i];
        cutMask[i]   = 1;
    }
    let anyCells = false;
    for (let i = 0; i < n; i++) if (newMask[i]) { anyCells = true; break; }
    if (!anyCells) return { pixels, float: null };
    let anyCut = false;
    for (let i = 0; i < n; i++) if (cutMask[i]) { anyCut = true; break; }
    const newPixels = anyCut ? cutCells(pixels, pattern, cutMask) : pixels;
    return { pixels: newPixels, float: { mask: newMask, pixels: newLifted, dx: 0, dy: 0 } };
}

// Build a mask covering `(x1,y1)..(x2,y2)` (inclusive, canvas-clipped),
// skipping hole cells.
function rectMask(pixels: Uint8Array, W: number, H: number,
                  x1: number, y1: number, x2: number, y2: number): Uint8Array {
    const m = new Uint8Array(W * H);
    const ux1 = Math.min(x1, x2), uy1 = Math.min(y1, y2);
    const ux2 = Math.max(x1, x2), uy2 = Math.max(y1, y2);
    if (ux2 < 0 || ux1 >= W || uy2 < 0 || uy1 >= H) return m;
    const cx1 = Math.max(0, ux1), cy1 = Math.max(0, uy1);
    const cx2 = Math.min(W - 1, ux2), cy2 = Math.min(H - 1, uy2);
    for (let y = cy1; y <= cy2; y++) {
        for (let x = cx1; x <= cx2; x++) {
            if (pixels[y * W + x] === 0) continue;
            m[y * W + x] = 1;
        }
    }
    return m;
}

// The float's shifted mask in canvas coordinates — used as a "selection
// mask" for paint clipping and hit-testing.
function shiftedFloatMask(s: SessionState): Uint8Array {
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    const out = new Uint8Array(W * H);
    if (!s.float) return out;
    const { mask, dx: fdx, dy: fdy } = s.float;
    for (let sy = 0; sy < H; sy++) {
        const srow = sy * W;
        for (let sx = 0; sx < W; sx++) {
            if (mask[srow + sx] === 0) continue;
            const dx = sx + fdx, dy = sy + fdy;
            if (dx < 0 || dx >= W || dy < 0 || dy >= H) continue;
            out[dy * W + dx] = 1;
        }
    }
    return out;
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const viewport = makeViewport(document.getElementById("canvas") as HTMLCanvasElement);
const ctx      = viewport.canvas.getContext("2d", { alpha: false })!;
const rs       = makeRendererState();
const saved    = loadFromLocalStorage();
const store    = new Store(saved ?? defaultSession());

// Stroke-scoped — captured at pointerdown, cleared at pointerup.
let preStroke:     Uint8Array | null = null;
let preFloat:      Float | null      = null;
let invertVisited: Set<number>| null = null;
let strokeColor:   1 | 2              = 1;

type SelectMode = "replace" | "add" | "remove";
// In-flight rectangle drag for the select tool. The lift happens on
// pointerup (drag preview is a marching-ants rect overlay).
let selectDrag: { startX: number | null; startY: number | null; endX: number; endY: number; mode: SelectMode } | null = null;
// In-flight magic-wand drag. Mode captured at paintdown; each cell entered
// runs `wand_select` and folds the result into the float. `preFloat` /
// `prePixels` snapshot pre-drag state so pointer-cancel can revert.
let wandDrag: { mode: SelectMode; lastCell: { x: number; y: number } | null } | null = null;
// Move-tool drag anchor: the click cell in **canvas coords**. During drag,
// the float's offset becomes `(cursor - anchor)`. `startDx/Dy` captures the
// float's pre-drag offset so the cursor's click cell stays under the
// finger as the float moves.
let moveDrag: {
    anchorX: number; anchorY: number;
    startDx: number; startDy: number;
} | null = null;
// Holding Alt temporarily switches the active tool to Move (the toolbar
// reflects it). Releasing Alt restores the previous tool. Picking a
// different tool while Alt is held queues that tool as the return target.
let altPrevTool: Tool | null = null;
// Ctrl held at Move-tool paintdown means "duplicate on release": stamp the
// float at its destination, then reset its offset to 0 so the source
// stays selected. Captured at pointerdown.
let pendingMoveDuplicate = false;
// Shift held at Move-tool paintdown means "mask only": at release, anchor
// the float at its source position (canvas content restored) and create a
// fresh uncut selection at the drag-end position (canvas there stays put).
let pendingMaskOnly = false;

function modeToCode(m: SelectMode): number {
    return m === "replace" ? 0 : m === "add" ? 1 : 2;
}

// Sync the renderer's drag-preview state. During a replace-mode select
// drag the existing float outline is hidden; for add/remove modes it
// stays visible.
function syncSelectPreview() {
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

observeCanvasResize(viewport.canvas, v => { viewport.dpr = v; }, () => render(viewport, ctx, rs, store));

// Renderer + side-effect channels (Store invokes them on every `commit`).
store.setRenderer (s => render(viewport, ctx, rs, s));
store.setHistoryFn(s => historySave(s));
store.setPersistFn(s => saveToLocalStorage(s));

// Observers — run after every commit.
store.addObserver(() => ui.setHistory(canUndo(), canRedo()));
store.addObserver(s => updateStatus(s.plan, null, null));

// ── Selection / lift operations ──────────────────────────────────────────────
// Commit any active float by stamping it into the canvas. If the float
// hasn't moved (dx=dy=0) this is a no-op — visiblePixels == pixels.
function ensureFloatCommitted(s: SessionState): { pixels: Uint8Array; float: null } {
    return { pixels: commitFloatToPixels(s), float: null };
}

// Unified selection-modify dispatched by both rect-select and wand. Three
// paths, each chosen to keep the float's existing lift state intact:
//   replace → anchor any active float, lift the region fresh
//   add     → lift just the new region cells into the float at
//             (canvas − offset) source positions; the existing float is
//             untouched (no stamp-and-relift). Cells whose source position
//             would fall off the W×H mask grid are skipped — those are
//             rare in practice and not worth a re-anchor.
//   remove  → stamp each region cell that's currently in the float back
//             onto the canvas at its visible position; mask shrinks.
function applySelectionMod(region: Uint8Array, mode: SelectMode) {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    const n = W * H;

    if (mode === "replace") {
        const anchored = s.float ? visiblePixels(s) : s.pixels;
        const clean = region.slice();
        for (let i = 0; i < n; i++) if (anchored[i] === 0) clean[i] = 0;
        const lifted = liftCells(anchored, s.pattern, clean, null);
        store.commit(state => { state.pixels = lifted.pixels; state.float = lifted.float; }, { history: true });
        return;
    }

    if (!s.float) {
        // No existing float: `add` lifts the region; `remove` is a no-op.
        if (mode === "add") {
            const clean = region.slice();
            for (let i = 0; i < n; i++) if (s.pixels[i] === 0) clean[i] = 0;
            const lifted = liftCells(s.pixels, s.pattern, clean, null);
            store.commit(state => { state.pixels = lifted.pixels; state.float = lifted.float; }, { history: true });
        }
        return;
    }

    const f = s.float;
    if (mode === "add") {
        const newMask   = f.mask.slice();
        const newLifted = f.pixels.slice();
        const cutMask   = new Uint8Array(n);
        let any = false;
        for (let cy = 0; cy < H; cy++) {
            for (let cx = 0; cx < W; cx++) {
                if (region[cy * W + cx] === 0) continue;
                if (s.pixels[cy * W + cx] === 0) continue;   // hole
                const sx = cx - f.dx, sy = cy - f.dy;
                if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
                if (newMask[sy * W + sx] === 1) continue;    // already in float
                newMask[sy * W + sx]   = 1;
                newLifted[sy * W + sx] = s.pixels[cy * W + cx];
                cutMask[cy * W + cx]   = 1;
                any = true;
            }
        }
        if (!any) return;
        const cutPixels = cutCells(s.pixels, s.pattern, cutMask);
        store.commit(state => {
            state.pixels = cutPixels;
            state.float  = { mask: newMask, pixels: newLifted, dx: f.dx, dy: f.dy };
        }, { history: true });
        return;
    }

    // mode === "remove"
    const newPixels = s.pixels.slice();
    const newMask   = f.mask.slice();
    const newLifted = f.pixels.slice();
    let removed = false;
    for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
            if (region[cy * W + cx] === 0) continue;
            const sx = cx - f.dx, sy = cy - f.dy;
            if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
            if (newMask[sy * W + sx] === 0) continue;
            if (newPixels[cy * W + cx] === 0) continue;     // hole — leave alone
            newPixels[cy * W + cx] = newLifted[sy * W + sx];
            newMask[sy * W + sx]   = 0;
            newLifted[sy * W + sx] = 0;
            removed = true;
        }
    }
    if (!removed) return;
    let any = false;
    for (let i = 0; i < n; i++) if (newMask[i]) { any = true; break; }
    store.commit(state => {
        state.pixels = newPixels;
        state.float  = any ? { mask: newMask, pixels: newLifted, dx: f.dx, dy: f.dy } : null;
    }, { history: true });
}

// Apply a select-tool rect drag with the given mode.
function commitSelectRect(x1: number, y1: number, x2: number, y2: number, mode: SelectMode) {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    // Rect is gated against the visible canvas so hole-exclusion follows
    // the user's view (the float counts as in-canvas content).
    const visible = visiblePixels(s);
    const region  = rectMask(visible, W, H, x1, y1, x2, y2);
    applySelectionMod(region, mode);
}

// Apply a wand-tool action at (x, y) with the given mode.
function commitWandAt(x: number, y: number, mode: SelectMode) {
    const s = store.state;
    const W = s.pattern.canvasWidth, H = s.pattern.canvasHeight;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const visible = visiblePixels(s);
    if (visible[y * W + x] === 0) return;   // hole click — no-op
    // Always pick the region with replace mode and apply the modifier
    // locally — the Rust `wand_select`'s "remove" mode wants an existing
    // mask to subtract from, which doesn't fit our float-based model.
    const region = wand_select(visible, W, H, x, y, 0, new Uint8Array(0));
    applySelectionMod(region, mode);
}

// ── Paint ────────────────────────────────────────────────────────────────────
// Paint operates on the *visible* canvas (pixels + float stamped). When a
// float is active, paint changes are clipped to its shifted mask and
// written back to `float.pixels`. When no float, paint writes to canvas.
// The pre-stroke snapshot is taken on pointerdown so pointer-cancel can
// revert; `arraysEqual` against post-stroke state drives history dedupe.
function paintAt(clientX: number, clientY: number) {
    const s = store.state;
    const { pattern } = s;
    const { x, y } = screenToPattern(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation, pattern, clientX, clientY,
    );
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const inCanvas = x >= 0 && x < W && y >= 0 && y < H;
    const tool = s.activeTool;

    if (tool === "select" || tool === "wand" || tool === "move") return;

    const shifted = s.float ? shiftedFloatMask(s) : null;
    const visible = visiblePixels(s);

    // Overlay tool handles gutter clicks specially.
    if (!inCanvas && tool !== "overlay") return;
    if (inCanvas && visible[y * W + x] === 0) return;   // hole
    // When a float is active, the click cell must be inside its shifted
    // mask (paint clip). Overlay's painted cell is the inward neighbour
    // of the click, but the click cell itself still has to be in the float.
    if (inCanvas && shifted && shifted[y * W + x] === 0) return;

    const symMask = getSymmetryMask(s.symmetry, W, H);
    const before  = visible;
    let next: Uint8Array;
    if (tool === "fill") {
        next = flood_fill(visible, W, H, x, y, strokeColor, symMask, shifted ?? new Uint8Array(0));
    } else if (tool === "eraser") {
        const invert = strokeColor !== s.primaryColor;
        if (pattern.mode === "row") {
            next = paint_natural_row(visible, W, H, x, y, symMask, invert);
        } else {
            const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
            next = paint_natural_round(visible, W, H, vw, vh, ox, oy, rounds, x, y, symMask, invert);
        }
    } else if (tool === "overlay") {
        const clear = strokeColor !== s.primaryColor;
        if (pattern.mode === "row") {
            next = clear
                ? clear_overlay_row(visible, W, H, x, y, symMask)
                : paint_overlay_row(visible, W, H, x, y, symMask);
        } else {
            const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
            next = clear
                ? clear_overlay_round(visible, W, H, vw, vh, ox, oy, rounds, x, y, symMask)
                : paint_overlay_round(visible, W, H, vw, vh, ox, oy, rounds, x, y, symMask);
        }
    } else if (tool === "invert") {
        next = visible.slice();
        const indices = symmetric_orbit_indices(W, H, x, y, symMask);
        for (const idx of indices) {
            if (invertVisited!.has(idx)) continue;
            invertVisited!.add(idx);
            const cur = next[idx];
            if      (cur === 1) next[idx] = 2;
            else if (cur === 2) next[idx] = 1;
        }
    } else {
        next = paint_pixel(visible, W, H, x, y, strokeColor, symMask);
    }

    // Clip cells outside the float mask back to `before`. Skipped for
    // overlay — its painted cell is the inward neighbour, and the click-
    // cell gate above already covered user intent.
    if (tool !== "overlay" && shifted) {
        const clipped = next.slice();
        for (let i = 0; i < clipped.length; i++) {
            if (shifted[i] === 0) clipped[i] = before[i];
        }
        next = clipped;
    }
    if (s.lockInvalid) next = lockAlwaysInvalid(pattern, before, next);

    // Split paint result back into canvas + float.
    if (s.float) {
        const newFloatPixels = s.float.pixels.slice();
        const { mask, dx: fdx, dy: fdy } = s.float;
        for (let sy = 0; sy < H; sy++) {
            for (let sx = 0; sx < W; sx++) {
                if (mask[sy * W + sx] === 0) continue;
                const cx = sx + fdx, cy = sy + fdy;
                if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
                newFloatPixels[sy * W + sx] = next[cy * W + cx];
            }
        }
        const newFloat: Float = { mask: s.float.mask, pixels: newFloatPixels, dx: fdx, dy: fdy };
        store.commit(state => { state.float = newFloat; });
    } else {
        const newPixels = next;
        store.commit(state => { state.pixels = newPixels; });
    }
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

// ── Symmetry ─────────────────────────────────────────────────────────────────
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

// ── Tool / colour / settings handlers ────────────────────────────────────────
function setTool(t: Tool) {
    if (altPrevTool !== null) {
        // Alt is held — queue the pick as the return tool; don't actually switch.
        altPrevTool = t;
        return;
    }
    applyTool(t);
}
// Switching tools keeps any active float alive — paint tools clip to its
// shifted mask, so the selection survives across tool changes (matching
// the user mental model of "selection persists until I deselect").
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

// Lift every non-hole, non-already-lifted cell into the float.
function selectAll() {
    const s = store.state;
    const { canvasWidth: W, canvasHeight: H } = s.pattern;
    let pixels = s.pixels;
    let float = s.float;
    if (float && (float.dx !== 0 || float.dy !== 0)) {
        ({ pixels, float } = ensureFloatCommitted(s));
    }
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) mask[i] = 1;
    ({ pixels, float } = liftCells(pixels, s.pattern, mask, float));
    store.commit(state => { state.pixels = pixels; state.float = float; }, { history: true });
}
// Anchor the float at its current position and clear it.
function anchorFloat() {
    if (!store.state.float) return;
    const newPixels = visiblePixels(store.state);
    store.commit(s => { s.pixels = newPixels; s.float = null; }, { history: true });
}
function deselect() {
    if (!store.state.float) return;
    anchorFloat();
}

// ── Clipboard ────────────────────────────────────────────────────────────────
// Bbox-bounded snapshot of a float, with its canvas-coord origin so paste
// lands at the same visual position. In-memory only.
let clipboard: {
    pixels: Uint8Array; mask: Uint8Array;
    w: number; h: number;
    originX: number; originY: number;
} | null = null;

// Yank the float into the clipboard (bbox-bounded, in canvas coords). Does
// NOT touch canvas pixels — copy / cut layer their own canvas effect on top.
function yankFloatToClipboard(): boolean {
    const f = store.state.float;
    if (!f) return false;
    const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
            if (f.mask[sy * W + sx] === 0) continue;
            const cx = sx + f.dx, cy = sy + f.dy;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        }
    }
    if (maxX < 0) return false;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const cbPixels = new Uint8Array(bw * bh);
    const cbMask   = new Uint8Array(bw * bh);
    for (let sy = 0; sy < H; sy++) {
        for (let sx = 0; sx < W; sx++) {
            if (f.mask[sy * W + sx] === 0) continue;
            const cx = sx + f.dx, cy = sy + f.dy;
            const bx = cx - minX, by = cy - minY;
            cbPixels[by * bw + bx] = f.pixels[sy * W + sx];
            cbMask[by * bw + bx]   = 1;
        }
    }
    clipboard = { pixels: cbPixels, mask: cbMask, w: bw, h: bh, originX: minX, originY: minY };
    return true;
}

// Copy: yank to clipboard AND stamp the float into the base canvas at its
// current position. The float stays alive on top, so the user can keep
// moving it; the stamp gives "I see this stays here even if I let the
// float go" semantics. Mirror of cut.
function copyFloat() {
    if (!yankFloatToClipboard()) return;
    const newPixels = visiblePixels(store.state);
    store.commit(s => { s.pixels = newPixels; }, { history: true });
}

// Cut: yank to clipboard AND clear the base canvas under the float's
// current visible position. Drops the float — the user has performed a
// destructive operation, so the marquee goes with it (Photoshop-style).
// A follow-up `Ctrl+V` brings the content back at the cut location.
function cutFloat() {
    if (!yankFloatToClipboard()) return;
    const shifted = shiftedFloatMask(store.state);
    const cleared = cutCells(store.state.pixels, store.state.pattern, shifted);
    store.commit(s => { s.pixels = cleared; s.float = null; }, { history: true });
}

// Paste: anchor any pending float, then create a new float from the
// clipboard at its original canvas coords. The new float is *uncut* — the
// canvas is unchanged underneath, so a regular Move-drag of the paste
// leaves the source pristine.
function pasteClipboard() {
    if (!clipboard) return;
    const s = store.state;
    if (s.float) anchorFloat();

    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
    const mask   = new Uint8Array(W * H);
    const pixels = new Uint8Array(W * H);
    let any = false;
    for (let dy = 0; dy < clipboard.h; dy++) {
        for (let dx = 0; dx < clipboard.w; dx++) {
            if (clipboard.mask[dy * clipboard.w + dx] === 0) continue;
            const cx = clipboard.originX + dx, cy = clipboard.originY + dy;
            if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
            if (store.state.pixels[cy * W + cx] === 0) continue;   // hole — drop
            mask[cy * W + cx]   = 1;
            pixels[cy * W + cx] = clipboard.pixels[dy * clipboard.w + dx];
            any = true;
        }
    }
    if (!any) return;
    if (store.state.activeTool !== "move") applyTool("move");
    store.commit(state => {
        state.float = { mask, pixels, dx: 0, dy: 0 };
    }, { history: true });
}

// ── Pattern (Edit) popover ──────────────────────────────────────────────────
function onEditOpen() {
    ui.syncEditInputs(store.state.pattern);
}
function onEditChange() {
    // Re-derive the preview from the head (= pre-edit state) each tick so
    // reducing then restoring a value (e.g. rounds 1 → 20) brings the
    // original cells back. If the head carried a float, bake it into the
    // source pixels — otherwise the resize would silently drop the
    // float's content along with the geometry-invalid mask.
    const head: Restored | null = historyPeek();
    const source: { pattern: PatternState; pixels: Uint8Array } | undefined = head
        ? (head.float
            ? { pattern: head.pattern,
                pixels:  visiblePixels({ ...store.state, pattern: head.pattern, pixels: head.pixels, float: head.float }) }
            : { pattern: head.pattern, pixels: head.pixels })
        : undefined;
    const { pattern, pixels } = applyEditSettings(source);
    fitToView(viewport.canvas, viewport.view, pattern, store.state.rotation);
    store.commit(s => {
        s.pattern  = pattern;
        s.pixels   = pixels;
        s.symmetry = pruneUnavailableDiagonals(s.symmetry, pattern.canvasWidth, pattern.canvasHeight);
        // Float coords no longer match the new geometry; the content (if any)
        // was baked into the source pixels above before the resize.
        s.float    = null;
    });
    refreshSymmetryUi();
}
function onEditClose() {
    store.commit(() => {}, { recompute: false, render: false, history: true });
}

// ── Undo / redo ──────────────────────────────────────────────────────────────
function applyRestored(r: Restored) {
    const dimsChanged = r.pattern.canvasWidth  !== store.state.pattern.canvasWidth
                     || r.pattern.canvasHeight !== store.state.pattern.canvasHeight;
    if (dimsChanged) fitToView(viewport.canvas, viewport.view, r.pattern, store.state.rotation);
    store.replace(
        { ...store.state, pattern: r.pattern, pixels: r.pixels, float: r.float,
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

// ── Save / load ──────────────────────────────────────────────────────────────
async function onSave() {
    // Save reflects the user-visible state — bake the float into a
    // throwaway snapshot for the file, but leave the live float alone so
    // the selection survives across save.
    const snapshot: SessionState = store.state.float
        ? { ...store.state, pixels: visiblePixels(store.state), float: null }
        : store.state;
    await saveToFile(snapshot);
}
async function onLoad() {
    const loaded = await loadFromFile(); if (!loaded) return;
    fitToView(viewport.canvas, viewport.view, loaded.pattern, store.state.rotation);
    store.replace(
        { ...store.state, pattern: loaded.pattern, pixels: loaded.pixels,
          colorA: loaded.colorA, colorB: loaded.colorB, float: null },
        { history: true, persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = loaded.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = loaded.colorB;
    ui.setColors(loaded.colorA, loaded.colorB);
    ui.syncEditInputs(loaded.pattern);
    refreshSymmetryUi();
}

// ── Export ───────────────────────────────────────────────────────────────────
async function onExport() {
    // Export reflects the user-visible state. Bake the float into a local
    // pixels buffer for the export session but leave the live float alive —
    // closing the export dialog shouldn't drop the user's selection.
    const exportPixels = store.state.float ? visiblePixels(store.state) : store.state.pixels;
    const dlg = ui.openExport();
    let cancelled = false;
    dlg.onClose(() => { cancelled = true; });
    let hasInvalid = false;
    const plan = store.plan;
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] === PlanType.Invalid) { hasInvalid = true; break; }
    }
    dlg.setWarning(hasInvalid);

    const startSession = (alt: boolean) => {
        const { pattern } = store.state;
        const { canvasWidth: W, canvasHeight: H } = pattern;
        if (pattern.mode === "row") return export_start_row(exportPixels, W, H, alt);
        const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
        return export_start_round(exportPixels, W, H, vw, vh, ox, oy, rounds, alt);
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

// ── Mount UI + gestures ─────────────────────────────────────────────────────
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
            // Shift dominates Ctrl. Shift = mask-only (committed at release);
            // Ctrl alone = duplicate (pre-stamp at paintdown so the
            // duplicate is visible throughout the drag); nothing = plain
            // move (just dx/dy updates). preStroke / preFloat let
            // pointer-cancel revert the Ctrl pre-stamp.
            pendingMaskOnly      = mods.shift;
            pendingMoveDuplicate = mods.ctrl && !mods.shift;
            // Remember the pre-drag float so pointer-cancel can revert.
            if (store.state.float) preFloat = store.state.float;
            if (pendingMaskOnly && store.state.float) {
                // Mask-only: stamp the float into the canvas at its current
                // position FIRST so the lifted content isn't lost when we
                // clear the float's pixels. Then empty the float — during
                // the drag the marquee moves but content is invisible
                // (zero pixels skip stamping in `visiblePixels`). At
                // release the empty mask is filled by lifting cells from
                // the canvas at the new position.
                const stamped = visiblePixels(store.state);
                const f = store.state.float;
                const emptied: Float = { mask: f.mask, pixels: new Uint8Array(f.pixels.length), dx: f.dx, dy: f.dy };
                store.commit(s => { s.pixels = stamped; s.float = emptied; }, { persist: false });
            } else if (pendingMoveDuplicate && store.state.float) {
                preStroke = store.state.pixels.slice();
                const stamped = visiblePixels(store.state);
                store.commit(s => { s.pixels = stamped; }, { persist: false });
            }
            return;
        }
        if (store.state.activeTool === "select") {
            selectDrag = {
                startX: null, startY: null, endX: 0, endY: 0,
                mode: mods.shift ? "add" : (mods.ctrl ? "remove" : "replace"),
            };
            return;
        }
        if (store.state.activeTool === "wand") {
            wandDrag = {
                mode: mods.shift ? "add" : (mods.ctrl ? "remove" : "replace"),
                lastCell: null,
            };
            preFloat  = store.state.float;
            preStroke = store.state.pixels.slice();
            return;
        }
        strokeColor   = color;
        preStroke     = store.state.pixels.slice();
        preFloat      = store.state.float;
        invertVisited = store.state.activeTool === "invert" ? new Set<number>() : null;
    },
    onPaintAt:    (cx, cy) => {
        if (store.state.activeTool === "move" || moveDrag) {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            const f = store.state.float;
            if (!moveDrag) {
                if (!f) return;
                // Click must land inside the float's visible (shifted) mask
                // to start a drag. Clicks outside are a no-op — the float
                // lives until explicit deselect / Ctrl+A / modify-select etc.,
                // so a stray click can't accidentally anchor it.
                const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
                const sx = p.x - f.dx, sy = p.y - f.dy;
                const insideFloat = sx >= 0 && sx < W && sy >= 0 && sy < H && f.mask[sy * W + sx] === 1;
                if (!insideFloat) return;
                moveDrag = { anchorX: p.x, anchorY: p.y, startDx: f.dx, startDy: f.dy };
                return;
            }
            if (!f) { moveDrag = null; return; }
            const newDx = moveDrag.startDx + (p.x - moveDrag.anchorX);
            const newDy = moveDrag.startDy + (p.y - moveDrag.anchorY);
            if (newDx !== f.dx || newDy !== f.dy) {
                store.commit(s => {
                    s.float = { mask: f.mask, pixels: f.pixels, dx: newDx, dy: newDy };
                }, { persist: false });
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
            syncSelectPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (store.state.activeTool === "wand" && wandDrag) {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (p.x < 0 || p.x >= store.state.pattern.canvasWidth) return;
            if (p.y < 0 || p.y >= store.state.pattern.canvasHeight) return;
            if (wandDrag.lastCell && wandDrag.lastCell.x === p.x && wandDrag.lastCell.y === p.y) return;
            wandDrag.lastCell = { x: p.x, y: p.y };
            commitWandAt(p.x, p.y, wandDrag.mode);
            return;
        }
        paintAt(cx, cy);
    },
    onPaintEnd:   () => {
        if (moveDrag) {
            if (pendingMaskOnly && store.state.float) {
                // Mask-only release: the float has been moving with empty
                // pixels. Now lift the canvas content at the float's
                // current shifted position into the float — same shape as
                // a fresh rect-select at the marquee's end position.
                const shifted = shiftedFloatMask(store.state);
                const lifted  = liftCells(store.state.pixels, store.state.pattern, shifted, null);
                store.commit(s => { s.pixels = lifted.pixels; s.float = lifted.float; }, { history: true });
            } else {
                // Regular and Ctrl-drag converge here: the duplicate's
                // pre-stamp already happened at paintdown, so the release
                // just records the final dx/dy.
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            moveDrag = null;
            pendingMoveDuplicate = false;
            pendingMaskOnly      = false;
            preStroke = null;
            preFloat  = null;
            return;
        }
        if (store.state.activeTool === "select" && selectDrag) {
            if (selectDrag.startX !== null) {
                commitSelectRect(
                    selectDrag.startX, selectDrag.startY!,
                    selectDrag.endX,   selectDrag.endY,
                    selectDrag.mode,
                );
            }
            selectDrag = null;
            syncSelectPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (store.state.activeTool === "wand" && wandDrag) {
            if (wandDrag.lastCell !== null) {
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            wandDrag = null;
            preFloat = null;
            preStroke = null;
            return;
        }
        // Other tools: dedupe-push a snapshot if state actually changed.
        const changed = (preStroke && !arraysEqual(preStroke, store.state.pixels))
                     || preFloat !== store.state.float;
        if (changed) store.commit(() => {}, { recompute: false, render: false, history: true });
        preStroke = null;
        preFloat  = null;
        invertVisited = null;
    },
    onPaintCancel: () => {
        if (moveDrag) {
            moveDrag = null;
            pendingMoveDuplicate = false;
            pendingMaskOnly      = false;
            const beforePixels = preStroke;
            const beforeFloat  = preFloat;
            preStroke = null;
            preFloat  = null;
            // Fully restore pre-drag state: pixels (in case of Ctrl pre-stamp)
            // and the entire float (offset, content, mask).
            store.commit(s => {
                if (beforePixels)  s.pixels = beforePixels;
                if (beforeFloat)   s.float  = beforeFloat;
            });
            return;
        }
        if (store.state.activeTool === "select") {
            selectDrag = null;
            syncSelectPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (store.state.activeTool === "wand" && wandDrag) {
            // Revert to pre-drag state — partial wand sweep is lost.
            const beforePixels = preStroke;
            const beforeFloat  = preFloat;
            wandDrag = null;
            preFloat = null;
            preStroke = null;
            if (beforePixels && beforeFloat !== undefined) {
                store.commit(s => { s.pixels = beforePixels; s.float = beforeFloat; }, { recompute: true });
            }
            return;
        }
        if (preStroke) {
            const snap = preStroke;
            const snapFloat = preFloat;
            store.commit(s => { s.pixels = snap; s.float = snapFloat; });
        }
        preStroke = null;
        preFloat  = null;
        invertVisited = null;
    },
    onHover:      (x, y) => updateStatus(store.plan, x, y),
    onView:       () => render(viewport, ctx, rs, store),
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
function restoreFromAlt() {
    if (altPrevTool === null) return;
    const prev  = altPrevTool;
    altPrevTool = null;
    applyTool(prev);
}

document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Alt") {
        if (!e.repeat && altPrevTool === null && store.state.activeTool !== "move") {
            altPrevTool = store.state.activeTool;
            applyTool("move");
        }
        e.preventDefault();
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z"))) { e.preventDefault(); redo(); }
        else if (e.key === "a" && !e.shiftKey) { e.preventDefault(); selectAll(); }
        else if (e.key === "A" ||  (e.shiftKey && e.key === "a")) { e.preventDefault(); deselect(); }
        else if (e.key === "c" && !e.shiftKey) { e.preventDefault(); copyFloat(); }
        else if (e.key === "x" && !e.shiftKey) { e.preventDefault(); cutFloat(); }
        else if (e.key === "v" && !e.shiftKey) { e.preventDefault(); pasteClipboard(); }
        return;
    }
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

window.addEventListener("blur", restoreFromAlt);

// Force the Edit popover to commit its live preview (via its `toggle`
// → `onEditClose` chain) before any *outside* user input runs. The popover
// already light-dismisses on outside click, but doing it in capture phase
// guarantees `onEditClose`'s history push lands BEFORE the button or
// keyboard handler that the user actually invoked — otherwise that handler
// (e.g. Undo) runs against the pre-commit head and the edit silently dies.
{
    type Popover = HTMLElement & { hidePopover: () => void };
    const editPopover = document.getElementById("edit-pattern-widget") as Popover | null;
    if (editPopover) {
        const dismissIfOpen = () => {
            if (editPopover.matches(":popover-open")) editPopover.hidePopover();
        };
        document.addEventListener("pointerdown", e => {
            if (!editPopover.contains(e.target as Node)) dismissIfOpen();
        }, true);
        document.addEventListener("keydown", e => {
            const t = e.target as HTMLElement | null;
            const inInput = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
            if (!inInput) dismissIfOpen();
        }, true);
    }
}

// ── Initial DOM-input sync + first render ────────────────────────────────────
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
