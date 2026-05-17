import { PatternState, RowState, RoundState, SymKey } from "@mosaic/logic/types";
import { PlanType, PlanDir } from "@mosaic/wasm";
import { computeClosure, diagonalsAvailable } from "@mosaic/logic/symmetry";
import { Store, visiblePixels } from "@mosaic/logic/store";

const ZOOM_MIN     = 2;
const ZOOM_MAX     = 96;
const ROT_DURATION = 250;
const FADE_RATE    = 1 / 0.18;   // per second
const FAVICON_SIZE = 32;
const LABEL_FONT   = `ui-monospace, "SF Mono", Menlo, monospace`;
// Marching-ants scroll speed in **screen pixels** per second. Converted to
// pattern units per frame using current zoom/dpr so the perceived speed is
// constant regardless of zoom level.
const ANTS_SCREEN_PX_PER_SEC = 24;
// Discrete dash-offset step in **screen pixels**. The continuous offset
// (advanced per frame) is snapped to multiples of this step before being
// applied, so dashes jump rather than glide — the classic marching-ants
// look. With 24 px/s + 3 px/step the visual ticks ~8 times per second.
const ANTS_STEP_PX = 3;

// `PlanDir` → outward offset in pattern coords. Single source of truth for
// the direction enum decoding; the actual direction *selection* per cell
// happens in Rust (`build_highlight_plan_*`).
const DIR_VECTORS: Record<number, [number, number]> = {
    [PlanDir.Up]:    [ 0, -1],
    [PlanDir.Down]:  [ 0,  1],
    [PlanDir.Left]:  [-1,  0],
    [PlanDir.Right]: [ 1,  0],
};

// Coordinate-transform inputs: the three things that, together, define how
// pattern-space and screen-space map to each other. `dpr` is mutated by the
// canvas resize observer; `view` is mutated by gesture handlers. `ctx` is
// drawing-specific and lives at the call site, not in this bundle.
export interface ViewState { panX: number; panY: number; zoom: number; }
export interface Viewport {
    canvas: HTMLCanvasElement;
    view:   ViewState;
    dpr:    number;
}

export function makeViewport(canvas: HTMLCanvasElement): Viewport {
    return {
        canvas,
        view: { panX: 0, panY: 0, zoom: 16 },
        dpr:  window.devicePixelRatio || 1,
    };
}

