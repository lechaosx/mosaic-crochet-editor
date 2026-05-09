import {
    initialize_row_pattern,
    initialize_round_pattern,
    compute_row_highlights,
    compute_round_highlights,
    export_row_pattern,
    export_round_pattern,
} from "@mosaic/wasm";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool    = "pencil" | "fill";
type SymKey  = "V" | "H" | "C" | "D1" | "D2";
type Point   = [number, number];

interface RowState {
    mode:        "row";
    canvasWidth: number;
    canvasHeight: number;
}

interface RoundState {
    mode:          "round";
    canvasWidth:   number;
    canvasHeight:  number;
    virtualWidth:  number;
    virtualHeight: number;
    offsetX:       number;
    offsetY:       number;
    rounds:        number;
}

type PatternState = RowState | RoundState;

interface PointerLike { clientX: number; clientY: number; }

// ── DOM helpers ───────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function inputValue(id: string): string { return el<HTMLInputElement>(id).value; }
function inputInt(id: string):   number { return parseInt(inputValue(id)); }

// ── Canvas ────────────────────────────────────────────────────────────────────

const canvas = el<HTMLCanvasElement>("canvas");
const ctx    = canvas.getContext("2d")!;

// ── State ─────────────────────────────────────────────────────────────────────

let state:      PatternState | null = null;
let pixels:     Uint8Array | null   = null;
let highlights: Uint8Array | null   = null;
let pixelSize   = 16;
let painting    = false;
let paintColor  = 1;
let activeTool: Tool = "pencil";

const COLORS: (string | null)[] = [
    null,                    // 0 transparent
    "#000000",               // 1 color A
    "#ffffff",               // 2 color B
    "rgba(0, 0, 255, 0.5)", // 3 valid overlay
    "rgba(255, 0, 0, 0.5)", // 4 invalid placement
];

const history:      Uint8Array[] = [];
let   historyIndex               = -1;

// ── Settings ──────────────────────────────────────────────────────────────────

function computeRoundDimensions(innerWidth: number, innerHeight: number, rounds: number, subMode: string) {
    const virtualWidth  = innerWidth  + rounds * 2;
    const virtualHeight = innerHeight + rounds * 2;
    if (subMode === "full") {
        return { canvasWidth: virtualWidth, canvasHeight: virtualHeight, offsetX: 0, offsetY: 0 };
    } else if (subMode === "half") {
        return { canvasWidth: virtualWidth, canvasHeight: innerHeight + rounds, offsetX: 0, offsetY: rounds };
    } else {
        return { canvasWidth: innerWidth + rounds, canvasHeight: innerHeight + rounds, offsetX: 0, offsetY: rounds };
    }
}

function recomputeHighlights() {
    if (!state || !pixels) return;
    const { canvasWidth, canvasHeight } = state;
    if (state.mode === "row") {
        highlights = compute_row_highlights(pixels, canvasWidth, canvasHeight).slice();
    } else {
        const { virtualWidth, virtualHeight, offsetX, offsetY, rounds } = state;
        highlights = compute_round_highlights(
            pixels, canvasWidth, canvasHeight,
            virtualWidth, virtualHeight, offsetX, offsetY, rounds
        ).slice();
    }
    updateStatus(null, null);
}

