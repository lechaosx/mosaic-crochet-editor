import { PatternState, RowState, RoundState, SymKey } from "./types";
import { computeClosure, diagonalsAvailable, directlyActive } from "./symmetry";

export const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;

// Pixel-value lookup. Indices 1/2 are the user-chosen colours A/B. Index 0
// (transparent) is the inner-hole sentinel — we never look it up because the
// render loop skips hole cells, but a `null` makes any accidental read fail
// loud rather than silently paint the cell.
export const COLORS: (string | null)[] = [
    null,                       // 0 transparent (inner hole)
    "#000000",                  // 1 primary  (colour A)
    "#ffffff",                  // 2 secondary (colour B)
];

// Highlight glyphs (✕ overlay, ! invalid) are auto-contrast — black on light
// cells, white on dark — so they're visible against any colour pair the user
// picks, without needing dedicated highlight colour pickers. `opacity` is the
// only user-tunable.
let highlightOpacity = 0.8;

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
let labelsVisible = true;

export function setLabelsVisible  (v: boolean) { labelsVisible    = v; rerender(); }
export function setHighlightOpacity(v: number) { highlightOpacity = Math.max(0, Math.min(1, v)); rerender(); }

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
    // Account for current rotation: a rotated W×H rectangle has an axis-aligned
    // bounding box of size (W·|cos θ| + H·|sin θ|, W·|sin θ| + H·|cos θ|).
    const rad = view.rotation * Math.PI / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const W = state.canvasWidth, H = state.canvasHeight;
    const aabbW = W * c + H * s;
    const aabbH = W * s + H * c;
    view.zoom = clampZoom(margin * Math.min(rect.width / aabbW, rect.height / aabbH));
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
    updateFavicon(state, pixels);
    rerender();
}

// ── Favicon ───────────────────────────────────────────────────────────────────
const FAVICON_SIZE = 32;
const faviconCanvas = document.createElement("canvas");
faviconCanvas.width  = FAVICON_SIZE;
faviconCanvas.height = FAVICON_SIZE;
const faviconCtx = faviconCanvas.getContext("2d")!;

function updateFavicon(state: PatternState, pixels: Uint8Array) {
    const { canvasWidth: W, canvasHeight: H } = state;
    const scale = Math.min(FAVICON_SIZE / W, FAVICON_SIZE / H);
    const px    = Math.max(1, Math.floor(scale));
    const offX  = Math.floor((FAVICON_SIZE - W * scale) / 2);
    const offY  = Math.floor((FAVICON_SIZE - H * scale) / 2);

    faviconCtx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const p = pixels[y * W + x];
            if (p === 0) continue;
            faviconCtx.fillStyle = COLORS[p] ?? "#333";
            faviconCtx.fillRect(offX + Math.floor(x * scale), offY + Math.floor(y * scale), px, px);
        }
    }

    const link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (link) link.href = faviconCanvas.toDataURL("image/png");
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

    renderHighlightSymbols(W, H, pixels, highlights);

    renderSymmetryGuides(state);
    if (labelsVisible) {
        if (state.mode === "row") renderRowLabels(state);
        else                       renderRoundLabels(state, pixels);
    }
    if (topIndicatorOpacity > 0.001) renderTopIndicator(state);
}

// Highlight glyphs use the *opposite* pixel colour (A on B-cells, B on
// A-cells) — guaranteed visible against either palette choice and visually
// meaningful for overlays (the ✕ literally shows the colour that would land
// there if you overlaid). ✕ = overlay (state 3), ! = invalid (state 4).
// Grouped by (cell colour → glyph colour) so we batch one path per group.
function renderHighlightSymbols(W: number, H: number, pixels: Uint8Array, highlights: Uint8Array) {
    const groups: { color: string; pixVal: number }[] = [
        { color: COLORS[2] ?? "#fff", pixVal: 1 },   // A-cell → draw with B
        { color: COLORS[1] ?? "#000", pixVal: 2 },   // B-cell → draw with A
    ];

    ctx.save();
    ctx.globalAlpha = highlightOpacity;
    ctx.lineCap  = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.16;

    // ✕ — overlay (highlight state 3)
    for (const { color, pixVal } of groups) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
                if (pixels[row + x] !== pixVal || highlights[row + x] !== 3) continue;
                ctx.moveTo(x + 0.24, y + 0.24); ctx.lineTo(x + 0.76, y + 0.76);
                ctx.moveTo(x + 0.76, y + 0.24); ctx.lineTo(x + 0.24, y + 0.76);
            }
        }
        ctx.stroke();
    }

    // ! — invalid (highlight state 4). Vertical stroke + filled dot.
    for (const { color, pixVal } of groups) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
                if (pixels[row + x] !== pixVal || highlights[row + x] !== 4) continue;
                ctx.moveTo(x + 0.5, y + 0.22); ctx.lineTo(x + 0.5, y + 0.58);
            }
        }
        ctx.stroke();
    }
    for (const { color, pixVal } of groups) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let y = 0; y < H; y++) {
            const row = y * W;
            for (let x = 0; x < W; x++) {
                if (pixels[row + x] !== pixVal || highlights[row + x] !== 4) continue;
                ctx.moveTo(x + 0.5 + 0.09, y + 0.78);
                ctx.arc(x + 0.5, y + 0.78, 0.09, 0, Math.PI * 2);
            }
        }
        ctx.fill();
    }

    ctx.restore();
}