// Hooks the canvas resize cycle: updates the canvas backing buffer and the
// caller's dpr (via the `setDpr` callback), then calls `onResize` so the
// caller can trigger a re-render.
export function observeCanvasResize(
    canvas: HTMLCanvasElement, setDpr: (v: number) => void, onResize: () => void,
) {
    function update() {
        const dpr = window.devicePixelRatio || 1;
        setDpr(dpr);
        const w = Math.max(1, Math.round(canvas.clientWidth  * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width  = w;
            canvas.height = h;
        }
    }
    update();
    new ResizeObserver(() => { update(); onResize(); }).observe(canvas);
}

// Render-internal state: animation, presentation caches. No coordinate-
// transform fields here — those live on `Viewport`. `lastStore` is the rAF
// callback's only handle to fresh data (animation frames don't carry args).
export interface RendererState {
    visualRotation: number;
    // `null` = "no render yet" → the first render snaps without animating,
    // so a restored rotation doesn't spin in on load.
    targetRotation: number | null;
    rotAnim: { startTime: number; startRot: number; endRot: number } | null;
    topIndicatorOpacity: number;
    rafId: number | null;
    lastFrameTime: number;
    lastStore: Store | null;
    // Index 1/2 refreshed from store at the top of `render`. Index 0 is the
    // hole sentinel — render loops skip; `null` makes accidental reads fail loud.
    colors: (string | null)[];
    // Third palette colour for the ! invalid marker, chosen at render time
    // to contrast nicely with both user colours. See `chooseInvalidColor`.
    invalidColor: string;
    // During a replace-mode select drag, the existing float outline is
    // hidden (the drag is about to drop it). For add/remove modes it stays
    // visible so the user can see what they're modifying.
    hideCommittedSelection: boolean;
    // Full unclamped drag rectangle (pattern coords, inclusive). Rendered as
    // a marching-ants outline during a select drag — same style as the
    // float marquee. Shows the user the full sweep even when it crosses the
    // canvas border. The actual committed lift (clipped to canvas, holes
    // excluded) only appears after release.
    dragRect: { x1: number; y1: number; x2: number; y2: number } | null;
    // Marching-ants phase. Animated in `frame` while any float (committed
    // or drag preview) is on-screen; used as `lineDashOffset` for the outline.
    selectionDashOffset: number;
    faviconCanvas: HTMLCanvasElement;
    faviconCtx:    CanvasRenderingContext2D;
}

export function makeRendererState(): RendererState {
    const faviconCanvas = document.createElement("canvas");
    faviconCanvas.width  = FAVICON_SIZE;
    faviconCanvas.height = FAVICON_SIZE;
    return {
        visualRotation: 0,
        targetRotation: null,
        rotAnim:        null,
        topIndicatorOpacity: 0,
        rafId:          null,
        lastFrameTime:  0,
        lastStore:      null,
        colors:         [null, "#000000", "#ffffff"],
        invalidColor:     "hsl(0, 70%, 50%)",
        hideCommittedSelection: false,
        dragRect:               null,
        selectionDashOffset:    0,
        faviconCanvas,
        faviconCtx:     faviconCanvas.getContext("2d")!,
    };
}

// ── Third-colour picker for ! marker ───────────────────────────────────────
// Walk the hue wheel; pick the hue whose minimum hue-distance to both user
// colours is maximised. Hue is fully algorithmic — never directly user-
// configurable, so changing palette colours auto-updates the marker.
// `intensity` (0..100) is the user's "vibe" knob: it drives HSL saturation
// directly (0% → grey, 100% → max). Default 65 is sensible for most palettes.
// Grayscale inputs have no meaningful hue, so they contribute nothing to the
// constraint — their `Infinity` is filtered by `Math.min`. If both inputs
// are grayscale, every hue is equally good; we default to red (conventional
// warning colour).
function chooseInvalidColor(a: string, b: string, intensity: number): string {
    const sat = Math.max(0, Math.min(100, intensity));
    const { h: ha, s: sa } = hexToHsl(a);
    const { h: hb, s: sb } = hexToHsl(b);
    const aIsGray = sa < 0.1;
    const bIsGray = sb < 0.1;
    if (aIsGray && bIsGray) return `hsl(0, ${sat}%, 50%)`;
    let bestH = 0, bestDist = -1;
    for (let h = 0; h < 360; h += 3) {
        const da = aIsGray ? Infinity : hueDist(h, ha);
        const db = bIsGray ? Infinity : hueDist(h, hb);
        const d = Math.min(da, db);
        if (d > bestDist) { bestDist = d; bestH = h; }
    }
    return `hsl(${bestH}, ${sat}%, 50%)`;
}

function hueDist(h1: number, h2: number): number {
    const d = Math.abs(h1 - h2);
    return Math.min(d, 360 - d);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else                h = ((r - g) / d + 4) * 60;
    }
    return { h, s, l };
}

// ── Pure math ──────────────────────────────────────────────────────────────
export function clampZoom(z: number) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

// Pan/zoom/rotation all go through ctx so the rotation pivot is the *pattern*
// centre (not canvas centre): centre the pattern, scale, rotate, translate
// to canvas-centre + pan.
function buildMatrix(
    canvas: HTMLCanvasElement, view: ViewState, dpr: number, visualRotation: number,
    pattern: PatternState,
): DOMMatrix {
    return new DOMMatrix()
        .translate(canvas.width  / 2 + view.panX * dpr,
                   canvas.height / 2 + view.panY * dpr)
        .rotate(visualRotation)
        .scale(view.zoom * dpr)
        .translate(-pattern.canvasWidth / 2, -pattern.canvasHeight / 2);
}

export function screenToPattern(
    canvas: HTMLCanvasElement, view: ViewState, dpr: number, visualRotation: number,
    pattern: PatternState, clientX: number, clientY: number,
): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * dpr;
    const cy = (clientY - rect.top)  * dpr;
    const p = buildMatrix(canvas, view, dpr, visualRotation, pattern)
        .inverse().transformPoint({ x: cx, y: cy });
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