function applySettings() {
    const mode = inputValue("mode");

    if (mode === "row") {
        const width  = inputInt("width");
        const height = inputInt("height");
        state  = { mode, canvasWidth: width, canvasHeight: height };
        pixels = initialize_row_pattern(width, height).slice();
    } else {
        const innerWidth  = inputInt("inner-width");
        const innerHeight = inputInt("inner-height");
        const rounds      = inputInt("rounds");
        const subMode     = inputValue("sub-mode");
        const virtualWidth  = innerWidth  + rounds * 2;
        const virtualHeight = innerHeight + rounds * 2;
        const dims = computeRoundDimensions(innerWidth, innerHeight, rounds, subMode);
        state  = { mode: "round", ...dims, virtualWidth, virtualHeight, rounds };
        pixels = initialize_round_pattern(
            dims.canvasWidth, dims.canvasHeight,
            virtualWidth, virtualHeight,
            dims.offsetX, dims.offsetY, rounds
        ).slice();
    }

    recomputeHighlights();
    resizeCanvas();
    historyReset();
    updateDiagonalButtons();
    render();
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────

function resizeCanvas() {
    if (!state) return;
    canvas.width  = state.canvasWidth  * pixelSize;
    canvas.height = state.canvasHeight * pixelSize;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
    if (!state || !pixels || !highlights) return;
    const { canvasWidth, canvasHeight } = state;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < canvasHeight; y++) {
        for (let x = 0; x < canvasWidth; x++) {
            const pixel     = pixels[y * canvasWidth + x];
            const highlight = highlights[y * canvasWidth + x];

            if (pixel === 0) continue;

            ctx.fillStyle = COLORS[pixel] ?? "#333";
            ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);

            if (highlight !== 0) {
                ctx.fillStyle = COLORS[highlight] ?? "";
                ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
            }
        }
    }

    ctx.strokeStyle = "rgba(128, 128, 128, 0.15)";
    ctx.lineWidth   = 0.5;
    for (let x = 0; x <= canvasWidth; x++) {
        ctx.beginPath(); ctx.moveTo(x * pixelSize, 0); ctx.lineTo(x * pixelSize, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvasHeight; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * pixelSize); ctx.lineTo(canvas.width, y * pixelSize); ctx.stroke();
    }

    renderSymmetryGuides();
}