// Labels are positioned in pattern coords (so they pan/zoom/rotate with the
// pattern) but drawn in screen coords (so the glyphs themselves stay upright
// regardless of canvas rotation).
const LABEL_FONT = `ui-monospace, "SF Mono", Menlo, monospace`;

// Row labels in the left gutter — row 1 at the bottom (mosaic convention).
function renderRowLabels(state: RowState) {
    const cell = view.zoom * dpr;
    const { canvasHeight: H } = state;
    const m = buildMatrix(state);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${cell * 0.5}px ${LABEL_FONT}`;
    ctx.fillStyle  = "rgba(210, 210, 220, 0.75)";
    ctx.textAlign  = "right";
    ctx.textBaseline = "middle";
    for (let y = 0; y < H; y++) {
        const p = m.transformPoint({ x: -0.25, y: y + 0.5 });
        ctx.fillText(String(H - y), p.x, p.y);
    }
    ctx.restore();
}

// Round labels — innermost ring numbered 1 (mosaic convention). Placement:
//   • full     — inside the top-left corner cell of each ring: ring r at (r, r).
//   • half/qtr — above the canvas in the top gutter, centred on column r.
function renderRoundLabels(state: RoundState, pixels: Uint8Array) {
    const cell = view.zoom * dpr;
    const { canvasWidth: W, canvasHeight: H, rounds, offsetY } = state;
    const isFull = offsetY === 0;
    const m = buildMatrix(state);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${cell * (isFull ? 0.55 : 0.5)}px ${LABEL_FONT}`;
    ctx.textAlign  = "center";
    ctx.textBaseline = "middle";
    if (isFull) {
        ctx.lineWidth = Math.max(2, cell * 0.12);
        ctx.lineJoin  = "round";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
        ctx.fillStyle   = "rgba(255, 255, 255, 0.95)";
    } else {
        ctx.fillStyle = "rgba(210, 210, 220, 0.75)";
    }
    for (let r = 0; r < rounds; r++) {
        let cx: number, cy: number;
        if (isFull) {
            const px = r, py = r;
            if (px >= W || py >= H) continue;
            if (pixels[py * W + px] === 0) continue;
            cx = px + 0.5; cy = py + 0.5;
        } else {
            if (r >= W) continue;
            cx = r + 0.5; cy = -0.3;
        }
        const label = String(rounds - r);
        const p = m.transformPoint({ x: cx, y: cy });
        if (isFull) ctx.strokeText(label, p.x, p.y);
        ctx.fillText(label, p.x, p.y);
    }
    ctx.restore();
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
    const overhang = 1;                       // pattern pixels each axis pokes past the pattern
    const ovhDiag  = overhang / Math.SQRT2;   // along-line equivalent for the diagonals
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

    if (closure.has("V")) draw(cx, -overhang, cx, H + overhang, d("V"));
    if (closure.has("H")) draw(-overhang, cy, W + overhang, cy, d("H"));

    if (closure.has("D1")) {
        // D1 axis (x − y = (W−H)/2). Compute the endpoints where it exits
        // the pattern, then extend by `overhang` along the line direction.
        const off  = (W - H) / 2;
        const yMin = Math.max(0, -off);
        const yMax = Math.min(H, W - off);
        draw(yMin + off - ovhDiag, yMin - ovhDiag,
             yMax + off + ovhDiag, yMax + ovhDiag, d("D1"));
    }
    if (closure.has("D2")) {
        // D2 axis. In pixel-index coords it's `x + y = (W+H−2)/2`; we draw in
        // render coords (each pixel spans [n, n+1]) where both x and y shift by
        // +0.5, so the axis equation becomes x + y = (W+H)/2.
        const sum  = (W + H) / 2;
        const yMin = Math.max(0, sum - W);
        const yMax = Math.min(H, sum);
        draw(sum - yMin + ovhDiag, yMin - ovhDiag,
             sum - yMax - ovhDiag, yMax + ovhDiag, d("D2"));
    }

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
