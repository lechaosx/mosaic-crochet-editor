import { paint_pixel, flood_fill, export_row_pattern, export_round_pattern } from "@mosaic/wasm";
import { PointerLike, Tool } from "./types";
import { el } from "./dom";
import { canvas } from "./render";
import { state, pixels, highlights, setPixels, applySettings, recomputeHighlights } from "./pattern";
import { historySave, historyReset, historyUndo, historyRedo } from "./history";
import { SYM_IDS, SYM_KEY, directlyActive, updateSymmetryButtons, updateDiagonalButtons, getSymmetryMask } from "./symmetry";
import { pixelSize, COLORS, render, resizeCanvas, updateStatus, setPixelSize } from "./render";
import { saveToLocalStorage, loadFromLocalStorage, restoreUiState } from "./storage";

// ── Helpers ───────────────────────────────────────────────────────────────────

function doRender() {
    if (state && pixels && highlights) render(state, pixels, highlights);
}

function doRecomputeAndRender() {
    recomputeHighlights();
    if (state) updateStatus(highlights, null, null);
    doRender();
}

// ── Drawing state ─────────────────────────────────────────────────────────────

let painting     = false;
let primaryColor = 1;
let strokeColor  = 1;
let activeTool: Tool = "pencil";

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
    setPixels(activeTool === "fill"
        ? flood_fill(pixels, canvasWidth, canvasHeight, x, y, strokeColor, mask)
        : paint_pixel(pixels, canvasWidth, canvasHeight, x, y, strokeColor, mask)
    );
    recomputeHighlights();
    updateStatus(highlights, x, y);
    saveToLocalStorage(pixels!);
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

canvas.addEventListener("mousedown", e => {
    if (e.button !== 0 && e.button !== 2) return;
    strokeColor = e.button === 2 ? (primaryColor === 1 ? 2 : 1) : primaryColor;
    historySave(pixels!);
    painting = true;
    paint(e);
});
canvas.addEventListener("mousemove",   e => { if (painting) paint(e); });
canvas.addEventListener("mouseup",     () => { painting = false; });
canvas.addEventListener("mouseleave",  () => { painting = false; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("touchstart", e => {
    e.preventDefault();
    historySave(pixels!);
    painting = true;
    paint(e.touches[0]);
}, { passive: false });
canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    if (painting) paint(e.touches[0]);
}, { passive: false });
canvas.addEventListener("touchend", () => { painting = false; });

document.querySelector("main")!.addEventListener("wheel", e => {
    e.preventDefault();
    setPixelSize(pixelSize + (e.deltaY < 0 ? 2 : -2));
    if (state) resizeCanvas(state);
    doRender();
}, { passive: false });

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function undo() {
    const p = historyUndo();
    if (p) { setPixels(p); doRecomputeAndRender(); }
}

function redo() {
    const p = historyRedo();
    if (p) { setPixels(p); doRecomputeAndRender(); }
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
}

el("tool-pencil").addEventListener("click", () => setTool("pencil"));
el("tool-fill").addEventListener("click",   () => setTool("fill"));

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
        doRender();
    });
});

// ── New pattern modal ─────────────────────────────────────────────────────────

const newPatternModal = el("new-pattern-modal");

el("new-pattern").addEventListener("click", () => { newPatternModal.hidden = false; });
el("new-pattern-close").addEventListener("click", () => { newPatternModal.hidden = true; });
newPatternModal.addEventListener("click", e => { if (e.target === newPatternModal) newPatternModal.hidden = true; });

el("apply").addEventListener("click", () => {
    applySettings();
    recomputeHighlights();
    if (state) {
        resizeCanvas(state);
        historyReset(pixels!);
        updateDiagonalButtons(state.canvasWidth, state.canvasHeight);
    }
    doRender();
    saveToLocalStorage(pixels!);
    newPatternModal.hidden = true;
});

el("mode").addEventListener("change", e => {
    const mode = (e.target as HTMLSelectElement).value;
    el("row-controls").hidden   = mode !== "row";
    el("round-controls").hidden = mode !== "round";
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

// ── Init ──────────────────────────────────────────────────────────────────────

applyColors();

const saved = loadFromLocalStorage();
if (saved) {
    restoreUiState(saved.uiState);
    applySettings();
    setPixels(saved.pixels);
    recomputeHighlights();
    if (state) {
        resizeCanvas(state);
        historyReset(saved.pixels);
        updateDiagonalButtons(state.canvasWidth, state.canvasHeight);
    }
} else {
    applySettings();
    recomputeHighlights();
    if (state) {
        resizeCanvas(state);
        historyReset(pixels!);
        updateDiagonalButtons(state.canvasWidth, state.canvasHeight);
    }
}
doRender();