function renderSymmetryGuides() {
    if (!state || directlyActive.size === 0) return;
    const { canvasWidth: W, canvasHeight: H } = state;
    const closure = computeClosure(directlyActive, diagonalsAvailable());
    if (closure.size === 0) return;

    const cw  = W * pixelSize, ch = H * pixelSize;
    const cx  = cw / 2,        cy = ch / 2;
    const ext = Math.max(cw, ch);

    const drawLine = (x1: number, y1: number, x2: number, y2: number, direct: boolean) => {
        ctx.strokeStyle = direct ? "rgba(255, 80, 180, 0.8)" : "rgba(255, 80, 180, 0.35)";
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const d = (k: SymKey) => directlyActive.has(k);

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    if (closure.has("V"))  drawLine(cx,       0,        cx,       ch,       d("V"));
    if (closure.has("H"))  drawLine(0,        cy,       cw,       cy,       d("H"));
    if (closure.has("D1")) drawLine(cx - ext, cy - ext, cx + ext, cy + ext, d("D1"));
    if (closure.has("D2")) drawLine(cx + ext, cy - ext, cx - ext, cy + ext, d("D2"));

    if (closure.has("C")) {
        ctx.setLineDash([]);
        ctx.fillStyle = d("C") ? "rgba(255, 80, 180, 0.9)" : "rgba(255, 80, 180, 0.4)";
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

// ── Save / Load ───────────────────────────────────────────────────────────────

const SAVE_KEY = "mosaic-pattern-v1";

function saveToLocalStorage() {
    if (!pixels) return;
    const uiState = {
        mode:        inputValue("mode"),
        width:       inputValue("width"),
        height:      inputValue("height"),
        innerWidth:  inputValue("inner-width"),
        innerHeight: inputValue("inner-height"),
        rounds:      inputValue("rounds"),
        subMode:     inputValue("sub-mode"),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ uiState, pixels: Array.from(pixels) }));
}

function loadFromLocalStorage(): boolean {
    const saved = localStorage.getItem(SAVE_KEY);
    if (!saved) return false;
    try {
        const { uiState, pixels: savedPixels } = JSON.parse(saved);
        (el<HTMLInputElement>("mode")).value          = uiState.mode;
        (el<HTMLInputElement>("width")).value         = uiState.width;
        (el<HTMLInputElement>("height")).value        = uiState.height;
        (el<HTMLInputElement>("inner-width")).value   = uiState.innerWidth;
        (el<HTMLInputElement>("inner-height")).value  = uiState.innerHeight;
        (el<HTMLInputElement>("rounds")).value        = uiState.rounds;
        (el<HTMLSelectElement>("sub-mode")).value     = uiState.subMode;
        el("row-controls").hidden   = uiState.mode !== "row";
        el("round-controls").hidden = uiState.mode !== "round";
        applySettings();
        pixels = new Uint8Array(savedPixels);
        recomputeHighlights();
        render();
        return true;
    } catch { return false; }
}

// ── Symmetry ──────────────────────────────────────────────────────────────────

const SYM_IDS = ["sym-vertical", "sym-horizontal", "sym-central", "sym-diag1", "sym-diag2"];
const SYM_KEY: Record<string, SymKey> = {
    "sym-vertical": "V", "sym-horizontal": "H", "sym-central": "C",
    "sym-diag1": "D1", "sym-diag2": "D2",
};
let directlyActive = new Set<SymKey>();

function computeClosure(active: Set<SymKey>, diagonals: boolean): Set<SymKey> {
    let V = active.has("V"), H = active.has("H"), C = active.has("C"),
        D1 = active.has("D1"), D2 = active.has("D2");
    let changed = true;
    while (changed) {
        const before = [V, H, C, D1, D2].join();
        if (V && H)   C  = true;
        if (V && C)   H  = true;
        if (H && C)   V  = true;
        if (D1 && D2) C  = true;
        if (D1 && C)  D2 = true;
        if (D2 && C)  D1 = true;
        if (diagonals) {
            if (V && D1) D2 = true;
            if (V && D2) D1 = true;
            if (H && D1) D2 = true;
            if (H && D2) D1 = true;
        }
        changed = [V, H, C, D1, D2].join() !== before;
    }
    return new Set(
        (Object.entries({ V, H, C, D1, D2 }) as [SymKey, boolean][])
            .filter(([, v]) => v)
            .map(([k]) => k)
    );
}

function diagonalsAvailable(): boolean {
    return state !== null && (state.canvasWidth - state.canvasHeight) % 2 === 0;
}

function updateSymmetryButtons() {
    const closure = computeClosure(directlyActive, diagonalsAvailable());
    Object.entries(SYM_KEY).forEach(([id, key]) => {
        const btn = el<HTMLButtonElement>(id);
        btn.classList.toggle("active",  directlyActive.has(key));
        btn.classList.toggle("implied", !directlyActive.has(key) && closure.has(key));
    });
}

SYM_IDS.forEach(id => {
    el(id).addEventListener("click", () => {
        const key = SYM_KEY[id];
        if (directlyActive.has(key)) directlyActive.delete(key);
        else                         directlyActive.add(key);
        updateSymmetryButtons();
        if (state) render();
    });
});

function updateDiagonalButtons() {
    const available = diagonalsAvailable();
    (["sym-diag1", "sym-diag2"] as const).forEach(id => {
        const btn = el<HTMLButtonElement>(id);
        btn.disabled = !available;
        if (!available) directlyActive.delete(SYM_KEY[id]);
    });
    updateSymmetryButtons();
}

function symmetricCoords(x: number, y: number): Point[] {
    if (!state) return [[x, y]];
    const { canvasWidth: W, canvasHeight: H } = state;
    const closure  = computeClosure(directlyActive, diagonalsAvailable());
    const d1Offset = Math.floor((W - H) / 2);
    const d2Sum    = Math.floor((W + H - 2) / 2);

    const enabledTransforms: Array<(p: Point) => Point> = [];
    if (closure.has("V"))  enabledTransforms.push(([px, py]) => [W - 1 - px, py]);
    if (closure.has("H"))  enabledTransforms.push(([px, py]) => [px, H - 1 - py]);
    if (closure.has("C"))  enabledTransforms.push(([px, py]) => [W - 1 - px, H - 1 - py]);
    if (closure.has("D1")) enabledTransforms.push(([px, py]) => [py + d1Offset, px - d1Offset]);
    if (closure.has("D2")) enabledTransforms.push(([px, py]) => [d2Sum - py, d2Sum - px]);

    const visited = new Set([`${x},${y}`]);
    const queue: Point[] = [[x, y]];
    while (queue.length > 0) {
        const coord = queue.shift()!;
        for (const transform of enabledTransforms) {
            const [nx, ny] = transform(coord);
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const key = `${nx},${ny}`;
            if (!visited.has(key)) { visited.add(key); queue.push([nx, ny]); }
        }
    }
    return [...visited].map(k => k.split(",").map(Number) as Point);
}

// ── Fill tool ─────────────────────────────────────────────────────────────────

function floodFill(startX: number, startY: number, fillColor: number) {
    if (!state || !pixels) return;
    const { canvasWidth, canvasHeight } = state;
    const targetColor = pixels[startY * canvasWidth + startX];
    if (targetColor === fillColor || targetColor === 0) return;

    const queue:   Point[] = [[startX, startY]];
    const visited  = new Set<number>();
    const filled:  Point[] = [];

    while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) continue;
        const key = y * canvasWidth + x;
        if (visited.has(key) || pixels[key] !== targetColor) continue;
        visited.add(key);
        filled.push([x, y]);
        queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    for (const [x, y] of filled) {
        for (const [sx, sy] of symmetricCoords(x, y)) {
            if (pixels[sy * canvasWidth + sx] !== 0) {
                pixels[sy * canvasWidth + sx] = fillColor;
            }
        }
    }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function paint(pointer: PointerLike) {
    if (!state || !pixels) return;
    const rect = canvas.getBoundingClientRect();
    const x    = Math.floor((pointer.clientX - rect.left) / pixelSize);
    const y    = Math.floor((pointer.clientY - rect.top)  / pixelSize);
    const { canvasWidth, canvasHeight } = state;

    if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) return;
    if (pixels[y * canvasWidth + x] === 0) return;

    if (activeTool === "fill") {
        floodFill(x, y, paintColor);
    } else {
        for (const [sx, sy] of symmetricCoords(x, y)) {
            if (pixels[sy * canvasWidth + sx] !== 0) {
                pixels[sy * canvasWidth + sx] = paintColor;
            }
        }
    }
    recomputeHighlights();
    saveToLocalStorage();
    render();
}

