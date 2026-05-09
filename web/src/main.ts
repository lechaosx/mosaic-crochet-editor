import { paint_pixel, flood_fill, erase_pixel_row, erase_pixel_round, export_row_pattern, export_round_pattern } from "@mosaic/wasm";
import { PointerLike, Tool, PatternState } from "./types";
import { el } from "./dom";
import { canvas } from "./render";
import { state, pixels, highlights, setPixels, setState, applySettings, recomputeHighlights } from "./pattern";
import { historySave, historyReset, historyUndo, historyRedo, canUndo, canRedo } from "./history";
import { SYM_IDS, SYM_KEY, directlyActive, setDirectlyActive, updateSymmetryButtons, updateDiagonalButtons, getSymmetryMask } from "./symmetry";
import { pixelSize, COLORS, render, resizeCanvas, updateStatus, setPixelSize } from "./render";
import { saveToLocalStorage, loadFromLocalStorage, syncUiToState, saveToFile, loadFromFile, LocalState } from "./storage";

// ── Dirty tracking ────────────────────────────────────────────────────────────

let baselinePixels: Uint8Array | null = null;

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function isDirty(): boolean {
    return !!pixels && !!baselinePixels && !arraysEqual(pixels, baselinePixels);
}

function setBaseline() {
    baselinePixels = pixels?.slice() ?? null;
}

function confirmIfDirty(): Promise<boolean> {
    if (!isDirty()) return Promise.resolve(true);
    const modal = el("dirty-modal");
    modal.hidden = false;
    return new Promise(resolve => {
        function close(result: boolean) {
            modal.hidden = true;
            el("dirty-discard").removeEventListener("click", onDiscard);
            el("dirty-cancel").removeEventListener("click",  onCancel);
            modal.removeEventListener("click", onBg);
            resolve(result);
        }
        const onDiscard = () => close(true);
        const onCancel  = () => close(false);
        const onBg = (e: Event) => { if (e.target === modal) close(false); };
        el("dirty-discard").addEventListener("click", onDiscard, { once: true });
        el("dirty-cancel").addEventListener("click",  onCancel,  { once: true });
        modal.addEventListener("click", onBg);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function doRender() {
    if (state && pixels && highlights) render(state, pixels, highlights);
}

function saveSession() {
    if (!state || !pixels) return;
    saveToLocalStorage(
        state, pixels, colorInputA.value, colorInputB.value,
        activeTool, primaryColor, [...directlyActive],
        hlOverlayColorInput.value, hlInvalidColorInput.value, parseInt(hlOpacityInput.value),
    );
}

function doHistorySave() {
    historySave(pixels!);
    updateHistoryButtons();
}

function doRecomputeAndRender() {
    recomputeHighlights();
    if (state) updateStatus(highlights, null, null);
    doRender();
}

// ── Drawing state ─────────────────────────────────────────────────────────────

let painting          = false;
let primaryColor      = 1;
let strokeColor       = 1;
let activeTool: Tool  = "pencil";
let preStrokePixels: Uint8Array | null = null;

function strokeChanged(): boolean {
    return !!preStrokePixels && !!pixels && !arraysEqual(preStrokePixels, pixels);
}

// ── Paint ─────────────────────────────────────────────────────────────────────

function paint(pointer: PointerLike) {
    if (!state || !pixels) return;
    const rect = canvas.getBoundingClientRect();
    const x    = Math.floor((pointer.clientX - rect.left) / pixelSize);
    const y    = Math.floor((pointer.clientY - rect.top)  / pixelSize);
    const { canvasWidth, canvasHeight } = state;

    if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) return;
    if (pixels[y * canvasWidth + x] === 0) return;

    const mask = getSymmetryMask(canvasWidth, canvasHeight);
    if (activeTool === "fill") {
        setPixels(flood_fill(pixels, canvasWidth, canvasHeight, x, y, strokeColor, mask));
    } else if (activeTool === "eraser") {
        if (state.mode === "row") {
            setPixels(erase_pixel_row(pixels, canvasWidth, canvasHeight, x, y, mask));
        } else {
            const { virtualWidth, virtualHeight, offsetX, offsetY, rounds } = state;
            setPixels(erase_pixel_round(pixels, canvasWidth, canvasHeight, x, y,
                virtualWidth, virtualHeight, offsetX, offsetY, rounds, mask));
        }
    } else {
        setPixels(paint_pixel(pixels, canvasWidth, canvasHeight, x, y, strokeColor, mask));
    }
    recomputeHighlights();
    updateStatus(highlights, x, y);
    doRender();
}

// ── Canvas events ─────────────────────────────────────────────────────────────

canvas.addEventListener("mousemove", e => {
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    updateStatus(highlights,
        Math.floor((e.clientX - rect.left) / pixelSize),
        Math.floor((e.clientY - rect.top)  / pixelSize),
    );
});
canvas.addEventListener("mouseleave", () => updateStatus(highlights, null, null));

function startStroke() {
    preStrokePixels = pixels?.slice() ?? null;
    painting = true;
}

function endStroke() {
    if (!painting) return;
    if (strokeChanged()) { doHistorySave(); saveSession(); }
    preStrokePixels = null;
    painting = false;
}

canvas.addEventListener("mousedown", e => {
    if (e.button !== 0 && e.button !== 2) return;
    strokeColor = e.button === 2 ? (primaryColor === 1 ? 2 : 1) : primaryColor;
    startStroke();
    paint(e);
});
canvas.addEventListener("mousemove",   e => { if (painting) paint(e); });
canvas.addEventListener("mouseup",     () => endStroke());
canvas.addEventListener("mouseleave",  () => endStroke());
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("touchstart", e => {
    e.preventDefault();
    startStroke();
    paint(e.touches[0]);
}, { passive: false });
canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    if (painting) paint(e.touches[0]);
}, { passive: false });
canvas.addEventListener("touchend", () => endStroke());

