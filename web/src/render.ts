import { PatternState, SymKey } from "./types";
import { computeClosure, diagonalsAvailable, directlyActive } from "./symmetry";

export const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;

export const COLORS: (string | null)[] = [
    null,                       // 0 transparent (inner hole)
    "#000000",                  // 1 primary
    "#ffffff",                  // 2 secondary
    "rgba(0, 0, 255, 0.5)",     // 3 valid overlay
    "rgba(255, 0, 0, 0.5)",     // 4 invalid placement
];

export const view = {
    panX: 0,        // CSS-px offset of pattern centre from canvas centre
    panY: 0,
    zoom: 16,       // canvas CSS-px per pattern pixel
    rotation: 0,    // degrees, accumulates unbounded — the *target* rotation
};

// Animated rotation actually drawn this frame. Distinct from view.rotation
// (which is the logical target) so painting during a rotation animation hits
// the pixel that's actually visible.
let visualRotation = 0;

const ZOOM_MIN = 2;
const ZOOM_MAX = 96;

let dpr = 1;
let lastState: PatternState | null = null;
let lastPixels: Uint8Array | null = null;
let lastHighlights: Uint8Array | null = null;

export function clampZoom(z: number) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

function resizeBacking() {
    dpr = window.devicePixelRatio || 1;
    // clientWidth/Height are unaffected by CSS transforms — robust even if a
    // resize fires while the canvas is mid-animation.
    const w = Math.max(1, Math.round(canvas.clientWidth  * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
}

new ResizeObserver(() => {
    resizeBacking();
    rerender();
}).observe(canvas);

resizeBacking();

// All of pan, zoom, and rotation go through ctx so the rotation pivot is the
// *pattern* centre (not the canvas centre): the matrix centres the pattern,
// scales, rotates, then translates to canvas-centre + pan.
function buildMatrix(state: PatternState): DOMMatrix {
    return new DOMMatrix()
        .translate(canvas.width  / 2 + view.panX * dpr,
                   canvas.height / 2 + view.panY * dpr)
        .rotate(visualRotation)
        .scale(view.zoom * dpr)
        .translate(-state.canvasWidth / 2, -state.canvasHeight / 2);
}

export function screenToPattern(state: PatternState, clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * dpr;
    const cy = (clientY - rect.top)  * dpr;
    const p = buildMatrix(state).inverse().transformPoint({ x: cx, y: cy });
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

export function fitToView(state: PatternState) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const margin = 0.92;
    view.zoom = clampZoom(margin * Math.min(rect.width / state.canvasWidth, rect.height / state.canvasHeight));
    view.panX = 0;
    view.panY = 0;
}

// ── Rotation animation ───────────────────────────────────────────────────────
// Both visualRotation and topIndicatorOpacity are driven by a single rAF loop.
// rotation: eases from current visualRotation to view.rotation over 250 ms.
// indicator opacity: eases toward 1 while a rotation is active, toward 0 when
// idle, at a constant 1/0.18 units per second (≈180 ms full fade).

let rotAnim: { startTime: number; startRot: number; endRot: number } | null = null;
let topIndicatorOpacity = 0;
let rafId: number | null = null;
let lastFrameTime = 0;

const ROT_DURATION = 250;
const FADE_RATE    = 1 / 0.18; // per second

function frame(now: number) {
    let active = false;

    if (rotAnim) {
        const t = Math.min(1, (now - rotAnim.startTime) / ROT_DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        visualRotation = rotAnim.startRot + (rotAnim.endRot - rotAnim.startRot) * eased;
        if (t < 1) active = true;
        else { visualRotation = rotAnim.endRot; rotAnim = null; }
    }

    const targetOpacity = rotAnim ? 1 : 0;
    const dtSec = Math.min(0.05, (now - lastFrameTime) / 1000);
    if (topIndicatorOpacity !== targetOpacity) {
        const step = FADE_RATE * dtSec;
        topIndicatorOpacity = topIndicatorOpacity < targetOpacity
            ? Math.min(targetOpacity, topIndicatorOpacity + step)
            : Math.max(targetOpacity, topIndicatorOpacity - step);
        if (topIndicatorOpacity !== targetOpacity) active = true;
    }

    rerender();
    lastFrameTime = now;

    rafId = active ? requestAnimationFrame(frame) : null;
}

function startRaf() {
    if (rafId !== null) return;
    lastFrameTime = performance.now();
    rafId = requestAnimationFrame(frame);
}

export function applyRotation() {
    rotAnim = {
        startTime: performance.now(),
        startRot:  visualRotation,
        endRot:    view.rotation,
    };
    startRaf();
}

export function setRotationImmediate(deg: number) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    rotAnim = null;
    view.rotation = deg;
    visualRotation = deg;
    topIndicatorOpacity = 0;
    rerender();
}

export function render(state: PatternState, pixels: Uint8Array, highlights: Uint8Array) {
    lastState = state; lastPixels = pixels; lastHighlights = highlights;
    rerender();
}

function rerender() {
    if (!lastState || !lastPixels || !lastHighlights) return;
    const state = lastState, pixels = lastPixels, highlights = lastHighlights;
    const { canvasWidth: W, canvasHeight: H } = state;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#161618";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const m = buildMatrix(state);
    ctx.setTransform(m);
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
            const p = pixels[row + x];
            if (p === 0) continue;
            ctx.fillStyle = COLORS[p] ?? "#333";
            ctx.fillRect(x, y, 1, 1);
            const h = highlights[row + x];
            if (h !== 0) {
                ctx.fillStyle = COLORS[h] ?? "";
                ctx.fillRect(x, y, 1, 1);
            }
        }
    }

    // Grid: 1 device pixel regardless of zoom
    const px = 1 / (view.zoom * dpr);
    ctx.lineWidth = px;
    ctx.strokeStyle = "rgba(128, 128, 128, 0.18)";
    ctx.beginPath();
    for (let x = 0; x <= W; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y++) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    renderSymmetryGuides(state);
    if (topIndicatorOpacity > 0.001) renderTopIndicator(state);
}