// ── Status bar ────────────────────────────────────────────────────────────────

const statusEl = el("status");

function updateStatus(x: number | null, y: number | null) {
    if (!highlights) return;
    const validCount   = highlights.filter(h => h === 3).length;
    const invalidCount = highlights.filter(h => h === 4).length;
    const coordText    = x !== null ? `Cursor: ${x}, ${y}<br>` : "";
    statusEl.innerHTML = `${coordText}Overlays: ${validCount}<br>Invalid: ${invalidCount}`;
}

// ── Events ────────────────────────────────────────────────────────────────────

canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    updateStatus(
        Math.floor((e.clientX - rect.left) / pixelSize),
        Math.floor((e.clientY - rect.top)  / pixelSize),
    );
});
canvas.addEventListener("mouseleave", () => updateStatus(null, null));

canvas.addEventListener("mousedown", e => {
    paintColor = e.button === 2 ? 2 : 1;
    historySave();
    painting = true;
    paint(e);
});
canvas.addEventListener("mousemove",   e => { if (painting) paint(e); });
canvas.addEventListener("mouseup",     () => { painting = false; });
canvas.addEventListener("mouseleave",  () => { painting = false; });
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("touchstart", e => {
    e.preventDefault();
    historySave();
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
    pixelSize = Math.max(4, Math.min(48, pixelSize + (e.deltaY < 0 ? 2 : -2)));
    resizeCanvas();
    render();
}, { passive: false });

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function historyReset() {
    history.length = 0;
    historyIndex   = -1;
    historySave();
}

function historySave() {
    if (!pixels) return;
    history.splice(historyIndex + 1);
    history.push(pixels.slice());
    historyIndex = history.length - 1;
    if (history.length > 64) { history.shift(); historyIndex--; }
}

function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    pixels = history[historyIndex].slice();
    recomputeHighlights();
    render();
}

function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    pixels = history[historyIndex].slice();
    recomputeHighlights();
    render();
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

// ── Export modal ──────────────────────────────────────────────────────────────

const exportModal    = el("export-modal");
const exportTextarea = el<HTMLTextAreaElement>("export-text");
const alternateCheck = el<HTMLInputElement>("alternate");

function hasInvalidPlacements(): boolean {
    return highlights !== null && highlights.some(h => h === 4);
}

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

function openExportModal() {
    exportTextarea.value = generateExportText();
    el("export-warning").hidden = !hasInvalidPlacements();
    exportModal.hidden = false;
}

alternateCheck.addEventListener("change", () => {
    if (!exportModal.hidden) exportTextarea.value = generateExportText();
});

el("export").addEventListener("click", openExportModal);
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
    if (state) render();
}

colorInputA.addEventListener("input", applyColors);
colorInputB.addEventListener("input", applyColors);

// ── Mode switching ────────────────────────────────────────────────────────────

el("apply").addEventListener("click", () => {
    applySettings();
    saveToLocalStorage();
});

el("mode").addEventListener("change", e => {
    const mode = (e.target as HTMLSelectElement).value;
    el("row-controls").hidden   = mode !== "row";
    el("round-controls").hidden = mode !== "round";
});

// ── Init ──────────────────────────────────────────────────────────────────────

applyColors();
if (!loadFromLocalStorage()) applySettings();
