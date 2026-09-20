import { PatternState, RowState, RoundState, Axis, SymKey, RepeatGrid, Float } from "@mosaic/logic/types";
import { PlanType, PlanDir, transformed_target_indices } from "@mosaic/wasm";
import { Store, visiblePixels } from "@mosaic/logic/store";
import { transformsToFlat } from "@mosaic/logic/repeat";

const ZOOM_MIN     = 2;
const ZOOM_MAX     = 96;
const ROT_DURATION = 250;
const FADE_RATE    = 1 / 0.18;   // per second
const FAVICON_SIZE = 32;
const MAX_TRANSFORM_PREVIEW_CLAIMS = 1_048_576;
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
    // to contrast nicely with both user colours. See `chooseContrastingColor`.
    contrastingColor: string;
    // A selection drag shows its resulting membership, not the old marquee.
    hideCommittedSelection: boolean;
    selectPreviewMask: Uint8Array | null;
    // The unclamped gesture footprint remains visible beside the exact
    // membership preview, including when the drag crosses the canvas edge.
    dragRect: { x1: number; y1: number; x2: number; y2: number } | null;
    // Marching-ants phase. Animated in `frame` while any float (committed
    // or drag preview) is on-screen; used as `lineDashOffset` for the outline.
    selectionDashOffset: number;
    // Axes currently dragged into the off-canvas delete zone (multi-axis
    // intersection drag picks up to one per kind). Renderer draws those
    // guides at reduced alpha so the user can see "release = gone."
    axesInDeleteZone: Set<string>;
    previewRepeatGuides: boolean;
    paintPreview: { before: Uint8Array; after: Uint8Array; plan: Int16Array; unchangedTargets: number[] } | null;
    keyboardCursor: { x: number; y: number } | null;
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
        contrastingColor:     "hsl(0, 70%, 50%)",
        hideCommittedSelection: false,
        selectPreviewMask:      null,
        dragRect:               null,
        selectionDashOffset:    0,
        axesInDeleteZone:       new Set<string>(),
        previewRepeatGuides:    false,
        paintPreview:          null,
        keyboardCursor:        null,
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
function chooseContrastingColor(a: string, b: string, intensity: number): string {
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

export function zoomAt(
    canvas: HTMLCanvasElement, view: ViewState,
    clientX: number, clientY: number, factor: number,
) {
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width  / 2);
    const dy = clientY - (rect.top  + rect.height / 2);
    const newZoom = clampZoom(view.zoom * factor);
    const f = newZoom / view.zoom;
    view.panX = dx - f * (dx - view.panX);
    view.panY = dy - f * (dy - view.panY);
    view.zoom = newZoom;
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

// Same as `screenToPattern` but keeps the fractional cell coordinates —
// callers that need to hit-test against sub-cell features (axis lines,
// rotation points) want continuous coords, not floored cell indices.
export function screenToPatternFrac(
    canvas: HTMLCanvasElement, view: ViewState, dpr: number, visualRotation: number,
    pattern: PatternState, clientX: number, clientY: number,
): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const cx = (clientX - rect.left) * dpr;
    const cy = (clientY - rect.top)  * dpr;
    const p = buildMatrix(canvas, view, dpr, visualRotation, pattern)
        .inverse().transformPoint({ x: cx, y: cy });
    return { x: p.x, y: p.y };
}