function renderTopIndicator(state: PatternState) {
    const cx = state.canvasWidth / 2;
    const tipY  = -0.4;
    const baseY = -1.6;
    const half  = 0.7;
    const a     = topIndicatorOpacity;

    ctx.save();
    ctx.fillStyle   = `rgba(214, 83, 163, ${(0.92 * a).toFixed(3)})`;
    ctx.strokeStyle = `rgba(0, 0, 0, ${(0.55 * a).toFixed(3)})`;
    ctx.lineWidth   = 1.2 / (view.zoom * dpr);
    ctx.lineJoin    = "round";
    ctx.beginPath();
    ctx.moveTo(cx - half, baseY);
    ctx.lineTo(cx + half, baseY);
    ctx.lineTo(cx,        tipY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function renderSymmetryGuides(state: PatternState) {
    if (directlyActive.size === 0) return;
    const { canvasWidth: W, canvasHeight: H } = state;
    const closure = computeClosure(directlyActive, diagonalsAvailable(W, H));
    if (closure.size === 0) return;

    const cx = W / 2, cy = H / 2;
    const ext = Math.max(W, H);
    const lw = 1.6 / (view.zoom * dpr);
    const dash = 8 / (view.zoom * dpr);
    const dashGap = dash * 0.55;

    const draw = (x1: number, y1: number, x2: number, y2: number, direct: boolean) => {
        ctx.strokeStyle = direct ? "rgba(255, 80, 180, 0.85)" : "rgba(255, 80, 180, 0.35)";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    };
    const d = (k: SymKey) => directlyActive.has(k);

    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash([dash, dashGap]);
    if (closure.has("V"))  draw(cx, 0, cx, H, d("V"));
    if (closure.has("H"))  draw(0, cy, W, cy, d("H"));
    if (closure.has("D1")) draw(cx - ext, cy - ext, cx + ext, cy + ext, d("D1"));
    if (closure.has("D2")) draw(cx + ext, cy - ext, cx - ext, cy + ext, d("D2"));
    if (closure.has("C")) {
        ctx.setLineDash([]);
        ctx.fillStyle = d("C") ? "rgba(255, 80, 180, 0.95)" : "rgba(255, 80, 180, 0.45)";
        ctx.beginPath();
        ctx.arc(cx, cy, 0.35, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

export function updateStatus(highlights: Uint8Array | null, x: number | null, y: number | null) {
    if (!highlights) return;
    let valid = 0, invalid = 0;
    for (let i = 0; i < highlights.length; i++) {
        const h = highlights[i];
        if (h === 3) valid++;
        else if (h === 4) invalid++;
    }
    const coord = x !== null && y !== null ? `${x}, ${y}` : "";
    const overlays = `${valid} overlay${valid !== 1 ? "s" : ""}`;
    const inv = invalid > 0 ? `${invalid} invalid` : "";
    const el = document.getElementById("status")!;
    el.textContent = [coord, overlays, inv].filter(Boolean).join("  ·  ");
}