export function fitToView(
    canvas: HTMLCanvasElement, view: ViewState, pattern: PatternState, rotationDeg: number,
) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const margin = 0.92;
    // Rotated W×H rectangle's axis-aligned bounding box:
    // (W·|cos θ| + H·|sin θ|, W·|sin θ| + H·|cos θ|).
    const rad = rotationDeg * Math.PI / 180;
    const c = Math.abs(Math.cos(rad));
    const s = Math.abs(Math.sin(rad));
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    const aabbW = W * c + H * s;
    const aabbH = W * s + H * c;
    view.zoom = clampZoom(margin * Math.min(rect.width / aabbW, rect.height / aabbH));
    view.panX = 0;
    view.panY = 0;
}

// ── Animation ──────────────────────────────────────────────────────────────
function syncRotation(
    rs: RendererState, targetDeg: number, vp: Viewport, ctx: CanvasRenderingContext2D,
) {
    if (rs.targetRotation === null) {
        rs.visualRotation = targetDeg;
        rs.targetRotation = targetDeg;
        return;
    }
    if (rs.targetRotation === targetDeg) return;
    rs.rotAnim = { startTime: performance.now(), startRot: rs.visualRotation, endRot: targetDeg };
    rs.targetRotation = targetDeg;
    startRaf(rs, vp, ctx);
}

function startRaf(rs: RendererState, vp: Viewport, ctx: CanvasRenderingContext2D) {
    if (rs.rafId !== null) return;
    rs.lastFrameTime = performance.now();
    rs.rafId = requestAnimationFrame(now => frame(rs, vp, ctx, now));
}

function frame(rs: RendererState, vp: Viewport, ctx: CanvasRenderingContext2D, now: number) {
    let active = false;
    if (rs.rotAnim) {
        const t = Math.min(1, (now - rs.rotAnim.startTime) / ROT_DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        rs.visualRotation = rs.rotAnim.startRot + (rs.rotAnim.endRot - rs.rotAnim.startRot) * eased;
        if (t < 1) active = true;
        else { rs.visualRotation = rs.rotAnim.endRot; rs.rotAnim = null; }
    }

    const targetOpacity = rs.rotAnim ? 1 : 0;
    const dtSec = Math.min(0.05, (now - rs.lastFrameTime) / 1000);
    if (rs.topIndicatorOpacity !== targetOpacity) {
        const step = FADE_RATE * dtSec;
        rs.topIndicatorOpacity = rs.topIndicatorOpacity < targetOpacity
            ? Math.min(targetOpacity, rs.topIndicatorOpacity + step)
            : Math.max(targetOpacity, rs.topIndicatorOpacity - step);
        if (rs.topIndicatorOpacity !== targetOpacity) active = true;
    }

    // Marching ants: animate the dash offset while any ants outline is
    // visible. Convert screen-px/sec to pattern-units/sec so the visible
    // speed is constant across zoom levels. The modulo keeps the offset
    // bounded so floating-point precision holds over long sessions.
    const antsVisible = rs.dragRect !== null
        || (rs.lastStore && !rs.hideCommittedSelection && rs.lastStore.state.float !== null);
    if (antsVisible) {
        const advance = (ANTS_SCREEN_PX_PER_SEC * dtSec) / (vp.view.zoom * vp.dpr);
        rs.selectionDashOffset = (rs.selectionDashOffset + advance) % 1000;
        active = true;
    }

    if (rs.lastStore) rerender(vp, ctx, rs, rs.lastStore);
    rs.lastFrameTime = now;
    rs.rafId = active ? requestAnimationFrame(now2 => frame(rs, vp, ctx, now2)) : null;
}

// ── Favicon ────────────────────────────────────────────────────────────────
function updateFavicon(
    faviconCanvas: HTMLCanvasElement, faviconCtx: CanvasRenderingContext2D,
    colors: (string | null)[], pattern: PatternState, pixels: Uint8Array,
) {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const scale = Math.min(FAVICON_SIZE / W, FAVICON_SIZE / H);
    const px    = Math.max(1, Math.floor(scale));
    const offX  = Math.floor((FAVICON_SIZE - W * scale) / 2);
    const offY  = Math.floor((FAVICON_SIZE - H * scale) / 2);

    faviconCtx.clearRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const p = pixels[y * W + x];
            if (p === 0) continue;
            faviconCtx.fillStyle = colors[p] ?? "#333";
            faviconCtx.fillRect(offX + Math.floor(x * scale), offY + Math.floor(y * scale), px, px);
        }
    }

    const link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (link) link.href = faviconCanvas.toDataURL("image/png");
}

