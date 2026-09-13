import { PlanType, lock_invalid_row, lock_invalid_round,
         overlay_target_available_row, overlay_target_available_round,
         export_start_row, export_start_round } from "@mosaic/wasm";
import { Tool, PatternState, SymKey, Float, Axis } from "@mosaic/logic/types";
import { makeViewport, makeRendererState, observeCanvasResize,
         render, fitToView, zoomAt, screenToPattern, screenToPatternFrac, updateStatus } from "./render";
import { applyEditSettings } from "./pattern";
import { Store, SessionState, visiblePixels, outOfBounds } from "@mosaic/logic/store";
import { historySave, historyReset, historyEnsureInitialized,
         historyUndo, historyRedo, canUndo, canRedo, Restored } from "./history";
import { addAxis, removeAxis, toggleAxisActive,
         pickAxesAt, setAxisPosition, snapHalf, snapInt,
         axisOffCanvas } from "@mosaic/logic/symmetry";
import { defaultRepeatGrid, repeatGridError, transformsToFlat } from "@mosaic/logic/repeat";
import { saveToLocalStorage, loadFromLocalStorage, saveToFile, loadFromFile, LoadedFile } from "./storage-io";
import { mountUI, UIHandle, SelectionMoveMode } from "./ui";
import { mountGestures } from "./gesture";
import { SelectMode, liftCells, shiftedFloatMask, anchorIntoCanvas,
         commitSelectRect, commitWandAt, selectAll, deselect, anchorFloat,
         deleteFloat, clipFloatToCanvas, replicateSelection } from "@mosaic/logic/selection";
import { copyFloat, cutFloat, pasteClipboard, clipboardCellCount } from "@mosaic/logic/clipboard";
import { PaintTool, paintOps } from "@mosaic/logic/paint";

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
        axes:           [],
        repeat:         defaultRepeatGrid(),
        liveTransforms: true,
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
let selectionMoveMode: SelectionMoveMode = "move";
let navigateLatched = false;
let navigateMomentary = false;

// Move-tool drag mode, chosen at paintdown from the UI mode and modifiers:
//   "move"      → no modifier; drag repositions the float, release records.
//   "duplicate" → Ctrl; pre-stamps the float into canvas at paintdown so the
//                 duplicate is visible during drag, release records the new pos.
//   "mask-only" → latched UI mode or Alt (dominates Ctrl); stamps at paintdown,
//                 drag carries the marquee shape (pixels mirror canvas at the
//                 new position), release re-lifts the canvas content there.
type MoveMode = SelectionMoveMode;

// One discriminated-union active per gesture, set at `onPaintStart`,
// updated on `onPaintAt`, consumed (committed or reverted) on
// `onPaintEnd` / `onPaintCancel`, then cleared.
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
      }
    | { kind: "axis-drag";
        // One pick per kind: clicking an intersection grabs one of each
        // kind so dragging moves them together. Parallel overlapping axes
        // of the same kind are disambiguated by closeness (only the
        // nearest is picked), so the user can drag it away to separate.
        picks: { id: string; kind: SymKey }[];
        // Snapshot the axes list so cancel can revert without recomputing.
        preAxes: Axis[];
      };
// Click within this many cell-units of an active axis guide starts an
// axis-drag instead of float-move. ~0.4 keeps the affordance close to the
// 1-cell-wide visual line without being so wide that float-move suffers.
const AXIS_HIT_TOLERANCE = 0.4;

let gesture: Gesture | null = null;
let gestureFeedbackShown = false;
let ctrlArrowStamped = false;                        // bake happens once per Ctrl-down
let maskArrowState: { preFloat: Float } | null = null; // non-null while Alt+Arrow is active

function modeToCode(m: SelectMode): number {
    return m === "replace" ? 0 : m === "add" ? 1 : 2;
}

function showGestureFeedback(message: string) {
    if (gestureFeedbackShown) return;
    gestureFeedbackShown = true;
    ui.setCanvasFeedback(message);
}

