import { PlanType, lock_invalid_row, lock_invalid_round,
         export_start_row, export_start_round } from "@mosaic/wasm";
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
import { SelectMode, liftCells, shiftedFloatMask, anchorIntoCanvas,
         commitSelectRect, commitWandAt, selectAll, deselect, anchorFloat } from "./selection";
import { copyFloat, cutFloat, pasteClipboard } from "./clipboard";
import { PaintTool, paintOps } from "./paint";

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

// ── Boot ─────────────────────────────────────────────────────────────────────
const viewport = makeViewport(document.getElementById("canvas") as HTMLCanvasElement);
const ctx      = viewport.canvas.getContext("2d", { alpha: false })!;
const rs       = makeRendererState();
const saved    = loadFromLocalStorage();
const store    = new Store(saved ?? defaultSession());

// Move-tool drag mode, captured at paintdown from the modifiers:
//   "move"       → no modifier; drag updates `float.dx/dy`, release records.
//   "duplicate"  → Ctrl; pre-stamps the float into canvas at paintdown
//                  (visible duplicate carried through the drag), release
//                  records the moved float at the drag end.
//   "mask-only"  → Shift (dominates Ctrl); paintdown stamps the float into
//                  canvas at its current position and zeros `float.pixels`,
//                  drag carries the empty marquee, release lifts the
//                  canvas content at the new mask position.
type MoveMode = "move" | "duplicate" | "mask-only";

// One discriminated-union active per gesture, set at `onPaintStart`,
// updated on `onPaintAt`, consumed (committed or reverted) on
// `onPaintEnd` / `onPaintCancel`, then cleared. Replaces the half-dozen
// `selectDrag` / `wandDrag` / `moveDrag` / `preStroke` / `preFloat` /
// `pendingMoveMode` module vars — one variable, one cleared state.
//   paint  — pencil / fill / eraser / overlay / invert. `prePixels` /
//            `preFloat` snapshot pre-stroke state for cancel revert and
//            history dedupe; `invertVisited` only non-null for invert.
//   select — rect drag. `rect` stays null until the first paintAt so
//            single-click vs drag is detected consistently.
//   wand   — wand drag. `lastCell` dedupes when the cursor lingers in
//            one cell across moves.
//   move   — Move-tool drag. `drag` is null until the first paintAt
//            resolves the click cell. `prePixels` is only set when
//            paintdown mutated `s.pixels` (duplicate's pre-stamp,
//            mask-only's stamp) so cancel can revert.
type Gesture =
    | { kind: "paint";
        color: 1 | 2;
        prePixels: Uint8Array;
        preFloat: Float | null;
        invertVisited: Set<number> | null;
      }
    | { kind: "select";
        mode: SelectMode;
        rect: { startX: number; startY: number; endX: number; endY: number } | null;
      }
    | { kind: "wand";
        mode: SelectMode;
        lastCell: { x: number; y: number } | null;
        prePixels: Uint8Array;
        preFloat: Float | null;
      }
    | { kind: "move";
        mode: MoveMode;
        drag: { anchorX: number; anchorY: number; startDx: number; startDy: number } | null;
        prePixels: Uint8Array | null;
        preFloat: Float | null;
      };
let gesture: Gesture | null = null;
// Holding Alt temporarily switches the active tool to Move (the toolbar
// reflects it). Releasing Alt restores the previous tool. Picking a
// different tool while Alt is held queues that tool as the return target.
let altPrevTool: Tool | null = null;

function modeToCode(m: SelectMode): number {
    return m === "replace" ? 0 : m === "add" ? 1 : 2;
}