// ── Top-level entry ────────────────────────────────────────────────────────
export function render(vp: Viewport, ctx: CanvasRenderingContext2D, rs: RendererState, store: Store) {
    rs.lastStore    = store;
    rs.colors[1]    = store.state.colorA;
    rs.colors[2]    = store.state.colorB;
    rs.invalidColor = chooseInvalidColor(store.state.colorA, store.state.colorB, store.state.invalidIntensity);
    syncRotation(rs, store.state.rotation, vp, ctx);
    // Kick off the rAF loop whenever any marching-ants outline is on-screen
    // (committed selection that isn't hidden, or an in-flight drag rect).
    // `frame()` advances the dash offset each tick and stops on its own.
    const antsVisible = rs.dragRect !== null
        || (!rs.hideCommittedSelection && store.state.float !== null);
    if (antsVisible) startRaf(rs, vp, ctx);
    updateFavicon(rs.faviconCanvas, rs.faviconCtx, rs.colors, store.state.pattern, store.state.pixels);
    rerender(vp, ctx, rs, store);
}

function rerender(vp: Viewport, ctx: CanvasRenderingContext2D, rs: RendererState, store: Store) {
    const { pattern, pixels, float, symmetry, hlOpacity, labelsVisible } = store.state;
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const { canvas, view, dpr } = vp;

    // `visiblePixels` = canvas pixels with the float stamped at offset
    // (off-canvas / hole destinations dropped — same rules the commit applies).
    // Used as the pixel source for both the cell render pass and the
    // highlight-symbol pass. `store.plan` is already computed from this
    // buffer (see `computePlan` in store.ts), so ✕ / ! markers track the
    // float live without a per-frame WASM rebuild.
    const previewPixels = visiblePixels(store.state);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#161618";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const m = buildMatrix(canvas, view, dpr, rs.visualRotation, pattern);
    ctx.setTransform(m);
    ctx.imageSmoothingEnabled = false;
    // E2E test hook: latest canvas-pixel transform so Playwright can map
    // (cellX, cellY) → CSS click coords without coupling to view state.
    // No-op for users; one property write per render.
    (window as unknown as { __test_matrix__?: DOMMatrix }).__test_matrix__ = m;

    for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
            const p = previewPixels[row + x];
            if (p === 0) continue;
            ctx.fillStyle = rs.colors[p] ?? "#333";
            ctx.fillRect(x, y, 1, 1);
        }
    }
    // Grid: 1 device pixel regardless of zoom.
    const px = 1 / (view.zoom * dpr);
    ctx.lineWidth = px;
    ctx.strokeStyle = "rgba(128, 128, 128, 0.18)";
    ctx.beginPath();
    for (let x = 0; x <= W; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y++) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    renderHighlightSymbols(ctx, view, dpr, rs.colors, rs.invalidColor, pattern, previewPixels, store.plan, m, hlOpacity / 100);
    renderSymmetryGuides(ctx, view, dpr, pattern, symmetry);
    // During a drag, the preview wins even when empty (drag started outside
    // canvas in replace mode → old float outline visually disappears immediately).
    // Snap the dash offset to discrete screen-pixel steps so dashes visibly
    // tick rather than glide.
    const stepInPat = ANTS_STEP_PX / (view.zoom * dpr);
    const dashOffsetSnapped = Math.floor(rs.selectionDashOffset / stepInPat) * stepInPat;
    if (float && !rs.hideCommittedSelection) {
        const shifted = new Uint8Array(W * H);
        for (let ly = 0; ly < float.h; ly++) {
            for (let lx = 0; lx < float.w; lx++) {
                if (float.pixels[ly * float.w + lx] === 0) continue;
                const cx = float.x + lx, cy = float.y + ly;
                if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
                if (pixels[cy * W + cx] === 0) continue;   // holes drop
                shifted[cy * W + cx] = 1;
            }
        }
        renderSelection(ctx, view, dpr, pattern, shifted, rs.invalidColor, dashOffsetSnapped);
    }
    if (rs.dragRect) renderDragRect(ctx, view, dpr, rs.dragRect, rs.invalidColor, dashOffsetSnapped);
    if (labelsVisible) {
        if (pattern.mode === "row") renderRowLabels(ctx, view, dpr, pattern, m);
        else                         renderRoundLabels(ctx, view, dpr, pattern, pixels, m);
    }
    if (rs.topIndicatorOpacity > 0.001) renderTopIndicator(ctx, view, dpr, pattern, rs.topIndicatorOpacity);
}