document.querySelector("main")!.addEventListener("wheel", e => {
    e.preventDefault();
    setPixelSize(pixelSize + (e.deltaY < 0 ? 2 : -2));
    if (state) resizeCanvas(state);
    doRender();
}, { passive: false });

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function updateHistoryButtons() {
    el<HTMLButtonElement>("btn-undo").disabled = !canUndo();
    el<HTMLButtonElement>("btn-redo").disabled = !canRedo();
}

function undo() {
    const p = historyUndo();
    if (p) { setPixels(p); doRecomputeAndRender(); updateHistoryButtons(); }
}

function redo() {
    const p = historyRedo();
    if (p) { setPixels(p); doRecomputeAndRender(); updateHistoryButtons(); }
}

el("btn-undo").addEventListener("click", undo);
el("btn-redo").addEventListener("click", redo);

document.addEventListener("keydown", e => {
    if (!e.ctrlKey) return;
    if (e.key === "z") { e.preventDefault(); undo(); }
    if (e.key === "y" || (e.shiftKey && e.key === "Z")) { e.preventDefault(); redo(); }
});

document.addEventListener("keydown", e => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "p" || e.key === "P") setTool("pencil");
    if (e.key === "f" || e.key === "F") setTool("fill");
});

// ── Tool selector ─────────────────────────────────────────────────────────────

function setTool(tool: Tool) {
    activeTool = tool;
    el("tool-pencil").classList.toggle("active", tool === "pencil");
    el("tool-fill").classList.toggle("active",   tool === "fill");
    el("tool-eraser").classList.toggle("active", tool === "eraser");
    saveSession();
}

el("tool-pencil").addEventListener("click", () => setTool("pencil"));
el("tool-fill").addEventListener("click",   () => setTool("fill"));
el("tool-eraser").addEventListener("click", () => setTool("eraser"));

document.addEventListener("keydown", e => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "e" || e.key === "E") setTool("eraser");
});

// ── Highlight colors ──────────────────────────────────────────────────────────

const hlOverlayColorInput = el<HTMLInputElement>("hl-overlay-color");
const hlInvalidColorInput = el<HTMLInputElement>("hl-invalid-color");
const hlOpacityInput      = el<HTMLInputElement>("hl-opacity");
const swatchHlOverlay     = el("swatch-hl-overlay");
const swatchHlInvalid     = el("swatch-hl-invalid");