// Sync the renderer's drag-preview state. During a replace-mode select
// drag the existing float outline is hidden; for add/remove modes it
// stays visible.
function syncSelectPreview() {
    const g = gesture?.kind === "select" ? gesture : null;
    if (!g || !g.rect) {
        rs.hideCommittedSelection = false;
        rs.dragRect               = null;
        return;
    }
    rs.hideCommittedSelection = g.mode === "replace";
    rs.dragRect = {
        x1: g.rect.startX, y1: g.rect.startY,
        x2: g.rect.endX,   y2: g.rect.endY,
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

// ── Paint ────────────────────────────────────────────────────────────────────
// Paint operates on the *visible* canvas (pixels + float stamped). When a
// float is active, paint changes are clipped to its shifted mask and
// written back to `float.pixels`. When no float, paint writes to canvas.
// `g.prePixels` / `g.preFloat` (captured at paintdown) drive cancel revert
// and the change-detection that decides whether release pushes a snapshot.
function paintAt(clientX: number, clientY: number, g: Extract<Gesture, { kind: "paint" }>) {
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
    let next = paintOps[tool as PaintTool]({
        visible, pattern, x, y,
        color: g.color, primary: s.primaryColor,
        invertVisited: g.invertVisited,
        symMask, shifted,
    });

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
        const newFloat = Float.withPixels(s.float, newFloatPixels);
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

// `Ctrl+V` extra: switch to the Move tool so the user can drag the paste.
// `pasteClipboard` itself only touches state; the tool switch is a UI side
// effect that lives here in the orchestrator.
function onPaste() {
    if (store.state.activeTool !== "move") applyTool("move");
    if (!pasteClipboard(store)) {
        // Couldn't paste (no clipboard, or all cells dropped). The
        // `applyTool` above still ran; that's fine — switching to Move
        // with no float is harmless.
    }
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
        ? { ...store.state, ...anchorIntoCanvas(store.state) }
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
    const exportPixels = store.state.float
        ? anchorIntoCanvas(store.state).pixels
        : store.state.pixels;
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
        const tool = store.state.activeTool;
        if (tool === "move") {
            const mode: MoveMode = mods.shift ? "mask-only" : mods.ctrl ? "duplicate" : "move";
            let prePixels: Uint8Array | null = null;
            const preFloat = store.state.float;
            if (mode === "mask-only" && preFloat) {
                // Stamp the float into the canvas at its current position
                // FIRST so the lifted content isn't lost when we clear the
                // float's pixels. Then empty the float — during the drag
                // the marquee moves but content is invisible (zero pixels
                // skip stamping in `visiblePixels`). Release lifts cells
                // from the canvas at the new position.
                prePixels = store.state.pixels.slice();
                const stamped = visiblePixels(store.state);
                const emptied = Float.withPixels(preFloat, new Uint8Array(preFloat.pixels.length));
                store.commit(s => { s.pixels = stamped; s.float = emptied; }, { persist: false });
            } else if (mode === "duplicate" && preFloat) {
                // Pre-stamp the float into canvas so the duplicate is
                // visible throughout the drag.
                prePixels = store.state.pixels.slice();
                const stamped = visiblePixels(store.state);
                store.commit(s => { s.pixels = stamped; }, { persist: false });
            }
            gesture = { kind: "move", mode, drag: null, prePixels, preFloat };
            return;
        }
        if (tool === "select") {
            gesture = {
                kind: "select",
                mode: mods.shift ? "add" : mods.ctrl ? "remove" : "replace",
                rect: null,
            };
            return;
        }
        if (tool === "wand") {
            gesture = {
                kind: "wand",
                mode: mods.shift ? "add" : mods.ctrl ? "remove" : "replace",
                lastCell: null,
                prePixels: store.state.pixels.slice(),
                preFloat:  store.state.float,
            };
            return;
        }
        gesture = {
            kind: "paint",
            color,
            prePixels: store.state.pixels.slice(),
            preFloat:  store.state.float,
            invertVisited: tool === "invert" ? new Set<number>() : null,
        };
    },
    onPaintAt:    (cx, cy) => {
        if (!gesture) return;
        if (gesture.kind === "move") {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            const f = store.state.float;
            if (!gesture.drag) {
                // First paintAt: try to start a drag. Click must land inside
                // the float's shifted mask. Clicks outside are a no-op — the
                // float lives until explicit deselect / Ctrl+A / modify-select
                // / etc., so a stray click can't accidentally anchor it.
                if (!f) return;
                const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
                const sx = p.x - f.dx, sy = p.y - f.dy;
                const insideFloat = sx >= 0 && sx < W && sy >= 0 && sy < H && f.mask[sy * W + sx] === 1;
                if (!insideFloat) return;
                gesture.drag = { anchorX: p.x, anchorY: p.y, startDx: f.dx, startDy: f.dy };
                return;
            }
            if (!f) { gesture.drag = null; return; }
            const newDx = gesture.drag.startDx + (p.x - gesture.drag.anchorX);
            const newDy = gesture.drag.startDy + (p.y - gesture.drag.anchorY);
            if (newDx !== f.dx || newDy !== f.dy) {
                store.commit(s => { s.float = Float.shifted(f, newDx, newDy); }, { persist: false });
            }
            return;
        }
        if (gesture.kind === "select") {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (!gesture.rect) {
                gesture.rect = { startX: p.x, startY: p.y, endX: p.x, endY: p.y };
            } else {
                gesture.rect.endX = p.x;
                gesture.rect.endY = p.y;
            }
            syncSelectPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (gesture.kind === "wand") {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (p.x < 0 || p.x >= store.state.pattern.canvasWidth) return;
            if (p.y < 0 || p.y >= store.state.pattern.canvasHeight) return;
            if (gesture.lastCell && gesture.lastCell.x === p.x && gesture.lastCell.y === p.y) return;
            gesture.lastCell = { x: p.x, y: p.y };
            commitWandAt(store, p.x, p.y, gesture.mode);
            return;
        }
        // gesture.kind === "paint"
        paintAt(cx, cy, gesture);
    },
    onPaintEnd:   () => {
        if (!gesture) return;
        if (gesture.kind === "move") {
            if (!gesture.drag) { gesture = null; return; }
            if (gesture.mode === "mask-only" && store.state.float) {
                // The float has been moving with empty pixels. Now lift the
                // canvas content at the float's current shifted position —
                // same shape as a fresh rect-select at the marquee's end.
                const shifted = shiftedFloatMask(store.state);
                const lifted  = liftCells(store.state.pixels, store.state.pattern, shifted);
                store.commit(s => { s.pixels = lifted.pixels; s.float = lifted.float; }, { history: true });
            } else {
                // Move and duplicate converge here: the duplicate's pre-stamp
                // already happened at paintdown, so release just records the
                // final dx/dy.
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            gesture = null;
            return;
        }
        if (gesture.kind === "select") {
            if (gesture.rect) {
                commitSelectRect(
                    store,
                    gesture.rect.startX, gesture.rect.startY,
                    gesture.rect.endX,   gesture.rect.endY,
                    gesture.mode,
                );
            }
            gesture = null;
            syncSelectPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (gesture.kind === "wand") {
            if (gesture.lastCell !== null) {
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            gesture = null;
            return;
        }
        // gesture.kind === "paint" — dedupe-push if state actually changed.
        const changed = !arraysEqual(gesture.prePixels, store.state.pixels)
                     || gesture.preFloat !== store.state.float;
        if (changed) store.commit(() => {}, { recompute: false, render: false, history: true });
        gesture = null;
    },
    onPaintCancel: () => {
        if (!gesture) return;
        if (gesture.kind === "move") {
            const { prePixels, preFloat } = gesture;
            gesture = null;
            // Restore pre-drag state: pixels (if paintdown pre-stamped) and
            // the entire float (offset, content, mask).
            store.commit(s => {
                if (prePixels) s.pixels = prePixels;
                s.float = preFloat;
            });
            return;
        }
        if (gesture.kind === "select") {
            gesture = null;
            syncSelectPreview();
            render(viewport, ctx, rs, store);
            return;
        }
        if (gesture.kind === "wand") {
            // Revert to pre-drag state — partial wand sweep is lost.
            const { prePixels, preFloat } = gesture;
            gesture = null;
            store.commit(s => { s.pixels = prePixels; s.float = preFloat; });
            return;
        }
        // gesture.kind === "paint"
        const { prePixels, preFloat } = gesture;
        gesture = null;
        store.commit(s => { s.pixels = prePixels; s.float = preFloat; });
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
        else if (e.key === "a" && !e.shiftKey) { e.preventDefault(); selectAll(store); }
        else if (e.key === "A" ||  (e.shiftKey && e.key === "a")) { e.preventDefault(); deselect(store); }
        else if (e.key === "c" && !e.shiftKey) { e.preventDefault(); copyFloat(store); }
        else if (e.key === "x" && !e.shiftKey) { e.preventDefault(); cutFloat(store); }
        else if (e.key === "v" && !e.shiftKey) { e.preventDefault(); onPaste(); }
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