function overlayTargetAvailable(pattern: PatternState, x: number, y: number): boolean {
    return pattern.mode === "row"
        ? overlay_target_available_row(pattern.canvasWidth, pattern.canvasHeight, x, y)
        : overlay_target_available_round(
            pattern.canvasWidth, pattern.canvasHeight,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds,
            x, y,
        );
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
store.setPersistFn(s => {
    ui.setRecoveryStatus(saveToLocalStorage(s) ? "saved" : "failed");
});

// Observers — run after every commit.
store.addObserver(() => ui.setHistory(canUndo(), canRedo()));
store.addObserver(s => ui.setViewState(
    viewport.view.zoom, s.state.rotation, navigateLatched || navigateMomentary,
));
store.addObserver(s => updateStatus(s, null, null, hasConfiguredTransforms()));
store.addObserver(s => {
    ui.setTransformState(
        Boolean(s.state.float), hasConfiguredTransforms(), s.state.liveTransforms,
    );
    ui.setTransformError(null);
    ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
});

function selectionCellCount(): number {
    return store.state.float?.pixels.reduce((count, pixel) => count + Number(pixel !== 0), 0) ?? 0;
}

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
    const inCanvas = !outOfBounds(x, y, W, H);
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
    if (inCanvas && shifted && shifted[y * W + x] === 0) {
        showGestureFeedback("Outside selection · no cells changed");
        return;
    }
    if (tool === "overlay" && g.color === s.primaryColor && !overlayTargetAvailable(pattern, x, y)) {
        showGestureFeedback("Overlay unavailable at this cell");
        return;
    }

    const transforms = s.liveTransforms
        ? transformsToFlat(s.axes, s.repeat)
        : new Float64Array(0);
    const before  = visible;
    let next = paintOps[tool as PaintTool]({
        visible, pattern, x, y,
        color: g.color, primary: s.primaryColor,
        invertVisited: g.invertVisited,
        transforms, shifted,
    });

    if (s.lockInvalid) {
        const unlocked = next;
        next = lockAlwaysInvalid(pattern, before, unlocked);
        if (!arraysEqual(unlocked, next)) {
            showGestureFeedback("Protected cell skipped · unlock in Settings");
        }
    }

    // Split paint result back into canvas + float.
    if (s.float) {
        const f = s.float;
        const newFP = f.pixels.slice();
        for (let ly = 0; ly < f.h; ly++) {
            for (let lx = 0; lx < f.w; lx++) {
                if (f.pixels[ly * f.w + lx] === 0) continue;
                const cx = f.x + lx, cy = f.y + ly;
                if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
                newFP[ly * f.w + lx] = next[cy * W + cx];
            }
        }
        const newFloat = { ...f, pixels: newFP };
        store.commit(state => { state.float = newFloat; }, { persist: false });
    } else {
        const newPixels = next;
        store.commit(state => { state.pixels = newPixels; }, { persist: false });
    }
    updateStatus(store, x, y, hasConfiguredTransforms());
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
    ui.setAxes(store.state.axes);
    ui.setTransformState(
        Boolean(store.state.float), hasConfiguredTransforms(), store.state.liveTransforms,
    );
}

function hasConfiguredTransforms() {
    const r = store.state.repeat;
    return store.state.axes.some(a => a.active)
        || (r.enabled && (r.copiesX > 0 || r.copiesY > 0));
}
// Shortcuts and popover buttons append an active, canonically positioned
// axis. Axis ids keep multiple entries of the same kind independent.
function addAxisOfKind(k: SymKey) {
    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
    store.commit(s => { s.axes = addAxis(s.axes, k, W, H); }, { recompute: false, history: true });
    refreshSymmetryUi();
}

function deleteAxisById(id: string) {
    store.commit(s => { s.axes = removeAxis(s.axes, id); }, { history: true });
    refreshSymmetryUi();
}

function toggleAxisById(id: string) {
    store.commit(s => { s.axes = toggleAxisActive(s.axes, id); }, { history: true });
    refreshSymmetryUi();
}

function onRepeatInput() {
    const repeat = ui.readRepeatGrid();
    const error = repeatGridError(repeat);
    ui.setRepeatError(error);
    if (error) return;
    store.commit(s => { s.repeat = repeat; }, { recompute: false, persist: false });
}

function onRepeatCommit() {
    const error = repeatGridError(ui.readRepeatGrid());
    if (error) return;
    store.commit(() => {}, { recompute: false, render: false, history: true });
}

function onLiveTransformsChange(enabled: boolean) {
    store.commit(s => { s.liveTransforms = enabled; }, { recompute: false, render: false });
}