function hexToRgba(hex: string, opacityPercent: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${(opacityPercent / 100).toFixed(2)})`;
}

function applyHighlightColors() {
    const opacity = parseInt(hlOpacityInput.value);
    COLORS[3] = hexToRgba(hlOverlayColorInput.value, opacity);
    COLORS[4] = hexToRgba(hlInvalidColorInput.value, opacity);
    swatchHlOverlay.style.background = hlOverlayColorInput.value;
    swatchHlInvalid.style.background = hlInvalidColorInput.value;
    doRender();
    saveSession();
}

function setupHighlightSwatch(swatchEl: HTMLElement, colorInput: HTMLInputElement) {
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    swatchEl.addEventListener("dblclick",  () => colorInput.click());
    swatchEl.addEventListener("mousedown", () => { longPressTimer = setTimeout(() => colorInput.click(), 600); });
    swatchEl.addEventListener("mouseup",    () => { if (longPressTimer) clearTimeout(longPressTimer); });
    swatchEl.addEventListener("mouseleave", () => { if (longPressTimer) clearTimeout(longPressTimer); });
    colorInput.addEventListener("input", applyHighlightColors);
}

setupHighlightSwatch(swatchHlOverlay, hlOverlayColorInput);
setupHighlightSwatch(swatchHlInvalid, hlInvalidColorInput);
hlOpacityInput.addEventListener("input", applyHighlightColors);

// ── Color swatches ────────────────────────────────────────────────────────────

const colorInputA = el<HTMLInputElement>("color-a");
const colorInputB = el<HTMLInputElement>("color-b");
const swatchA     = el("swatch-a");
const swatchB     = el("swatch-b");

function applyColors() {
    COLORS[1] = colorInputA.value;
    COLORS[2] = colorInputB.value;
    swatchA.style.background = colorInputA.value;
    swatchB.style.background = colorInputB.value;
    doRender();
}

function selectColor(color: number) {
    primaryColor = color;
    swatchA.classList.toggle("active-swatch", color === 1);
    swatchB.classList.toggle("active-swatch", color === 2);
    saveSession();
}

function setupSwatch(swatchEl: HTMLElement, colorInput: HTMLInputElement, color: number) {
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    swatchEl.addEventListener("click",     () => selectColor(color));
    swatchEl.addEventListener("dblclick",  () => colorInput.click());
    swatchEl.addEventListener("mousedown", () => { longPressTimer = setTimeout(() => colorInput.click(), 600); });
    swatchEl.addEventListener("mouseup",    () => { if (longPressTimer) clearTimeout(longPressTimer); });
    swatchEl.addEventListener("mouseleave", () => { if (longPressTimer) clearTimeout(longPressTimer); });
    colorInput.addEventListener("input", applyColors);
}

setupSwatch(swatchA, colorInputA, 1);
setupSwatch(swatchB, colorInputB, 2);

// ── Symmetry buttons ──────────────────────────────────────────────────────────

SYM_IDS.forEach(id => {
    el(id).addEventListener("click", () => {
        const key = SYM_KEY[id];
        if (directlyActive.has(key)) directlyActive.delete(key);
        else                         directlyActive.add(key);
        if (state) updateSymmetryButtons(state.canvasWidth, state.canvasHeight);
        saveSession();
        doRender();
    });
});

// ── New pattern widget ────────────────────────────────────────────────────────

const newPatternWidget  = el("new-pattern-widget");
const newPatternWrapper = el("new-pattern-wrapper");
let   widgetOpen     = false;
let   widgetOpenedAt = 0;

function applyAndRender() {
    applySettings();
    recomputeHighlights();
    if (state) {
        resizeCanvas(state);
        updateDiagonalButtons(state.canvasWidth, state.canvasHeight);
    }
    setBaseline();
    historyReset(pixels!); updateHistoryButtons();
    saveSession();
    doRender();
}

function openWidget() {
    if (widgetOpen) return;
    widgetOpen     = true;
    widgetOpenedAt = Date.now();
    newPatternWidget.hidden = false;
    applyAndRender();
}

function closeWidget() {
    if (!widgetOpen) return;
    widgetOpen = false;
    newPatternWidget.hidden = true;
}

el("new-pattern").addEventListener("click", async e => {
    e.stopPropagation();
    if (widgetOpen) { closeWidget(); return; }
    if (!await confirmIfDirty()) return;
    openWidget();
});

newPatternWidget.addEventListener("click", e => e.stopPropagation());

document.addEventListener("click", () => {
    if (widgetOpen && Date.now() - widgetOpenedAt > 300) closeWidget();
});

el("mode").addEventListener("change", e => {
    const mode = (e.target as HTMLSelectElement).value;
    el("row-controls").hidden   = mode !== "row";
    el("round-controls").hidden = mode !== "round";
    if (widgetOpen) applyAndRender();
});

["width", "height", "inner-width", "inner-height", "rounds", "sub-mode"].forEach(id => {
    el(id).addEventListener("input",  () => { if (widgetOpen) applyAndRender(); });
    el(id).addEventListener("change", () => { if (widgetOpen) applyAndRender(); });
});

// ── Export modal ──────────────────────────────────────────────────────────────

const exportModal    = el("export-modal");
const exportTextarea = el<HTMLTextAreaElement>("export-text");
const alternateCheck = el<HTMLInputElement>("alternate");

function generateExportText(): string {
    if (!state || !highlights) return "";
    const alternate = alternateCheck.checked;
    const { canvasWidth, canvasHeight } = state;
    if (state.mode === "row") {
        return export_row_pattern(highlights, canvasWidth, canvasHeight, alternate);
    } else {
        const { virtualWidth, virtualHeight, offsetX, offsetY, rounds } = state;
        return export_round_pattern(
            highlights, canvasWidth, canvasHeight,
            virtualWidth, virtualHeight, offsetX, offsetY, rounds, alternate
        );
    }
}

el("export").addEventListener("click", () => {
    exportTextarea.value = generateExportText();
    el("export-warning").hidden = !highlights?.some(h => h === 4);
    exportModal.hidden = false;
});

alternateCheck.addEventListener("change", () => {
    if (!exportModal.hidden) exportTextarea.value = generateExportText();
});

el("modal-close").addEventListener("click", () => { exportModal.hidden = true; });
exportModal.addEventListener("click", e => { if (e.target === exportModal) exportModal.hidden = true; });

el("modal-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(exportTextarea.value);
});

el("modal-download").addEventListener("click", () => {
    const blob = new Blob([exportTextarea.value], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: "pattern.txt" }).click();
    URL.revokeObjectURL(url);
});

// ── Save / Load ───────────────────────────────────────────────────────────────

el("btn-save").addEventListener("click", () => {
    if (!state || !pixels) return;
    saveToFile(state, pixels, colorInputA.value, colorInputB.value);
});

el("btn-load").addEventListener("click", async () => {
    if (!await confirmIfDirty()) return;
    const loaded = await loadFromFile();
    if (!loaded) return;
    const { state: loadedState, pixels: loadedPixels, colorA, colorB } = loaded;

    setState(loadedState);
    setPixels(loadedPixels);

    colorInputA.value = colorA;
    colorInputB.value = colorB;
    applyColors();

    recomputeHighlights();
    if (state) {
        resizeCanvas(state);
        historyReset(loadedPixels); updateHistoryButtons();
        updateDiagonalButtons(state.canvasWidth, state.canvasHeight);
    }
    doRender();
    saveToLocalStorage(
        loadedState, loadedPixels, colorA, colorB,
        activeTool, primaryColor, [...directlyActive],
        hlOverlayColorInput.value, hlInvalidColorInput.value, parseInt(hlOpacityInput.value),
    );
    setBaseline();
});

// ── Init ──────────────────────────────────────────────────────────────────────

function initWithState(saved: LocalState) {
    setState(saved.state);
    setPixels(saved.pixels);
    colorInputA.value = saved.colorA;
    colorInputB.value = saved.colorB;
    hlOverlayColorInput.value = saved.hlOverlayColor;
    hlInvalidColorInput.value = saved.hlInvalidColor;
    hlOpacityInput.value      = String(saved.hlOpacity);

    applyColors();
    applyHighlightColors();
    syncUiToState(saved.state);
    setDirectlyActive(saved.symmetry as any);
    setTool(saved.activeTool as any);
    selectColor(saved.primaryColor);
    updateSymmetryButtons(saved.state.canvasWidth, saved.state.canvasHeight);
    recomputeHighlights();
    resizeCanvas(saved.state);
    historyReset(saved.pixels); updateHistoryButtons();
    updateDiagonalButtons(saved.state.canvasWidth, saved.state.canvasHeight);
    setBaseline();
    doRender();
}

applyColors();
applyHighlightColors();

const saved = loadFromLocalStorage();
if (saved) {
    initWithState(saved);
} else {
    applySettings();
    recomputeHighlights();
    setTool("pencil");
    selectColor(1);
    if (state) {
        resizeCanvas(state);
        historyReset(pixels!); updateHistoryButtons();
        updateDiagonalButtons(state.canvasWidth, state.canvasHeight);
    }
    setBaseline();
    doRender();
}