// Outline of a selection: walk all selected cells, emit a line segment for
// each side that borders an unselected cell (or canvas edge). Drawn in the
// existing `invalidColor` — already a palette-distinct contrast pick — so
// it's visible against either palette. Static dashes; animating the offset
// in the rAF loop is a Phase 1 follow-up.
// Trace the selection's boundary as one or more closed polylines (one per
// connected component, plus one per hole). Each loop is CCW around the
// selected region — top edge goes right, right edge goes down, bottom edge
// goes left, left edge goes up. Holes naturally end up CW. Returned as flat
// number arrays [x0, y0, x1, y1, …]; first and last point coincide.
// Renderer walks each loop as a single continuous subpath, so the marching-
// ants dash offset flows around the perimeter (rather than restarting per
// cell-edge, which would look like flickering noise instead of motion).
function tracedBoundary(selection: Uint8Array, W: number, H: number): number[][] {
    const cornerKey = (x: number, y: number) => y * (W + 1) + x;
    const edgeFrom = new Map<number, [number, number, number, number]>();
    const sel = (x: number, y: number) =>
        x >= 0 && x < W && y >= 0 && y < H && selection[y * W + x] === 1;

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (!sel(x, y)) continue;
            if (!sel(x,     y - 1)) edgeFrom.set(cornerKey(x,     y),     [x,     y,     x + 1, y    ]); // top    →
            if (!sel(x + 1, y))     edgeFrom.set(cornerKey(x + 1, y),     [x + 1, y,     x + 1, y + 1]); // right  ↓
            if (!sel(x,     y + 1)) edgeFrom.set(cornerKey(x + 1, y + 1), [x + 1, y + 1, x,     y + 1]); // bottom ←
            if (!sel(x - 1, y))     edgeFrom.set(cornerKey(x,     y + 1), [x,     y + 1, x,     y    ]); // left   ↑
        }
    }

    const paths: number[][] = [];
    while (edgeFrom.size > 0) {
        const startKey: number = edgeFrom.keys().next().value!;
        const path: number[] = [];
        let key = startKey;
        while (edgeFrom.has(key)) {
            const e = edgeFrom.get(key)!;
            edgeFrom.delete(key);
            if (path.length === 0) path.push(e[0], e[1]);
            path.push(e[2], e[3]);
            key = cornerKey(e[2], e[3]);
            if (key === startKey) break;
        }
        if (path.length >= 4) paths.push(path);
    }
    return paths;
}

function renderSelection(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, selection: Uint8Array | null,
    color: string, dashOffset: number,
) {
    if (!selection) return;
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    const lw   = 3.0 / (view.zoom * dpr);
    const dash = 6   / (view.zoom * dpr);

    ctx.save();
    ctx.lineWidth      = lw;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = dashOffset;
    ctx.strokeStyle    = color;
    ctx.beginPath();
    for (const path of tracedBoundary(selection, W, H)) {
        ctx.moveTo(path[0], path[1]);
        for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    }
    ctx.stroke();
    ctx.restore();
}