function onTransformPopoverToggle(open: boolean) {
    rs.previewRepeatGuides = open;
    render(viewport, ctx, rs, store);
}

function onReplicateSelection() {
    const result = replicateSelection(store);
    if (result === "conflict") {
        ui.setTransformError("Stamp failed: different colours claim the same transformed destination.");
    } else if (result === "orbit-limit") {
        ui.setTransformError("Stamp failed: the transformed target set exceeds the safety limit.");
    } else {
        ui.setTransformError(null);
    }
}

// ── Tool / colour / settings handlers ────────────────────────────────────────
// Switching tools keeps any active float alive — paint tools clip to its
// shifted mask, so the selection survives across tool changes.
function setTool(t: Tool) {
    if (navigateLatched) {
        navigateLatched = false;
        ui.setViewState(viewport.view.zoom, store.state.rotation, navigateMomentary);
    }
    ui.setCanvasFeedback(null);
    store.commit(s => { s.activeTool = t; }, { recompute: false, render: false });
    ui.setTool(t);
    if (t !== "move" && selectionMoveMode !== "move") {
        selectionMoveMode = "move";
        ui.setMaskMove(false);
        ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
    }
}
function toggleMaskMove() {
    setSelectionMoveMode(selectionMoveMode === "mask-only" ? "move" : "mask-only");
}
function setSelectionMoveMode(mode: SelectionMoveMode) {
    if (store.state.activeTool !== "move") setTool("move");
    selectionMoveMode = mode;
    ui.setMaskMove(mode === "mask-only");
    ui.setSelectionState(selectionCellCount(), clipboardCellCount(), mode);
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
function onSwapYarns() {
    store.commit(s => {
        [s.colorA, s.colorB] = [s.colorB, s.colorA];
    }, { history: true });
    ui.setColors(store.state.colorA, store.state.colorB);
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
function resetRotation() {
    store.commit(s => { s.rotation = 0; }, { recompute: false });
}
function fitPattern() {
    fitToView(viewport.canvas, viewport.view, store.state.pattern, store.state.rotation);
    render(viewport, ctx, rs, store);
    ui.setViewState(viewport.view.zoom, store.state.rotation, navigateLatched || navigateMomentary);
}
function zoomView(factor: number) {
    const rect = viewport.canvas.getBoundingClientRect();
    zoomAt(viewport.canvas, viewport.view, rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    render(viewport, ctx, rs, store);
    ui.setViewState(viewport.view.zoom, store.state.rotation, navigateLatched || navigateMomentary);
}
function toggleNavigate() {
    navigateLatched = !navigateLatched;
    ui.setViewState(viewport.view.zoom, store.state.rotation, navigateLatched || navigateMomentary);
}

// Paste switches to the Move tool so the user can drag the result.
// `pasteClipboard` itself only touches state; the tool switch is a UI side
// effect that lives here in the orchestrator.
function onPaste() {
    ui.setCanvasFeedback(null);
    if (store.state.activeTool !== "move") setTool("move");
    pasteClipboard(store);
}
function onCopy() {
    copyFloat(store);
    ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
}
function onCut() { cutFloat(store); }
function onDeselect() {
    ui.setCanvasFeedback(null);
    deselect(store);
}

// ── Pattern (Edit) popover ──────────────────────────────────────────────────
let editBaseline: { pattern: PatternState; pixels: Uint8Array; float: Float | null } | null = null;

function onEditOpen() {
    editBaseline = {
        pattern: store.state.pattern,
        pixels: store.state.pixels.slice(),
        float: store.state.float ? { ...store.state.float, pixels: store.state.float.pixels.slice() } : null,
    };
    ui.syncEditInputs(store.state.pattern);
}
function onEditChange() {
    // Re-derive the preview from the transaction baseline each tick so
    // reducing then restoring a value (e.g. rounds 1 → 20) brings the
    // original cells back. If the baseline carried a float, bake it into the
    // source pixels — otherwise the resize would silently drop the
    // float's content along with the geometry-invalid mask.
    const baseline = editBaseline;
    const source: { pattern: PatternState; pixels: Uint8Array } | undefined = baseline
        ? (baseline.float
            ? { pattern: baseline.pattern,
                pixels: visiblePixels({ ...store.state, pattern: baseline.pattern,
                    pixels: baseline.pixels, float: baseline.float }) }
            : { pattern: baseline.pattern, pixels: baseline.pixels })
        : undefined;
    let edited: { pattern: PatternState; pixels: Uint8Array };
    try {
        edited = applyEditSettings(source);
    } catch (error) {
        ui.setEditError(error instanceof Error ? error.message : "Invalid pattern dimensions.");
        return;
    }
    ui.setEditError(null);
    const { pattern, pixels } = edited;
    fitToView(viewport.canvas, viewport.view, pattern, store.state.rotation);
    store.commit(s => {
        s.pattern  = pattern;
        s.pixels   = pixels;
        // Float coords no longer match the new geometry; the content (if any)
        // was baked into the source pixels above before the resize.
        s.float    = null;
    }, { persist: false });
    refreshSymmetryUi();
}
function onEditApply() {
    if (!editBaseline) return;
    editBaseline = null;
    store.commit(() => {}, { recompute: false, render: false, history: true });
}
function onEditCancel() {
    if (!editBaseline) return;
    const baseline = editBaseline;
    editBaseline = null;
    fitToView(viewport.canvas, viewport.view, baseline.pattern, store.state.rotation);
    store.replace({
        ...store.state,
        pattern: baseline.pattern,
        pixels: baseline.pixels,
        float: baseline.float,
    }, { persist: true });
    refreshSymmetryUi();
}

// ── Undo / redo ──────────────────────────────────────────────────────────────
function applyRestored(r: Restored) {
    const dimsChanged = r.pattern.canvasWidth  !== store.state.pattern.canvasWidth
                     || r.pattern.canvasHeight !== store.state.pattern.canvasHeight;
    if (dimsChanged) fitToView(viewport.canvas, viewport.view, r.pattern, store.state.rotation);
    store.replace(
        { ...store.state, pattern: r.pattern, pixels: r.pixels, float: r.float,
          axes: r.axes, repeat: r.repeat, colorA: r.colorA, colorB: r.colorB },
        { persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = r.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = r.colorB;
    ui.setColors(r.colorA, r.colorB);
    ui.setRepeatGrid(r.repeat);
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
    let loaded: LoadedFile | null;
    try {
        loaded = await loadFromFile();
    } catch (error) {
        window.alert(error instanceof Error ? error.message : "Invalid pattern file.");
        return;
    }
    if (!loaded) return;
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
    onMaskMove: toggleMaskMove,
    onSelectionMoveMode: setSelectionMoveMode,
    onSelectionCopy: onCopy,
    onSelectionCut: onCut,
    onSelectionPaste: onPaste,
    onSelectionDeselect: onDeselect,
    onPrimaryColor: setPrimary,
    onSwapYarns,
    onColorChange:  onColorInput,
    onColorCommit,
    onAddAxis:    addAxisOfKind,
    onToggleAxis: toggleAxisById,
    onDeleteAxis: deleteAxisById,
    onRepeatInput,
    onRepeatCommit,
    onLiveTransformsChange,
    onTransformPopoverToggle,
    onReplicateSelection,
    onHighlightChange:         onHlOpacityInput,
    onInvalidIntensityChange:  onInvalidIntensityInput,
    onLabelsVisibleChange:     onLabelsToggle,
    onLockInvalidChange:   onLockInvalidToggle,
    onUndo: undo,
    onRedo: redo,
    onRotate: rotate,
    onResetRotation: resetRotation,
    onFit: fitPattern,
    onZoom: zoomView,
    onNavigate: toggleNavigate,
    onEditOpen, onEditChange, onEditApply, onEditCancel,
    onSave, onLoad, onExport,
});

const clientToPattern = (cx: number, cy: number) => {
    const pattern = store.state.pattern;
    const { x, y } = screenToPattern(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation, pattern, cx, cy,
    );
    const inside = !outOfBounds(x, y, pattern.canvasWidth, pattern.canvasHeight);
    return { x, y, inside };
};

mountGestures(viewport.canvas, viewport.view, clientToPattern, {
    primaryColor: () => store.state.primaryColor,
    onPaintStart: (color, mods) => {
        if (editBaseline) {
            gesture = null;
            return;
        }
        gestureFeedbackShown = false;
        ui.setCanvasFeedback(null);
        const tool = store.state.activeTool;
        if (tool === "move") {
            const mode: MoveMode = mods.alt ? "mask-only" : mods.ctrl ? "duplicate" : selectionMoveMode;
            let prePixels: Uint8Array | null = null;
            const preFloat = store.state.float;
            if (mode === "mask-only" && preFloat) {
                const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
                const clipped = clipFloatToCanvas(preFloat, W, H);
                if (!clipped) {
                    // Float entirely off-canvas — destroy it, don't start a drag.
                    store.commit(s => { s.float = null; }, { history: true });
                    return;
                }
                prePixels = store.state.pixels.slice();
                const stamped = visiblePixels(store.state);
                store.commit(s => { s.pixels = stamped; s.float = clipped; }, { persist: false });
                gesture = { kind: "move", mode, drag: null, prePixels, preFloat: clipped };
                return;
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
                // First paintAt: choose between axis-drag and float-move.
                // Axis-drag wins when the click lands on an active guide
                // line — the float, if any, isn't disturbed. The click must
                // also be in the cell under the cursor, not the float's mask.
                const frac = screenToPatternFrac(
                    viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                    store.state.pattern, cx, cy,
                );
                const hits = pickAxesAt(store.state.axes, frac.x, frac.y, AXIS_HIT_TOLERANCE);
                if (hits.length > 0) {
                    gesture = { kind: "axis-drag",
                                picks: hits.map(a => ({ id: a.id, kind: a.kind })),
                                preAxes: [...store.state.axes] };
                    return;
                }
                // Otherwise the existing float-move path.
                if (!f) {
                    showGestureFeedback("Select cells before using Move");
                    return;
                }
                const lx = p.x - f.x, ly = p.y - f.y;
                const insideFloat = lx >= 0 && lx < f.w && ly >= 0 && ly < f.h && f.pixels[ly * f.w + lx] !== 0;
                if (!insideFloat) {
                    showGestureFeedback("Start Move inside the selection");
                    return;
                }
                gesture.drag = { anchorX: p.x, anchorY: p.y, startDx: f.x, startDy: f.y };
                return;
            }
            if (!f) { gesture.drag = null; return; }
            const rawX = gesture.drag.startDx + (p.x - gesture.drag.anchorX);
            const rawY = gesture.drag.startDy + (p.y - gesture.drag.anchorY);
            const isMaskOnly = gesture.mode === "mask-only" && gesture.preFloat !== null;
            const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
            const newX = isMaskOnly ? Math.max(0, Math.min(W - f.w, rawX)) : rawX;
            const newY = isMaskOnly ? Math.max(0, Math.min(H - f.h, rawY)) : rawY;
            if (newX !== f.x || newY !== f.y) {
                if (isMaskOnly) {
                    // Mirror canvas content at the new position into float.pixels
                    // so visiblePixels stays a no-op and the marquee shows the shape.
                    const pf = gesture.preFloat!;
                    const newFP = new Uint8Array(pf.w * pf.h);
                    for (let ly = 0; ly < pf.h; ly++) {
                        for (let lx = 0; lx < pf.w; lx++) {
                            if (pf.pixels[ly * pf.w + lx] === 0) continue;
                            const cx = newX + lx, cy = newY + ly;
                            if (!outOfBounds(cx, cy, W, H))
                                newFP[ly * pf.w + lx] = store.state.pixels[cy * W + cx];
                        }
                    }
                    store.commit(s => { if (s.float) s.float = { ...s.float, x: newX, y: newY, pixels: newFP }; }, { persist: false });
                } else {
                    store.commit(s => { if (s.float) s.float = { ...s.float, x: newX, y: newY }; }, { persist: false });
                }
            }
            return;
        }
        if (gesture.kind === "axis-drag") {
            const frac = screenToPatternFrac(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            const picks = gesture.picks;
            // Each picked axis tracks the cursor along its own kind's
            // projection — V follows x, H follows y, C follows both, D1/D2
            // follow the line constant. Multi-axis just iterates this.
            store.commit(s => {
                for (const p of picks) {
                    let pos: { x?: number; y?: number; c?: number };
                    switch (p.kind) {
                        case "V":  pos = { x: snapHalf(frac.x - 0.5) }; break;
                        case "H":  pos = { y: snapHalf(frac.y - 0.5) }; break;
                        case "C":  pos = { x: snapHalf(frac.x - 0.5), y: snapHalf(frac.y - 0.5) }; break;
                        case "D1": pos = { c: snapInt(frac.x - frac.y) }; break;
                        case "D2": pos = { c: snapInt(frac.x + frac.y - 1) }; break;
                    }
                    s.axes = setAxisPosition(s.axes, p.id, pos);
                }
            }, { persist: false });
            // Recompute delete-zone membership across all picked axes.
            const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
            const next = new Set<string>();
            for (const p of picks) {
                const a = store.state.axes.find(x => x.id === p.id);
                if (a && axisOffCanvas(a, W, H)) next.add(p.id);
            }
            const changed = next.size !== rs.axesInDeleteZone.size
                || [...next].some(id => !rs.axesInDeleteZone.has(id));
            if (changed) {
                rs.axesInDeleteZone = next;
                render(viewport, ctx, rs, store);
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
            commitWandAt(store, p.x, p.y, gesture.mode, { history: false, persist: false });
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
                // float.pixels mirrors canvas at current position — shiftedFloatMask
                // gives the correct lift shape directly.
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
        if (gesture.kind === "axis-drag") {
            // Each picked axis is independently checked: those in the
            // delete zone get removed, the rest just have their new
            // position committed. One snapshot covers the whole release.
            const g = gesture;
            const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
            const toRemove: string[] = [];
            for (const p of g.picks) {
                const a = store.state.axes.find(x => x.id === p.id);
                if (a && axisOffCanvas(a, W, H)) toRemove.push(p.id);
            }
            const dropped = toRemove.length > 0;
            const moved = !dropped && JSON.stringify(g.preAxes) !== JSON.stringify(store.state.axes);
            if (dropped) {
                store.commit(s => {
                    for (const id of toRemove) s.axes = removeAxis(s.axes, id);
                }, { history: true });
            } else if (moved) {
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            // Always refresh — the popover's per-row position display picks
            // up the new x/y/c from `s.axes`, otherwise it'd show stale values
            // after a position-only drag.
            if (dropped || moved) refreshSymmetryUi();
            rs.axesInDeleteZone = new Set();
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
        gestureFeedbackShown = false;
        ui.setCanvasFeedback(null);
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
        if (gesture.kind === "axis-drag") {
            const { preAxes } = gesture;
            gesture = null;
            rs.axesInDeleteZone = new Set();
            store.commit(s => { s.axes = preAxes; });
            return;
        }
        // gesture.kind === "paint"
        const { prePixels, preFloat } = gesture;
        gesture = null;
        store.commit(s => { s.pixels = prePixels; s.float = preFloat; });
    },
    onHover:      (x, y) => updateStatus(store, x, y, hasConfiguredTransforms()),
    onView:       () => {
        render(viewport, ctx, rs, store);
        ui.setViewState(viewport.view.zoom, store.state.rotation, navigateLatched || navigateMomentary);
    },
    navigate:     () => navigateLatched || navigateMomentary,
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.code === "Space" && (t === document.body || t === viewport.canvas)) {
        e.preventDefault();
        if (!e.repeat) {
            navigateMomentary = true;
            ui.setViewState(viewport.view.zoom, store.state.rotation, true);
        }
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z"))) { e.preventDefault(); redo(); }
        else if (e.key === "a" && !e.shiftKey) { e.preventDefault(); selectAll(store); }
        else if (e.key === "A" ||  (e.shiftKey && e.key === "a")) { e.preventDefault(); deselect(store); }
        else if (e.key === "c" && !e.shiftKey) { e.preventDefault(); onCopy(); }
        else if (e.key === "x" && !e.shiftKey) { e.preventDefault(); cutFloat(store); }
        else if (e.key === "v" && !e.shiftKey) { e.preventDefault(); onPaste(); }
        else if (e.key.startsWith("Arrow") && store.state.float) {
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            const ddx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const ddy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
            store.commit(state => {
                if (!ctrlArrowStamped && state.float) {
                    state.pixels     = visiblePixels(state);
                    ctrlArrowStamped = true;
                }
                if (state.float)
                    state.float = { ...state.float, x: state.float.x + ddx, y: state.float.y + ddy };
            }, { history: !e.repeat });
        }
        return;
    }
    if (e.altKey) {
        if (e.key.startsWith("Arrow") && store.state.float) {
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            const ddx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const ddy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
            store.commit(state => {
                if (!maskArrowState && state.float) {
                    const W = state.pattern.canvasWidth, H = state.pattern.canvasHeight;
                    state.pixels = visiblePixels(state);
                    const clipped = clipFloatToCanvas(state.float, W, H);
                    if (!clipped) { state.float = null; return; }   // entirely off-canvas — destroy
                    state.float = clipped;
                    maskArrowState = { preFloat: clipped };
                }
                if (state.float && maskArrowState) {
                    const pf = maskArrowState.preFloat;
                    const W = state.pattern.canvasWidth, H = state.pattern.canvasHeight;
                    const rawX = state.float.x + ddx, rawY = state.float.y + ddy;
                    const newX = Math.max(0, Math.min(W - pf.w, rawX));
                    const newY = Math.max(0, Math.min(H - pf.h, rawY));
                    const newFP = new Uint8Array(pf.w * pf.h);
                    for (let ly = 0; ly < pf.h; ly++) {
                        for (let lx = 0; lx < pf.w; lx++) {
                            if (pf.pixels[ly * pf.w + lx] === 0) continue;
                            const cx = newX + lx, cy = newY + ly;
                            if (!outOfBounds(cx, cy, W, H))
                                newFP[ly * pf.w + lx] = state.pixels[cy * W + cx];
                        }
                    }
                    state.float = { ...state.float, x: newX, y: newY, pixels: newFP };
                }
            }, { history: !e.repeat });
        }
        return;
    }
    if (e.key === "Escape") {
        if (store.state.float) { e.preventDefault(); anchorFloat(store); }
        return;
    }
    if (e.key === "Delete") {
        if (store.state.float) { e.preventDefault(); deleteFloat(store); }
        return;
    }
    if (e.key.startsWith("Arrow")) {
        if (!store.state.float) return;
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const ddx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const ddy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        store.commit(state => {
            state.float = { ...state.float!, x: state.float!.x + ddx, y: state.float!.y + ddy };
        }, { history: !e.repeat });
        return;
    }
    const k = e.key.toLowerCase();
    if      (k === "p") setTool("pencil");
    else if (k === "f") setTool("fill");
    else if (k === "e") setTool("eraser");
    else if (k === "o") setTool("overlay");
    else if (k === "i") setTool("invert");
    else if (k === "s") setTool("select");
    else if (k === "w") setTool("wand");
    else if (k === "m") setTool("move");
    else if (k === "v") addAxisOfKind("V");
    else if (k === "h") addAxisOfKind("H");
    else if (k === "c") addAxisOfKind("C");
    else if (k === "d") addAxisOfKind("D1");
    else if (k === "a") addAxisOfKind("D2");
    else if (k === "t") { e.preventDefault(); onReplicateSelection(); }
    else if (k === "r") rotate(e.shiftKey ? -45 : 45);
    else if (k === "1") setPrimary(1);
    else if (k === "2") setPrimary(2);
});

document.addEventListener("keyup", e => {
    if (e.code === "Space") {
        navigateMomentary = false;
        ui.setViewState(viewport.view.zoom, store.state.rotation, navigateLatched);
    } else if (e.key === "Alt") {
        if (maskArrowState && store.state.float) {
            const shifted = shiftedFloatMask(store.state);
            const lifted  = liftCells(store.state.pixels, store.state.pattern, shifted);
            store.commit(s => { s.pixels = lifted.pixels; s.float = lifted.float; }, { history: true });
        }
        maskArrowState   = null;
        ctrlArrowStamped = false;
    } else if (e.key === "Control" || e.key === "Meta") {
        ctrlArrowStamped = false;
        maskArrowState   = null;   // safety reset
    }
});

window.addEventListener("blur", () => {
    ctrlArrowStamped = false;
    maskArrowState   = null;
    navigateMomentary = false;
    ui.setViewState(viewport.view.zoom, store.state.rotation, navigateLatched);
});

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
ui.setRepeatGrid(store.state.repeat);
ui.setTransformState(
    Boolean(store.state.float), hasConfiguredTransforms(), store.state.liveTransforms,
);
ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
ui.syncEditInputs(store.state.pattern);
ui.setHistory(canUndo(), canRedo());
ui.setRecoveryStatus(saved ? "recovered" : "saved");

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
ui.setViewState(viewport.view.zoom, store.state.rotation, false);