export function fitToView(
    canvas: HTMLCanvasElement, view: ViewState, pattern: PatternState, rotationDeg: number,
    labelsVisible: boolean,
) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const margin = 0.92;
    const rad = rotationDeg * Math.PI / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x: number, y: number, halfWidth = 0, halfHeight = 0) => {
        const rx = x * c - y * s;
        const ry = x * s + y * c;
        minX = Math.min(minX, rx - halfWidth);
        minY = Math.min(minY, ry - halfHeight);
        maxX = Math.max(maxX, rx + halfWidth);
        maxY = Math.max(maxY, ry + halfHeight);
    };
    include(-W / 2, -H / 2);
    include( W / 2, -H / 2);
    include(-W / 2,  H / 2);
    include( W / 2,  H / 2);

    if (labelsVisible && pattern.mode === "row") {
        const labelWidth = 0.34 * String(H).length;
        // The right-aligned labels stay upright while their anchors rotate with the chart.
        const includeRowLabel = (y: number) => {
            const x = -W / 2 - 0.25;
            const ry = y - H / 2;
            const anchorX = x * c - ry * s;
            const anchorY = x * s + ry * c;
            minX = Math.min(minX, anchorX - labelWidth);
            minY = Math.min(minY, anchorY - 0.28);
            maxX = Math.max(maxX, anchorX);
            maxY = Math.max(maxY, anchorY + 0.28);
        };
        includeRowLabel(0.5);
        includeRowLabel(H - 0.5);
    } else if (labelsVisible && pattern.mode === "round" && pattern.offsetY !== 0) {
        const halfWidth = 0.34 * String(pattern.rounds).length;
        const includeRoundLabel = (x: number) => {
            include(x - W / 2, -H / 2 - 0.3, halfWidth, 0.28);
        };
        includeRoundLabel(0.5);
        includeRoundLabel(pattern.rounds - 0.5);
    }

    view.zoom = clampZoom(margin * Math.min(
        rect.width / (maxX - minX),
        rect.height / (maxY - minY),
    ));
    view.panX = -view.zoom * (minX + maxX) / 2;
    view.panY = -view.zoom * (minY + maxY) / 2;
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
    rs.contrastingColor = chooseContrastingColor(store.state.colorA, store.state.colorB, store.state.invalidIntensity);
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
    const { pattern, pixels, float, axes, repeat, hlOpacity, labelsVisible } = store.state;
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const { canvas, view, dpr } = vp;

    // `visiblePixels` = canvas pixels with the float stamped at offset
    // (off-canvas / hole destinations dropped — same rules the commit applies).
    // Used as the pixel source for both the cell render pass and the
    // highlight-symbol pass. `store.plan` is already computed from this
    // buffer (see `computePlan` in store.ts), so ✕ / ! markers track the
    // float live without a per-frame WASM rebuild.
    const committedPixels = visiblePixels(store.state);
    const previewPixels = rs.paintPreview?.after ?? committedPixels;

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

    renderHighlightSymbols(ctx, view, dpr, rs.colors, rs.contrastingColor, pattern, previewPixels, rs.paintPreview?.plan ?? store.plan, m,
        store.state.showGuidance === false ? 0 : hlOpacity / 100);
    if (rs.paintPreview) renderPaintPreviewOutline(
        ctx, view, dpr, pattern, rs.paintPreview.before, rs.paintPreview.after,
        rs.paintPreview.unchangedTargets, rs.contrastingColor,
    );
    if (rs.previewRepeatGuides) {
        renderSelectionTransformPreview(ctx, view, dpr, pattern, pixels, float, axes, repeat, rs.colors, rs.contrastingColor);
    }
    renderRepeatGuides(ctx, view, dpr, pattern, repeat, rs.contrastingColor, rs.previewRepeatGuides);
    renderSymmetryGuides(ctx, view, dpr, pattern, axes, rs.contrastingColor, rs.axesInDeleteZone, rs.previewRepeatGuides);
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
        renderSelection(ctx, view, dpr, pattern, shifted, rs.contrastingColor, dashOffsetSnapped);
    }
    if (rs.selectPreviewMask) {
        renderSelection(ctx, view, dpr, pattern, rs.selectPreviewMask, rs.contrastingColor, dashOffsetSnapped);
    }
    if (rs.dragRect) {
        ctx.save();
        ctx.globalAlpha = rs.selectPreviewMask ? 0.45 : 1;
        renderDragRect(ctx, view, dpr, rs.dragRect, rs.contrastingColor, dashOffsetSnapped);
        ctx.restore();
    }
    if (labelsVisible) {
        if (pattern.mode === "row") renderRowLabels(ctx, view, dpr, pattern, m);
        else                         renderRoundLabels(ctx, view, dpr, pattern, pixels, m);
    }
    if (rs.keyboardCursor) renderKeyboardCursor(ctx, view, dpr, rs.keyboardCursor, rs.contrastingColor);
    if (rs.topIndicatorOpacity > 0.001) renderTopIndicator(ctx, view, dpr, pattern, rs.topIndicatorOpacity);
}

function renderKeyboardCursor(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    cell: { x: number; y: number }, color: string,
) {
    const px = 1 / (view.zoom * dpr);
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.lineWidth = 5 * px;
    ctx.strokeRect(cell.x + 2.5 * px, cell.y + 2.5 * px, 1 - 5 * px, 1 - 5 * px);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * px;
    ctx.strokeRect(cell.x + 2.5 * px, cell.y + 2.5 * px, 1 - 5 * px, 1 - 5 * px);
    ctx.restore();
}

