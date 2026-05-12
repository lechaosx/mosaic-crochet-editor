import { paint_pixel, flood_fill, PlanType,
         paint_natural_row, paint_natural_round,
         paint_overlay_row, paint_overlay_round,
         clear_overlay_row, clear_overlay_round,
         lock_invalid_row, lock_invalid_round,
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
        symmetry:      new Set<SymKey>(),
        hlOpacity:     100,
        labelsVisible: true,
        lockInvalid:   false,
        rotation:      0,
    };
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

    // The overlay tool is the only one that handles clicks in the gutter
    // (just outside the canvas, where boundary ! markers render).
    // Everything else wants an in-canvas, non-hole pixel.
    if (!inCanvas && store.state.activeTool !== "overlay") return;
    if (inCanvas && pixels[y * W + x] === 0) return;

    const mask   = getSymmetryMask(store.state.symmetry, W, H);
    const before = pixels;
    let next: Uint8Array;
    const tool = store.state.activeTool;
    if (tool === "fill") {
        next = flood_fill(pixels, W, H, x, y, strokeColor, mask);
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
    store.commit(s => {
        s.pattern  = pattern;
        s.pixels   = pixels;
        s.symmetry = pruneUnavailableDiagonals(s.symmetry, pattern.canvasWidth, pattern.canvasHeight);
    });
    fitToView(viewport.canvas, viewport.view, pattern, store.state.rotation);
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
    store.replace(
        { ...store.state, pattern: r.pattern, pixels: r.pixels, colorA: r.colorA, colorB: r.colorB },
        { persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = r.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = r.colorB;
    ui.setColors(r.colorA, r.colorB);
    ui.syncEditInputs(r.pattern);
    fitToView(viewport.canvas, viewport.view, r.pattern, store.state.rotation);
    refreshSymmetryUi();
}
function undo() { const r = historyUndo(); if (r) applyRestored(r); }
function redo() { const r = historyRedo(); if (r) applyRestored(r); }

/* ── Save / load ─────────────────────────────────────────────────────────── */
async function onSave() { await saveToFile(store.state); }
async function onLoad() {
    const loaded = await loadFromFile(); if (!loaded) return;
    store.replace(
        { ...store.state, pattern: loaded.pattern, pixels: loaded.pixels,
          colorA: loaded.colorA, colorB: loaded.colorB },
        { history: true, persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = loaded.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = loaded.colorB;
    ui.setColors(loaded.colorA, loaded.colorB);
    ui.syncEditInputs(loaded.pattern);
    fitToView(viewport.canvas, viewport.view, loaded.pattern, store.state.rotation);
    viewport.view.panX = 0; viewport.view.panY = 0;
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
    onHighlightChange:     onHlOpacityInput,
    onLabelsVisibleChange: onLabelsToggle,
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
    onPaintStart: (color) => {
        strokeColor   = color;
        preStroke     = store.state.pixels.slice();
        invertVisited = store.state.activeTool === "invert" ? new Set<number>() : null;
    },
    onPaintAt:    paintAt,
    onPaintEnd:   () => {
        if (preStroke && !arraysEqual(preStroke, store.state.pixels)) {
            store.commit(() => {}, { recompute: false, render: false, history: true });
        }
        preStroke = null;
        invertVisited = null;
    },
    onPaintCancel: () => {
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
document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z"))) { e.preventDefault(); redo(); }
        return;
    }
    const k = e.key.toLowerCase();
    if      (k === "p") setTool("pencil");
    else if (k === "f") setTool("fill");
    else if (k === "e") setTool("eraser");
    else if (k === "o") setTool("overlay");
    else if (k === "i") setTool("invert");
    else if (k === "v") toggleSym("V");
    else if (k === "h") toggleSym("H");
    else if (k === "c") toggleSym("C");
    else if (k === "d") toggleSym("D1");
    else if (k === "a") toggleSym("D2");
    else if (k === "r") rotate(e.shiftKey ? -45 : 45);
    else if (k === "1") setPrimary(1);
    else if (k === "2") setPrimary(2);
});

/* ── Initial DOM-input sync + first render ───────────────────────────────── */
function syncDomInputs(s: Readonly<SessionState>) {
    (document.getElementById("color-a") as HTMLInputElement).value = s.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = s.colorB;
    (document.getElementById("hl-opacity")   as HTMLInputElement).value   = String(s.hlOpacity);
    (document.getElementById("labels-on")    as HTMLInputElement).checked = s.labelsVisible;
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
    store.commit(s => { s.pattern = pattern; s.pixels = pixels; });
    fitToView(viewport.canvas, viewport.view, pattern, store.state.rotation);
    refreshSymmetryUi();
    historyReset(store.state);
    ui.setHistory(canUndo(), canRedo());
}
