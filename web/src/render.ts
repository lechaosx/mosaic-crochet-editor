import { PatternState, SymKey } from "./types";
import { el } from "./dom";
import { computeClosure, diagonalsAvailable, directlyActive } from "./symmetry";

export const canvas = el<HTMLCanvasElement>("canvas");
const ctx    = canvas.getContext("2d")!;

export let pixelSize = 16;

export const COLORS: (string | null)[] = [
    null,                    // 0 transparent
    "#000000",               // 1 primary
    "#ffffff",               // 2 secondary
    "rgba(0, 0, 255, 0.5)", // 3 valid overlay
    "rgba(255, 0, 0, 0.5)", // 4 invalid placement
];

export function setPixelSize(size: number) {
    pixelSize = Math.max(4, Math.min(48, size));
}

export function resizeCanvas(state: PatternState) {
    canvas.width  = state.canvasWidth  * pixelSize;
    canvas.height = state.canvasHeight * pixelSize;
}

export function render(state: PatternState, pixels: Uint8Array, highlights: Uint8Array) {
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

    renderSymmetryGuides(state);
}

function renderSymmetryGuides(state: PatternState) {
    if (directlyActive.size === 0) return;
    const { canvasWidth: W, canvasHeight: H } = state;
    const closure = computeClosure(directlyActive, diagonalsAvailable(W, H));
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

export function updateStatus(highlights: Uint8Array | null, x: number | null, y: number | null) {
    if (!highlights) return;
    const validCount   = highlights.filter(h => h === 3).length;
    const invalidCount = highlights.filter(h => h === 4).length;
    const coord = x !== null ? `${x}, ${y}` : "";
    const overlays = `${validCount} overlay${validCount !== 1 ? "s" : ""}`;
    const invalid  = invalidCount > 0 ? `  ${invalidCount} invalid` : "";
    el("status").textContent = [coord, overlays + invalid].filter(Boolean).join("  ·  ");
}
