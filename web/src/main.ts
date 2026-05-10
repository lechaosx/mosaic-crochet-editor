import { paint_pixel, flood_fill, erase_pixel_row, erase_pixel_round,
         export_start_row, export_start_round, symmetric_orbit_indices } from "@mosaic/wasm";
import { Tool } from "./types";
import { view, render, fitToView, screenToPattern, updateStatus, COLORS, applyRotation, setRotationImmediate } from "./render";
import { state, pixels, highlights, setPixels, setState, applySettings, recomputeHighlights } from "./pattern";
import { historySave, historyReset, historyUndo, historyRedo, canUndo, canRedo } from "./history";
import { SymKey } from "./types";
import { directlyActive, setDirectlyActive, computeClosure, diagonalsAvailable, getSymmetryMask, ensureDiagonalsValid } from "./symmetry";
import { saveToLocalStorage, loadFromLocalStorage, saveToFile, loadFromFile, LocalState } from "./storage";
import { mountUI, UIHandle } from "./ui";
import { mountGestures } from "./gesture";

/* ─── Drawing & dirty state ────────────────────────────────────────────────── */
let primaryColor: 1 | 2 = 1;
let strokeColor:  1 | 2 = 1;
let activeTool: Tool = "pencil";
let baseline:    Uint8Array | null = null;
let preStroke:   Uint8Array | null = null;
let invertVisited: Set<number> | null = null;
let ui: UIHandle;

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
const isDirty   = () => !!pixels && !!baseline && !arraysEqual(pixels, baseline);
const setBaseline = () => { baseline = pixels?.slice() ?? null; };

/* ─── Render shorthand ─────────────────────────────────────────────────────── */
function reRender()      { if (state && pixels && highlights) render(state, pixels, highlights); }
function reHighlight()   { recomputeHighlights(); if (highlights) updateStatus(highlights, null, null); reRender(); }
function reSymmetry() {
    if (!state) return;
    const { canvasWidth: W, canvasHeight: H } = state;
    ensureDiagonalsValid(W, H);
    const closure = computeClosure(directlyActive, diagonalsAvailable(W, H));
    ui.setSymmetry(directlyActive, closure);
    ui.setDiagonalEnabled(diagonalsAvailable(W, H));
}

/* ─── Persistence ─────────────────────────────────────────────────────────── */
function saveSession() {
    if (!state || !pixels) return;
    saveToLocalStorage(
        state, pixels,
        getColorHex(1), getColorHex(2),
        activeTool, primaryColor, [...directlyActive],
        getHlOverlay(), getHlInvalid(), getHlOpacity(),
        view.rotation,
    );
}

const getColorHex  = (slot: 1 | 2) => (document.getElementById(slot === 1 ? "color-a" : "color-b") as HTMLInputElement).value;
const getHlOverlay = () => (document.getElementById("hl-overlay-color") as HTMLInputElement).value;
const getHlInvalid = () => (document.getElementById("hl-invalid-color") as HTMLInputElement).value;
const getHlOpacity = () => parseInt((document.getElementById("hl-opacity") as HTMLInputElement).value);

/* ─── Paint ────────────────────────────────────────────────────────────────── */
function paintAt(clientX: number, clientY: number) {
    if (!state || !pixels) return;
    const { x, y } = screenToPattern(state, clientX, clientY);
    const { canvasWidth: W, canvasHeight: H } = state;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    if (pixels[y * W + x] === 0) return;

    const mask = getSymmetryMask(W, H);
    if (activeTool === "fill") {
        setPixels(flood_fill(pixels, W, H, x, y, strokeColor, mask));
    } else if (activeTool === "eraser") {
        if (state.mode === "row") {
            setPixels(erase_pixel_row(pixels, W, H, x, y, mask));
        } else {
            const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = state;
            setPixels(erase_pixel_round(pixels, W, H, x, y, vw, vh, ox, oy, rounds, mask));
        }
    } else if (activeTool === "invert") {
        const next = pixels.slice();
        const indices = symmetric_orbit_indices(W, H, x, y, mask);
        for (const idx of indices) {
            if (invertVisited!.has(idx)) continue;
            invertVisited!.add(idx);
            const cur = next[idx];
            if      (cur === 1) next[idx] = 2;
            else if (cur === 2) next[idx] = 1;
        }
        setPixels(next);
    } else {
        setPixels(paint_pixel(pixels, W, H, x, y, strokeColor, mask));
    }
    recomputeHighlights();
    updateStatus(highlights, x, y);
    reRender();
}