// Marching-ants outline of the in-flight drag rect — same style as the
// selection outline so the visual reads consistently. Shows the full sweep
// even when the rect crosses the canvas border. The actually-committed
// selection (clipped to canvas, holes excluded) only appears after release.
function renderDragRect(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    r: { x1: number; y1: number; x2: number; y2: number },
    color: string, dashOffset: number,
) {
    const lw   = 3.0 / (view.zoom * dpr);
    const dash = 6   / (view.zoom * dpr);
    const x1 = Math.min(r.x1, r.x2), y1 = Math.min(r.y1, r.y2);
    const x2 = Math.max(r.x1, r.x2) + 1, y2 = Math.max(r.y1, r.y2) + 1;
    ctx.save();
    ctx.lineWidth      = lw;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = dashOffset;
    ctx.strokeStyle    = color;
    // One closed subpath so the dash offset flows around the rectangle.
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y2); ctx.lineTo(x1, y2); ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
}

// ── Drawing helpers ────────────────────────────────────────────────────────
// ✕ for VALID overlay — pattern coords, auto-contrast (opposite of the cell
//   colour the glyph lands on, so the glyph is readable against either
//   palette).
// ! for INVALID — screen coords (always points down regardless of canvas
//   rotation, like axis labels). Drawn in `invalidColor` — a third palette
//   colour chosen at render time to contrast with both user colours so the
//   marker reads against any cell underneath.
// Both ✕ and ! are dimmable via the user's opacity slider. Round-mode corners
// produce two plan records sharing the wrong cell with perpendicular
// directions; each draws independently.
function renderHighlightSymbols(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    colors: (string | null)[], invalidColor: string,
    pattern: PatternState, pixels: Uint8Array, plan: Int16Array,
    m: DOMMatrix, opacity: number,
) {
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    const A = colors[1] ?? "#000";
    const B = colors[2] ?? "#fff";

    // Glyph colour for ✕ is the opposite of the *outward* cell's colour where
    // the glyph actually lands. For gutter (out-of-canvas) outward cells, fall
    // back to the wrong cell's own pixel value.
    function outwardPixel(ox: number, oy: number, wx: number, wy: number): number {
        if (ox >= 0 && ox < W && oy >= 0 && oy < H) return pixels[oy * W + ox];
        return pixels[wy * W + wx];
    }
    const groups: { display: 1 | 2; glyph: string }[] = [
        { display: 1, glyph: B },
        { display: 2, glyph: A },
    ];

    ctx.save();
    ctx.globalAlpha = opacity;

    // ── ✕ overlays — pattern coords ─────────────────────────────────────────
    ctx.lineCap  = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.16;
    for (const { display, glyph } of groups) {
        ctx.strokeStyle = glyph;
        ctx.beginPath();
        for (let i = 0; i < plan.length; i += 4) {
            if (plan[i] !== PlanType.Valid) continue;
            const wx = plan[i+2], wy = plan[i+3];
            const [dx, dy] = DIR_VECTORS[plan[i+1]];
            const ox = wx + dx, oy = wy + dy;
            if (outwardPixel(ox, oy, wx, wy) !== display) continue;
            ctx.moveTo(ox + 0.24, oy + 0.24); ctx.lineTo(ox + 0.76, oy + 0.76);
            ctx.moveTo(ox + 0.76, oy + 0.24); ctx.lineTo(ox + 0.24, oy + 0.76);
        }
        ctx.stroke();
    }

    // ── ! invalid — screen coords ───────────────────────────────────────────
    const cellPx  = view.zoom * dpr;
    const stemTop = cellPx * 0.28;
    const stemBot = cellPx * 0.08;
    const dotR    = cellPx * 0.09;
    const dotY    = cellPx * 0.28;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.strokeStyle = invalidColor;
    ctx.lineWidth   = cellPx * 0.16;
    ctx.beginPath();
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] !== PlanType.Invalid) continue;
        const wx = plan[i+2], wy = plan[i+3];
        const [dx, dy] = DIR_VECTORS[plan[i+1]];
        const ox = wx + dx, oy = wy + dy;
        const p = m.transformPoint({ x: ox + 0.5, y: oy + 0.5 });
        ctx.moveTo(p.x, p.y - stemTop);
        ctx.lineTo(p.x, p.y + stemBot);
    }
    ctx.stroke();

    ctx.fillStyle = invalidColor;
    ctx.beginPath();
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] !== PlanType.Invalid) continue;
        const wx = plan[i+2], wy = plan[i+3];
        const [dx, dy] = DIR_VECTORS[plan[i+1]];
        const ox = wx + dx, oy = wy + dy;
        const p = m.transformPoint({ x: ox + 0.5, y: oy + 0.5 });
        ctx.moveTo(p.x + dotR, p.y + dotY);
        ctx.arc(p.x, p.y + dotY, dotR, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();

    ctx.restore();
}