function renderPaintPreviewOutline(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, before: Uint8Array, after: Uint8Array,
    unchangedTargets: number[], color: string,
) {
    const W = pattern.canvasWidth;
    let count = 0, minX = W, minY = pattern.canvasHeight, maxX = -1, maxY = -1;
    for (let i = 0; i < before.length; i++) {
        if (before[i] === after[i]) continue;
        const x = i % W, y = Math.floor(i / W);
        count++;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    for (const i of unchangedTargets) {
        const x = i % W, y = Math.floor(i / W);
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (!count && unchangedTargets.length === 0) return;
    ctx.save();
    const px = 2 / (view.zoom * dpr);
    ctx.lineWidth = px;
    ctx.strokeStyle = color;
    ctx.setLineDash([4 * px, 3 * px]);
    if (count + unchangedTargets.length > 256) {
        ctx.strokeRect(minX + px / 2, minY + px / 2, maxX - minX + 1 - px, maxY - minY + 1 - px);
    } else {
        ctx.beginPath();
        for (let i = 0; i < before.length; i++) {
            if (before[i] === after[i]) continue;
            const x = i % W, y = Math.floor(i / W);
            ctx.rect(x + px / 2, y + px / 2, 1 - px, 1 - px);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        for (const i of unchangedTargets) {
            const x = i % W, y = Math.floor(i / W);
            ctx.beginPath();
            ctx.arc(x + 0.5, y + 0.5, Math.min(0.15, 5 / (view.zoom * dpr)), 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

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
//   rotation, like axis labels). Drawn in `contrastingColor` — a third palette
//   colour chosen at render time to contrast with both user colours so the
//   marker reads against any cell underneath.
// Both ✕ and ! are dimmable via the user's opacity slider. Round-mode corners
// produce two plan records sharing the wrong cell with perpendicular
// directions; each draws independently.
function renderHighlightSymbols(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    colors: (string | null)[], contrastingColor: string,
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

    ctx.strokeStyle = contrastingColor;
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

    ctx.fillStyle = contrastingColor;
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

function renderRepeatGuides(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, repeat: RepeatGrid, color: string, preview: boolean,
) {
    if (!repeat.enabled && !preview) return;
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const lw = 2 / (view.zoom * dpr);
    const dash = 3 / (view.zoom * dpr);

    ctx.save();
    ctx.globalAlpha = repeat.enabled ? 0.65 : 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash([dash, dash]);
    ctx.beginPath();
    for (let x = repeat.tileWidth; x < W; x += repeat.tileWidth) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
    }
    for (let y = repeat.tileHeight; y < H; y += repeat.tileHeight) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
    }
    ctx.stroke();

    if (preview && repeat.enabled) {
        const radius = Math.max(0.16, 7 / (view.zoom * dpr));
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        if (repeat.copiesX > 0) {
            ctx.moveTo(0.5, 0.5);
            ctx.lineTo(repeat.tileWidth + 0.5, 0.5);
            ctx.moveTo(repeat.tileWidth + 0.5 + radius, 0.5);
            ctx.arc(repeat.tileWidth + 0.5, 0.5, radius, 0, Math.PI * 2);
        }
        if (repeat.copiesY > 0) {
            ctx.moveTo(0.5, 0.5);
            ctx.lineTo(0.5, repeat.tileHeight + 0.5);
            ctx.moveTo(0.5 + radius, repeat.tileHeight + 0.5);
            ctx.arc(0.5, repeat.tileHeight + 0.5, radius, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.fill();
    }
    ctx.restore();
}

export type RepeatHandleAxis = "x" | "y";

export function pickRepeatHandle(
    repeat: RepeatGrid, x: number, y: number, tolerance: number,
): RepeatHandleAxis | null {
    if (!repeat.enabled) return null;
    if (repeat.copiesX > 0 && Math.hypot(x - repeat.tileWidth - 0.5, y - 0.5) <= tolerance) return "x";
    if (repeat.copiesY > 0 && Math.hypot(x - 0.5, y - repeat.tileHeight - 0.5) <= tolerance) return "y";
    return null;
}

function renderSelectionTransformPreview(
    ctx: CanvasRenderingContext2D,
    view: ViewState,
    dpr: number,
    pattern: PatternState,
    pixels: Uint8Array,
    float: Float | null,
    axes: ReadonlyArray<Axis>,
    repeat: RepeatGrid,
    colors: (string | null)[],
    outline: string,
) {
    if (!float) return;
    const transforms = transformsToFlat(axes, repeat);
    if (transforms.length === 0) return;

    const W = pattern.canvasWidth;
    const H = pattern.canvasHeight;
    const sources = new Map<number, number>();
    for (let ly = 0; ly < float.h; ly++) {
        for (let lx = 0; lx < float.w; lx++) {
            const value = float.pixels[ly * float.w + lx];
            const x = float.x + lx;
            const y = float.y + ly;
            if (value !== 0 && x >= 0 && x < W && y >= 0 && y < H) sources.set(y * W + x, value);
        }
    }

    const claims = new Map<number, number>();
    let claimCount = 0;
    preview:
    for (const [source, value] of sources) {
        const x = source % W;
        const y = Math.floor(source / W);
        for (const target of transformed_target_indices(W, H, x, y, transforms)) {
            claimCount++;
            if (claimCount > MAX_TRANSFORM_PREVIEW_CLAIMS) {
                claims.clear();
                break preview;
            }
            if (sources.has(target) || pixels[target] === 0) continue;
            const previous = claims.get(target);
            claims.set(target, previous === undefined || previous === value ? value : 3);
        }
    }

    const inset = 2 / (view.zoom * dpr);
    ctx.save();
    ctx.lineWidth = 2 / (view.zoom * dpr);
    for (const [i, claim] of claims) {
        const x = i % W;
        const y = Math.floor(i / W);
        ctx.globalAlpha = claim === 3 ? 0.72 : 0.5;
        ctx.fillStyle = claim === 3 ? outline : colors[claim] ?? outline;
        ctx.fillRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = outline;
        ctx.strokeRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
    }
    ctx.restore();
}

function renderSymmetryGuides(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, axes: ReadonlyArray<Axis>,
    color: string, deleteZoneIds: ReadonlySet<string>, editable: boolean,
) {
    const active = axes.filter(a => a.active);
    if (active.length === 0) return;
    const { canvasWidth: W, canvasHeight: H } = pattern;

    const overhang = 1;                       // pattern px past each side
    const ovhDiag  = overhang / Math.SQRT2;   // along-line equivalent for diagonals
    const lw       = 1.6 / (view.zoom * dpr);
    const dash     = 8   / (view.zoom * dpr);
    const dashGap  = dash * 0.55;

    const draw = (x1: number, y1: number, x2: number, y2: number) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    };
    const handle = (x: number, y: number) => {
        if (!editable) return;
        const r = 6 / (view.zoom * dpr);
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
        ctx.setLineDash([dash, dashGap]);
    };

    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash([dash, dashGap]);

    for (const a of active) {
        // Dragging into the off-canvas delete zone fades the guide so the
        // user sees the "release here = delete" intent visually.
        ctx.globalAlpha = deleteZoneIds.has(a.id) ? 0.25 : 1;
        switch (a.kind) {
            case "V": {
                // Vertical mirror line at cell-edge x; +0.5 shifts cell-index to render coords.
                const x = a.x + 0.5;
                draw(x, -overhang, x, H + overhang);
                handle(x, H / 2);
                break;
            }
            case "H": {
                const y = a.y + 0.5;
                draw(-overhang, y, W + overhang, y);
                handle(W / 2, y);
                break;
            }
            case "D1": {
                // x − y = c (cell coords) ⇒ render x − y = c (cell+0.5 cancels).
                const c = a.c;
                const yMin = Math.max(0, -c);
                const yMax = Math.min(H, W - c);
                draw(yMin + c - ovhDiag, yMin - ovhDiag,
                     yMax + c + ovhDiag, yMax + ovhDiag);
                handle((yMin + yMax) / 2 + c, (yMin + yMax) / 2);
                break;
            }
            case "D2": {
                // x + y = c (cell coords) ⇒ render x + y = c + 1 (each cell shifts by +0.5).
                const s = a.c + 1;
                const yMin = Math.max(0, s - W);
                const yMax = Math.min(H, s);
                draw(s - yMin + ovhDiag, yMin - ovhDiag,
                     s - yMax - ovhDiag, yMax + ovhDiag);
                handle(s - (yMin + yMax) / 2, (yMin + yMax) / 2);
                break;
            }
            case "C": {
                ctx.setLineDash([]);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(a.x + 0.5, a.y + 0.5, 0.35, 0, Math.PI * 2);
                ctx.fill();
                ctx.setLineDash([dash, dashGap]);
                break;
            }
        }
    }
    ctx.restore();
}

export function updateCoordinates(x: number | null, y: number | null) {
    const coordinates = document.getElementById("status-coordinates")!;
    coordinates.textContent = x !== null && y !== null ? `${x}, ${y}` : "";
    coordinates.hidden = x === null || y === null;
}