/* ─── UI callbacks → state mutations ──────────────────────────────────────── */
function setTool(t: Tool) { activeTool = t; ui.setTool(t); saveSession(); }
function setPrimary(slot: 1 | 2) { primaryColor = slot; ui.setPrimary(slot); saveSession(); }
function applyColorsFromInputs() {
    COLORS[1] = getColorHex(1);
    COLORS[2] = getColorHex(2);
    ui.setColors(getColorHex(1), getColorHex(2));
    reRender();
    saveSession();
}
function applyHighlightsFromInputs() {
    const opacity = getHlOpacity();
    COLORS[3] = hexRgba(getHlOverlay(), opacity);
    COLORS[4] = hexRgba(getHlInvalid(), opacity);
    ui.setHighlights(getHlOverlay(), getHlInvalid(), opacity);
    reRender();
    saveSession();
}
function hexRgba(hex: string, opacityPct: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${(opacityPct / 100).toFixed(2)})`;
}

function toggleSym(k: SymKey) {
    if (directlyActive.has(k)) directlyActive.delete(k);
    else directlyActive.add(k);
    reSymmetry();
    saveSession();
    reRender();
}

/* ─── New pattern ────────────────────────────────────────────────────────── */
function recreateFromInputs() {
    applySettings();
    recomputeHighlights();
    if (state) {
        view.panX = 0; view.panY = 0;
        fitToView(state);
        reSymmetry();
    }
    setBaseline();
    historyReset(pixels!); ui.setHistory(canUndo(), canRedo());
    saveSession();
    reRender();
}

async function onNewClick(): Promise<boolean> { return !isDirty() || ui.confirmDirty(); }

/* ─── Undo / redo ────────────────────────────────────────────────────────── */
function undo() {
    const p = historyUndo(); if (!p) return;
    setPixels(p); reHighlight(); ui.setHistory(canUndo(), canRedo()); saveSession();
}
function redo() {
    const p = historyRedo(); if (!p) return;
    setPixels(p); reHighlight(); ui.setHistory(canUndo(), canRedo()); saveSession();
}

/* ─── Save / load ────────────────────────────────────────────────────────── */
async function onSave() {
    if (!state || !pixels) return;
    await saveToFile(state, pixels, getColorHex(1), getColorHex(2));
}
async function onLoad() {
    if (isDirty() && !await ui.confirmDirty()) return;
    const loaded = await loadFromFile(); if (!loaded) return;
    setState(loaded.state);
    setPixels(loaded.pixels);
    (document.getElementById("color-a") as HTMLInputElement).value = loaded.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = loaded.colorB;
    applyColorsFromInputs();
    ui.syncNewInputs(loaded.state);
    recomputeHighlights();
    if (state) {
        fitToView(state);
        view.panX = 0; view.panY = 0;
        reSymmetry();
    }
    historyReset(loaded.pixels); ui.setHistory(canUndo(), canRedo());
    setBaseline();
    saveSession();
    reRender();
}

/* ─── Export ─────────────────────────────────────────────────────────────── */
async function onExport() {
    if (!state || !highlights) return;
    const dlg = ui.openExport();
    let cancelled = false;
    dlg.onClose(() => { cancelled = true; });
    dlg.setWarning(highlights.some(h => h === 4));

    const startSession = (alt: boolean) => {
        if (!state || !highlights) return null;
        const { canvasWidth: W, canvasHeight: H } = state;
        if (state.mode === "row") return export_start_row(highlights, W, H, alt);
        const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = state;
        return export_start_round(highlights, W, H, vw, vh, ox, oy, rounds, alt);
    };

    let runId = 0;
    const run = async () => {
        const myRun = ++runId;
        dlg.setBusy(true);
        dlg.clearText();
        const session = startSession(dlg.alternate());
        if (!session) { dlg.endProgress(); return; }
        const total = session.total();
        let count = 0;
        let line: string | undefined;
        while ((line = session.next()) !== undefined) {
            if (cancelled || myRun !== runId) { session.free(); dlg.endProgress(); return; }
            dlg.appendLine(line);
            dlg.setProgress(++count, total);
            await new Promise<void>(r => requestAnimationFrame(() => r()));
        }
        session.free();
        dlg.endProgress();
        dlg.setBusy(false);
    };

    dlg.onAlternate(run);
    run();
}

/* ─── Keyboard shortcuts ────────────────────────────────────────────────── */
document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z"))) { e.preventDefault(); redo(); }
        return;
    }
    const k = e.key.toLowerCase();
    if (k === "p") setTool("pencil");
    else if (k === "f") setTool("fill");
    else if (k === "e") setTool("eraser");
    else if (k === "i") setTool("invert");
});

/* ─── Init ──────────────────────────────────────────────────────────────── */
function init() {
    ui = mountUI({
        onTool: setTool,
        onPrimaryColor: setPrimary,
        onColorChange: applyColorsFromInputs,
        onSym: toggleSym,
        onHighlightChange: applyHighlightsFromInputs,
        onUndo: undo,
        onRedo: redo,
        onRotate: (delta) => { view.rotation += delta; applyRotation(); saveSession(); },
        onNewClick,
        onNewApply: recreateFromInputs,
        onSave,
        onLoad,
        onExport,
    });

    mountGestures({
        getState:     () => state,
        primaryColor: () => primaryColor,
        onPaintStart: (color) => {
            strokeColor   = color;
            preStroke     = pixels?.slice() ?? null;
            invertVisited = activeTool === "invert" ? new Set<number>() : null;
        },
        onPaintAt:    paintAt,
        onPaintEnd:   () => {
            if (preStroke && pixels && !arraysEqual(preStroke, pixels)) {
                historySave(pixels);
                ui.setHistory(canUndo(), canRedo());
                saveSession();
            }
            preStroke = null;
            invertVisited = null;
        },
        onPaintCancel: () => {
            // Two-finger gesture started — revert the partial stroke.
            if (preStroke) {
                setPixels(preStroke);
                recomputeHighlights();
                updateStatus(highlights, null, null);
                reRender();
            }
            preStroke = null;
            invertVisited = null;
        },
        onHover: (x, y) => updateStatus(highlights, x, y),
        onView:  reRender,
        onViewSettle: saveSession,
    });

    const saved = loadFromLocalStorage();
    if (saved) restoreSession(saved); else freshSession();
}

function restoreSession(saved: LocalState) {
    setState(saved.state);
    setPixels(saved.pixels);
    (document.getElementById("color-a") as HTMLInputElement).value = saved.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = saved.colorB;
    (document.getElementById("hl-overlay-color") as HTMLInputElement).value = saved.hlOverlayColor;
    (document.getElementById("hl-invalid-color") as HTMLInputElement).value = saved.hlInvalidColor;
    (document.getElementById("hl-opacity") as HTMLInputElement).value = String(saved.hlOpacity);
    setRotationImmediate(saved.canvasRotation);
    applyColorsFromInputs();
    applyHighlightsFromInputs();
    ui.syncNewInputs(saved.state);
    setDirectlyActive(saved.symmetry as SymKey[]);
    setTool(saved.activeTool as Tool);
    setPrimary(saved.primaryColor as 1 | 2);
    if (state) { fitToView(state); reSymmetry(); }
    recomputeHighlights();
    historyReset(saved.pixels); ui.setHistory(canUndo(), canRedo());
    setBaseline();
    updateStatus(highlights, null, null);
    reRender();
}

function freshSession() {
    applySettings();
    recomputeHighlights();
    setTool("pencil");
    setPrimary(1);
    if (state) { fitToView(state); reSymmetry(); }
    historyReset(pixels!); ui.setHistory(canUndo(), canRedo());
    applyColorsFromInputs();
    applyHighlightsFromInputs();
    setBaseline();
    updateStatus(highlights, null, null);
    reRender();
}

init();