// Row labels in the left gutter — row 1 at the bottom (mosaic convention).
function renderRowLabels(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: RowState, m: DOMMatrix,
) {
    const cell = view.zoom * dpr;
    const { canvasHeight: H } = pattern;
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

// Round labels — innermost ring numbered 1. Placement:
//   • full     — inside the top-left corner cell of each ring: ring r at (r, r).
//   • half/qtr — above the canvas in the top gutter, centred on column r.
function renderRoundLabels(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: RoundState, pixels: Uint8Array, m: DOMMatrix,
) {
    const cell = view.zoom * dpr;
    const { canvasWidth: W, canvasHeight: H, rounds, offsetY } = pattern;
    const isFull = offsetY === 0;
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
    for (let i = 0; i < rounds; i++) {
        let cx: number, cy: number;
        if (isFull) {
            const px = i, py = i;
            if (px >= W || py >= H) continue;
            if (pixels[py * W + px] === 0) continue;
            cx = px + 0.5; cy = py + 0.5;
        } else {
            if (i >= W) continue;
            cx = i + 0.5; cy = -0.3;
        }
        const label = String(rounds - i);
        const p = m.transformPoint({ x: cx, y: cy });
        if (isFull) ctx.strokeText(label, p.x, p.y);
        ctx.fillText(label, p.x, p.y);
    }
    ctx.restore();
}

function renderTopIndicator(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, opacity: number,
) {
    const cx = pattern.canvasWidth / 2;
    const tipY  = -0.4;
    const baseY = -1.6;
    const half  = 0.7;

    ctx.save();
    ctx.fillStyle   = `rgba(214, 83, 163, ${(0.92 * opacity).toFixed(3)})`;
    ctx.strokeStyle = `rgba(0, 0, 0, ${(0.55 * opacity).toFixed(3)})`;
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

function renderSymmetryGuides(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, active: Set<SymKey>,
) {
    if (active.size === 0) return;
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const closure = computeClosure(active, diagonalsAvailable(W, H));
    if (closure.size === 0) return;

    const cx = W / 2, cy = H / 2;
    const overhang = 1;                       // pattern px past each side
    const ovhDiag  = overhang / Math.SQRT2;   // along-line equivalent for diagonals
    const lw       = 1.6 / (view.zoom * dpr);
    const dash     = 8   / (view.zoom * dpr);
    const dashGap  = dash * 0.55;

    const draw = (x1: number, y1: number, x2: number, y2: number, direct: boolean) => {
        ctx.strokeStyle = direct ? "rgba(255, 80, 180, 0.85)" : "rgba(255, 80, 180, 0.35)";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    };
    const d = (k: SymKey) => active.has(k);

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
        // D2 axis. In pixel-index coords it's x + y = (W+H−2)/2; in render
        // coords (each pixel spans [n, n+1], both x and y shift by +0.5)
        // it becomes x + y = (W+H)/2.
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

// ── Status bar ─────────────────────────────────────────────────────────────
export function updateStatus(plan: Int16Array | null, x: number | null, y: number | null) {
    if (!plan) return;
    // Corners emit two records sharing the same wrong cell — counted once
    // each since each is a distinct visible glyph.
    let valid = 0, invalid = 0;
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] === PlanType.Valid) valid++;
        else                            invalid++;
    }
    const coord = x !== null && y !== null ? `${x}, ${y}` : "";
    const overlays = `${valid} overlay${valid !== 1 ? "s" : ""}`;
    const inv = invalid > 0 ? `${invalid} invalid` : "";
    const el = document.getElementById("status")!;
    el.textContent = [coord, overlays, inv].filter(Boolean).join("  ·  ");
}
