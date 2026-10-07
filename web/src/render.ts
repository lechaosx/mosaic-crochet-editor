import { PatternState, RowState, RoundState, MirrorCenter, SymKey } from "@mosaic/logic/types";
import { mirrorAxes } from "@mosaic/logic/symmetry";
import { mirrorTypePresentation } from "./mirror-presentation";
import { GridRecipe } from "@mosaic/logic/types";
import { evaluateGridRecipe } from "@mosaic/logic/grid-recipes";
import { applyEditSettings } from "@mosaic/logic/pattern";
import { PlanType, transformed_target_indices,
    build_highlight_plan_row, build_highlight_plan_round } from "@mosaic/wasm";
import { Store, visiblePixels } from "@mosaic/logic/store";
import { AppPreferences } from "./preferences";
import { planOutwardCoordinate, type PackedInstructionCoordinates } from "./instruction-coordinates";

const ZOOM_MIN     = 2;
const ZOOM_MAX     = 96;
const ROT_DURATION = 250;
const FAVICON_SIZE = 32;
const LABEL_FONT   = `ui-monospace, "SF Mono", Menlo, monospace`;
const PREVIEW_CELLS = 7;
// Marching-ants scroll speed in **screen pixels** per second. Converted to
// pattern units per frame using current zoom/dpr so the perceived speed is
// constant regardless of zoom level.
const ANTS_SCREEN_PX_PER_SEC = 24;
// Discrete dash-offset step in **screen pixels**. The continuous offset
// (advanced per frame) is snapped to multiples of this step before being
// applied, so dashes jump rather than glide — the classic marching-ants
// look. With 24 px/s + 3 px/step the visual ticks ~8 times per second.
const ANTS_STEP_PX = 3;

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

export interface CanvasWorkspace {
    left: number;
    top: number;
    right: number;
    bottom: number;
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

export interface InstructionSeam {
    start: { x: number; y: number; dx: number; dy: number };
    invalid: boolean;
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
    rafId: number | null;
    lastFrameTime: number;
    lastStore: Store | null;
    // Index 1/2 refreshed from store at the top of `render`. Index 0 is the
    // hole sentinel — render loops skip; `null` makes accidental reads fail loud.
    colors: (string | null)[];
    preferences: AppPreferences;
    projectColors: Pick<AppPreferences, "dangerColor" | "accentColor">;
    // A selection drag shows its resulting membership, not the old marquee.
    hideCommittedSelection: boolean;
    selectPreviewMask: Uint8Array | null;
    // The unclamped gesture footprint remains visible beside the exact
    // membership preview, including when the drag crosses the canvas edge.
    dragRect: { x1: number; y1: number; x2: number; y2: number } | null;
    // Marching-ants phase. Animated in `frame` while any float (committed
    // or drag preview) is on-screen; used as `lineDashOffset` for the outline.
    selectionDashOffset: number;
    selectedMirrorId: string | null;
    previewRepeatGuides: boolean;
    selectionHandlesVisible: boolean;
    faviconCanvas: HTMLCanvasElement;
    faviconCtx:    CanvasRenderingContext2D;
    instructionSeam: InstructionSeam | null;
    instructionGuidanceCoords: PackedInstructionCoordinates | null;
}

export function makeRendererState(preferences: AppPreferences): RendererState {
    const faviconCanvas = document.createElement("canvas");
    faviconCanvas.width  = FAVICON_SIZE;
    faviconCanvas.height = FAVICON_SIZE;
    return {
        visualRotation: 0,
        targetRotation: null,
        rotAnim:        null,
        rafId:          null,
        lastFrameTime:  0,
        lastStore:      null,
        colors:         [null, "#000000", "#ffffff"],
        preferences,
        projectColors: { dangerColor: preferences.dangerColor, accentColor: preferences.accentColor },
        hideCommittedSelection: false,
        selectPreviewMask:      null,
        dragRect:               null,
        selectionDashOffset:    0,
        selectedMirrorId:       null,
        previewRepeatGuides:    false,
        selectionHandlesVisible: false,
        faviconCanvas,
        faviconCtx:     faviconCanvas.getContext("2d")!,
        instructionSeam: null,
        instructionGuidanceCoords: null,
    };
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

// Handle hit-testing needs continuous coordinates rather than cell indices.
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
    workspace: CanvasWorkspace,
) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(0, workspace.right - workspace.left);
    const height = Math.max(0, workspace.bottom - workspace.top);
    if (width <= 0 || height <= 0) return;
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

    const includeWarning = (x: number, y: number) => include(x - W / 2, y - H / 2, 0.09, 0.37);
    if (pattern.mode === "row") {
        includeWarning(0.5, -0.5);
        includeWarning(W - 0.5, -0.5);
    } else {
        for (const y of [0.5, H - 0.5]) {
            includeWarning(-0.5, y);
            includeWarning(W + 0.5, y);
        }
        for (const x of [0.5, W - 0.5]) {
            includeWarning(x, -0.5);
            includeWarning(x, H + 0.5);
        }
    }

    if (pattern.mode === "row") {
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
    } else if (pattern.mode === "round" && pattern.offsetY !== 0) {
        const halfWidth = 0.34 * String(pattern.rounds).length;
        const includeRoundLabel = (x: number) => {
            include(x - W / 2, -H / 2 - 0.3, halfWidth, 0.28);
        };
        includeRoundLabel(0.5);
        includeRoundLabel(pattern.rounds - 0.5);
    }

    view.zoom = clampZoom(margin * Math.min(
        width / (2 * Math.max(Math.abs(minX), Math.abs(maxX))),
        height / (maxY - minY),
    ));
    view.panX = (workspace.left + workspace.right - rect.width) / 2;
    view.panY = (workspace.top + workspace.bottom - rect.height) / 2
        - view.zoom * (minY + maxY) / 2;
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

function reducedMotion(): boolean {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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

    const dtSec = Math.min(0.05, (now - rs.lastFrameTime) / 1000);

    // Marching ants: animate the dash offset while any ants outline is
    // visible. Convert screen-px/sec to pattern-units/sec so the visible
    // speed is constant across zoom levels. The modulo keeps the offset
    // bounded so floating-point precision holds over long sessions.
    const antsVisible = rs.dragRect !== null
        || (rs.lastStore && !rs.hideCommittedSelection && rs.lastStore.state.float !== null);
    if (antsVisible && !reducedMotion()) {
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

export function patternColourPreviewSample(mode: PatternState["mode"], subMode: "full" | "half" | "quarter") {
    const { pattern, pixels } = applyEditSettings(mode === "row"
        ? { mode, width: PREVIEW_CELLS, height: PREVIEW_CELLS, wipe: true }
        : { mode, innerWidth: 1, innerHeight: 1, rounds: 3, subMode, wipe: true });
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    if (pattern.mode === "row") {
        pixels[6 * W + 2] = pixels[6 * W + 2] === 1 ? 2 : 1;
        for (const y of [2, 3]) pixels[y * W + 5] = pixels[y * W + 5] === 1 ? 2 : 1;
    } else {
        for (const [x, y] of [[3, 4], [3, 5], [1, 4]]) {
            const index = (y - pattern.offsetY) * W + x - pattern.offsetX;
            pixels[index] = pixels[index] === 1 ? 2 : 1;
        }
    }
    const plan = pattern.mode === "row"
        ? build_highlight_plan_row(pixels, W, H)
        : build_highlight_plan_round(pixels, W, H, pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds);
    return { pattern, pixels, plan };
}

export function renderPatternColourPreview(
    canvas: HTMLCanvasElement, mode: PatternState["mode"],
    subMode: "full" | "half" | "quarter",
    colorA: string, colorB: string, dangerColor: string, accentColor: string,
    opacity: number, antsElapsedMs: number,
) {
    const { pattern, pixels, plan } = patternColourPreviewSample(mode, subMode);
    const W = pattern.canvasWidth, H = pattern.canvasHeight;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const padding = 8 * dpr;
    const cell = Math.min(width - 2 * padding, height - 2 * padding) / PREVIEW_CELLS;
    const panX = (width - W * cell) / 2;
    const panY = (height - H * cell) / 2;
    const view = { panX: panX / dpr, panY: panY / dpr, zoom: cell / dpr };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#161618";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const matrix = new DOMMatrix().translate(panX, panY).scale(cell);
    ctx.setTransform(matrix);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const p = pixels[y * W + x];
            if (p === 0) continue;
            ctx.fillStyle = p === 1 ? colorA : colorB;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    ctx.lineWidth = 1 / cell;
    ctx.strokeStyle = "rgba(128, 128, 128, 0.18)";
    ctx.beginPath();
    for (let x = 0; x <= W; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y++) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    renderHighlightSymbols(ctx, view, dpr,
        [null, colorA, colorB], dangerColor, pattern, pixels, plan, matrix, opacity, null, false);
    renderSymmetryGuides(ctx, view, dpr, pattern,
        [{ id: "preview", enabled: true, x: 2, y: 2, types: ["D1"] }], accentColor, null, true);
    const selection = new Uint8Array(W * H);
    for (let y = Math.max(0, H - 3); y < H; y++) {
        for (let x = 0; x < Math.min(3, W); x++) {
            if (pixels[y * W + x] !== 0) selection[y * W + x] = 1;
        }
    }
    const dashOffset = Math.floor(antsElapsedMs / 1000 * ANTS_SCREEN_PX_PER_SEC / ANTS_STEP_PX)
        * ANTS_STEP_PX / cell;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    renderSelection(ctx, view, dpr, pattern, selection, accentColor, dashOffset);
    ctx.restore();
}

// ── Top-level entry ────────────────────────────────────────────────────────
export function render(vp: Viewport, ctx: CanvasRenderingContext2D, rs: RendererState, store: Store) {
    rs.lastStore    = store;
    rs.colors[1]    = store.state.colorA;
    rs.colors[2]    = store.state.colorB;
    syncRotation(rs, store.state.rotation, vp, ctx);
    // Kick off the rAF loop whenever any marching-ants outline is on-screen
    // (committed selection that isn't hidden, or an in-flight drag rect).
    // `frame()` advances the dash offset each tick and stops on its own.
    const antsVisible = rs.dragRect !== null
        || (!rs.hideCommittedSelection && store.state.float !== null);
    if (antsVisible && !reducedMotion()) startRaf(rs, vp, ctx);
    updateFavicon(rs.faviconCanvas, rs.faviconCtx, rs.colors, store.state.pattern, store.state.pixels);
    rerender(vp, ctx, rs, store);
}

function rerender(vp: Viewport, ctx: CanvasRenderingContext2D, rs: RendererState, store: Store) {
    const { pattern, pixels, float, mirrors, recipes, activeRecipeId } = store.state;
    const { guidanceOpacity, labelsVisible } = rs.preferences;
    const { dangerColor, accentColor } = rs.projectColors;
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const { canvas, view, dpr } = vp;

    // `visiblePixels` = canvas pixels with the float stamped at offset
    // (off-canvas / hole destinations dropped — same rules the commit applies).
    // Used as the pixel source for both the cell render pass and the
    // highlight-symbol pass. `store.plan` is already computed from this
    // buffer (see `computePlan` in store.ts), so ✕ / ! markers track the
    // float live without a per-frame WASM rebuild.
    const committedPixels = visiblePixels(store.state);

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
            const p = committedPixels[row + x];
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

    renderHighlightSymbols(ctx, view, dpr, rs.colors, dangerColor, pattern, committedPixels, store.plan, m,
        guidanceOpacity / 100, rs.instructionGuidanceCoords);
    renderInstructionSeam(ctx, view, rs.instructionSeam, accentColor, dangerColor, m);
    const stepInPat = ANTS_STEP_PX / (view.zoom * dpr);
    const dashOffsetSnapped = Math.floor(rs.selectionDashOffset / stepInPat) * stepInPat;
    const activeRecipe = activeRecipeId === null ? null : recipes.find(recipe => recipe.id === activeRecipeId) ?? null;
    if (activeRecipe && float
        && float.x === activeRecipe.source.x && float.y === activeRecipe.source.y
        && float.w === activeRecipe.source.w && float.h === activeRecipe.source.h) {
        renderRecipeInstances(ctx, view, dpr, pattern, pixels, activeRecipe, accentColor, dashOffsetSnapped);
        if (rs.selectionHandlesVisible) renderRecipeHandles(ctx, view, activeRecipe, accentColor, rs.visualRotation);
    }
    renderSymmetryGuides(ctx, view, dpr, pattern, mirrors, accentColor, rs.selectedMirrorId, rs.previewRepeatGuides);
    // During a drag, the preview wins even when empty (drag started outside
    // canvas in replace mode → old float outline visually disappears immediately).
    // Snap the dash offset to discrete screen-pixel steps so dashes visibly
    // tick rather than glide.
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
        renderSelection(ctx, view, dpr, pattern, shifted, accentColor, dashOffsetSnapped);
    }
    if (rs.selectPreviewMask) {
        renderSelection(ctx, view, dpr, pattern, rs.selectPreviewMask, accentColor, dashOffsetSnapped);
    }
    if (rs.dragRect) {
        ctx.save();
        ctx.globalAlpha = rs.selectPreviewMask ? 0.45 : 1;
        renderDragRect(ctx, view, dpr, rs.dragRect, accentColor, dashOffsetSnapped);
        ctx.restore();
    }
    if (labelsVisible) {
        if (pattern.mode === "row") renderRowLabels(ctx, view, dpr, pattern, m);
        else                         renderRoundLabels(ctx, view, dpr, pattern, pixels, m);
    }
}

function renderRecipeInstances(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number, pattern: PatternState,
    pixels: Uint8Array, recipe: GridRecipe, color: string, dashOffset: number,
) {
    const paths = recipeInstancePaths(pattern, pixels, recipe);
    ctx.save();
    for (const instance of paths) renderSelectionPaths(ctx, view, dpr, instance, color, dashOffset);
    ctx.restore();
    (window as unknown as { __test_repeat_outlines__?: { paths: number[][][]; dashOffset: number } })
        .__test_repeat_outlines__ = { paths, dashOffset };
}

export interface SelectionTransformHandle {
    kind: "column" | "row" | "centre";
    x: number; y: number;
    offsetX: number; offsetY: number;
}

export function selectionTransformHandles(recipe: GridRecipe, zoom: number, rotation: number): SelectionTransformHandle[] {
    if (recipe.source.mask.length === 0 || recipe.mode === "none") return [];
    if (recipe.mode === "circle" || recipe.mode === "mirror") return [{ kind: "centre",
        x: (recipe.mode === "circle" ? recipe.rotationCentreX : recipe.mirrorCentreX) + 0.5,
        y: (recipe.mode === "circle" ? recipe.rotationCentreY : recipe.mirrorCentreY) + 0.5,
        offsetX: 0, offsetY: 0 }];
    const evaluated = evaluateGridRecipe(recipe);
    const handles: SelectionTransformHandle[] = [
        { kind: "column", x: recipe.source.x + evaluated.columnStep.x, y: recipe.source.y + evaluated.columnStep.y, offsetX: 0, offsetY: 0 },
        { kind: "row", x: recipe.source.x + evaluated.rowStep.x, y: recipe.source.y + evaluated.rowStep.y, offsetX: 0, offsetY: 0 },
    ];
    if (Math.hypot(handles[0].x - handles[1].x, handles[0].y - handles[1].y) * zoom < 48) {
        const angle = rotation * Math.PI / 180;
        handles.forEach((handle, index) => {
            const offset = (index === 0 ? -24 : 24) / zoom;
            handle.offsetX = Math.cos(angle) * offset; handle.offsetY = -Math.sin(angle) * offset;
            handle.x += handle.offsetX; handle.y += handle.offsetY;
        });
    }
    return handles;
}

function renderRecipeHandles(ctx: CanvasRenderingContext2D, view: ViewState, recipe: GridRecipe, color: string, rotation: number) {
    const px = 1 / view.zoom;
    const handles = selectionTransformHandles(recipe, view.zoom, rotation);
    const evaluated = recipe.mode === "grid" ? evaluateGridRecipe(recipe) : null;
    ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 2 * px;
    if (evaluated) {
        ctx.strokeStyle = color;
        for (const step of [evaluated.columnStep, evaluated.rowStep, evaluated.columnStepAlternate, evaluated.rowStepAlternate]) {
            ctx.beginPath(); ctx.moveTo(recipe.source.x, recipe.source.y);
            ctx.lineTo(recipe.source.x + step.x, recipe.source.y + step.y); ctx.stroke();
        }
    }
    for (const handle of handles) {
        ctx.beginPath(); ctx.moveTo(handle.x - handle.offsetX, handle.y - handle.offsetY); ctx.lineTo(handle.x, handle.y);
        ctx.strokeStyle = color; ctx.stroke();
        ctx.save(); ctx.translate(handle.x, handle.y); ctx.rotate(-rotation * Math.PI / 180);
        ctx.beginPath();
        ctx.arc(0, 0, 11 * px, 0, Math.PI * 2);
        ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = color; ctx.stroke();
        ctx.beginPath();
        if (handle.kind === "centre") {
            ctx.moveTo(-5 * px, 0); ctx.lineTo(5 * px, 0); ctx.moveTo(0, -5 * px); ctx.lineTo(0, 5 * px);
        } else {
            const step = handle.kind === "column" ? evaluated!.columnStep : evaluated!.rowStep;
            ctx.rotate(Math.atan2(step.y, step.x) + rotation * Math.PI / 180);
            ctx.moveTo(-6 * px, 0); ctx.lineTo(6 * px, 0);
            ctx.moveTo(-3 * px, -3 * px); ctx.lineTo(-6 * px, 0); ctx.lineTo(-3 * px, 3 * px);
            ctx.moveTo(3 * px, -3 * px); ctx.lineTo(6 * px, 0); ctx.lineTo(3 * px, 3 * px);
        }
        ctx.stroke();
        ctx.restore();
    }
    ctx.restore();
}

export function recipeInstancePaths(
    pattern: PatternState, pixels: Uint8Array, recipe: GridRecipe,
): number[][][] {
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const sourceCells = new Set<string>();
    for (let y = 0; y < recipe.source.h; y++) {
        for (let x = 0; x < recipe.source.w; x++) {
            if (recipe.source.mask[y * recipe.source.w + x] !== 0) {
                sourceCells.add(`${recipe.source.x + x},${recipe.source.y + y}`);
            }
        }
    }
    return evaluateGridRecipe(recipe).instances.flatMap(instance => {
        const cells = new Set<string>();
        for (const cell of instance) {
            if (cell.x < 0 || cell.x >= W || cell.y < 0 || cell.y >= H) continue;
            if (pixels[cell.y * W + cell.x] === 0) continue;
            if (sourceCells.has(`${cell.x},${cell.y}`)) continue;
            cells.add(`${cell.x},${cell.y}`);
        }
        const paths = tracedSparseBoundary(cells);
        return paths.length > 0 ? [paths] : [];
    });
}

function tracedSparseBoundary(selection: ReadonlySet<string>): number[][] {
    type Edge = [number, number, number, number] & { used?: boolean };
    const edges: Edge[] = [];
    const edgeFrom = new Map<string, Edge[]>();
    const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
        const edge: Edge = [x1, y1, x2, y2];
        edges.push(edge);
        const key = `${x1},${y1}`;
        const outgoing = edgeFrom.get(key);
        if (outgoing) outgoing.push(edge);
        else edgeFrom.set(key, [edge]);
    };
    for (const key of selection) {
        const [x, y] = key.split(",").map(Number);
        if (!selection.has(`${x},${y - 1}`)) addEdge(x, y, x + 1, y);
        if (!selection.has(`${x + 1},${y}`)) addEdge(x + 1, y, x + 1, y + 1);
        if (!selection.has(`${x},${y + 1}`)) addEdge(x + 1, y + 1, x, y + 1);
        if (!selection.has(`${x - 1},${y}`)) addEdge(x, y + 1, x, y);
    }
    const paths: number[][] = [];
    const direction = (edge: Edge) => {
        const dx = edge[2] - edge[0], dy = edge[3] - edge[1];
        if (dx === 1) return 0;
        if (dy === 1) return 1;
        if (dx === -1) return 2;
        return 3;
    };
    for (const start of edges) {
        if (start.used) continue;
        const startKey = `${start[0]},${start[1]}`;
        const path: number[] = [];
        let edge: Edge | undefined = start;
        while (edge && !edge.used) {
            edge.used = true;
            if (path.length === 0) path.push(edge[0], edge[1]);
            path.push(edge[2], edge[3]);
            const key: string = `${edge[2]},${edge[3]}`;
            if (key === startKey) break;
            const previousDirection = direction(edge);
            edge = edgeFrom.get(key)
                ?.filter(candidate => !candidate.used)
                .sort((a, b) =>
                    (direction(a) - previousDirection + 4) % 4
                    - (direction(b) - previousDirection + 4) % 4)[0];
        }
        if (path.length >= 4) paths.push(path);
    }
    return paths;
}

function renderInstructionSeam(
    ctx: CanvasRenderingContext2D, view: ViewState,
    seam: InstructionSeam | null, accentColor: string, dangerColor: string, m: DOMMatrix,
) {
    if (!seam) {
        (window as unknown as { __test_instruction_seam_geometry__?: unknown })
            .__test_instruction_seam_geometry__ = null;
        return;
    }
    const { start } = seam;
    const sx = start.x + 0.5 - start.dx * 0.5;
    const sy = start.y + 0.5 - start.dy * 0.5;
    const edges = [start.dx !== 0
        ? [sx, sy - 0.5, sx, sy + 0.5]
        : [sx - 0.5, sy, sx + 0.5, sy]];
    const depth = 0.32;
    const halfBase = 0.22;
    const halfBar = 0.025;
    const point = (normal: number, tangent: number) => [
        sx + start.dx * normal - start.dy * tangent,
        sy + start.dy * normal + start.dx * tangent,
    ];
    const triangle = [point(0, halfBase), point(0, -halfBase), point(depth, 0)];
    const join = halfBase * (1 - halfBar / depth);
    const outline = [
        point(-halfBar, -0.5), point(halfBar, -0.5), point(halfBar, -join),
        point(depth, 0), point(halfBar, join), point(halfBar, 0.5), point(-halfBar, 0.5),
    ];
    const screenTriangle = triangle.map(([x, y]) => {
        const point = m.transformPoint({ x, y });
        return [point.x, point.y];
    });
    (window as unknown as { __test_instruction_seam_geometry__?: unknown })
        .__test_instruction_seam_geometry__ = { edges, triangle, screenTriangle, outline };
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = seam.invalid ? dangerColor : accentColor;
    ctx.fill();
    ctx.lineWidth = 1 / view.zoom;
    ctx.strokeStyle = "#161618";
    ctx.stroke();
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
    renderSelectionPaths(ctx, view, dpr, tracedBoundary(selection, W, H), color, dashOffset);
}

function renderSelectionPaths(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    paths: ReadonlyArray<ReadonlyArray<number>>, color: string, dashOffset: number,
) {
    const px = 1 / (view.zoom * dpr);
    const dash = 6 * px;

    ctx.save();
    ctx.lineWidth = 3 * px;
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = dashOffset;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const path of paths) {
        ctx.moveTo(path[0], path[1]);
        for (let i = 2; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
    }
    ctx.stroke();
    ctx.restore();
}

// The sweep includes off-canvas cells; the committed source clips them out.
function renderDragRect(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    r: { x1: number; y1: number; x2: number; y2: number },
    color: string, dashOffset: number,
) {
    const x1 = Math.min(r.x1, r.x2), y1 = Math.min(r.y1, r.y2);
    const x2 = Math.max(r.x1, r.x2) + 1, y2 = Math.max(r.y1, r.y2) + 1;
    renderSelectionPaths(ctx, view, dpr, [[x1, y1, x2, y1, x2, y2, x1, y2, x1, y1]], color, dashOffset);
}

// ── Drawing helpers ────────────────────────────────────────────────────────
// ✕ for VALID overlay — pattern coords, auto-contrast (opposite of the cell
//   colour the glyph lands on, so the glyph is readable against either
//   palette).
// ! for INVALID — screen coords (always points down regardless of canvas
//   rotation, like axis labels). Drawn in the configured danger colour.
// Both ✕ and ! are dimmable via the user's opacity slider. Round-mode corners
// produce two plan records sharing the wrong cell with perpendicular
// directions; each draws independently.
function renderHighlightSymbols(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    colors: (string | null)[], dangerColor: string,
    pattern: PatternState, pixels: Uint8Array, plan: Int16Array,
    m: DOMMatrix, opacity: number, guidanceCoords: PackedInstructionCoordinates | null,
    recordTestHook = true,
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
    const validGlyphCoords: { x: number; y: number }[] = [];
    for (const { display, glyph } of groups) {
        ctx.strokeStyle = glyph;
        ctx.beginPath();
        for (let i = 0; i < plan.length; i += 4) {
            if (plan[i] !== PlanType.Valid) continue;
            const wx = plan[i+2], wy = plan[i+3];
            const [ox, oy] = planOutwardCoordinate(plan, i);
            if (guidanceCoords && !guidanceCoords.has(ox, oy)) continue;
            if (outwardPixel(ox, oy, wx, wy) !== display) continue;
            validGlyphCoords.push({ x: ox, y: oy });
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

    const invalidGlyphs: { x: number; y: number; point: DOMPoint }[] = [];
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] !== PlanType.Invalid) continue;
        const [ox, oy] = planOutwardCoordinate(plan, i);
        if (guidanceCoords && !guidanceCoords.has(ox, oy)) continue;
        invalidGlyphs.push({ x: ox, y: oy, point: m.transformPoint({ x: ox + 0.5, y: oy + 0.5 }) });
    }

    ctx.strokeStyle = dangerColor;
    ctx.lineWidth   = cellPx * 0.16;
    ctx.beginPath();
    for (const { point } of invalidGlyphs) {
        ctx.moveTo(point.x, point.y - stemTop);
        ctx.lineTo(point.x, point.y + stemBot);
    }
    ctx.stroke();

    ctx.fillStyle = dangerColor;
    ctx.beginPath();
    for (const { point } of invalidGlyphs) {
        ctx.moveTo(point.x + dotR, point.y + dotY);
        ctx.arc(point.x, point.y + dotY, dotR, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();

    if (recordTestHook) (window as unknown as { __test_instruction_guidance__?: {
        filtered: boolean;
        validGlyphCoords: { x: number; y: number }[];
        invalidGlyphCoords: { x: number; y: number }[];
    } }).__test_instruction_guidance__ = {
        filtered: guidanceCoords !== null,
        validGlyphCoords,
        invalidGlyphCoords: invalidGlyphs.map(({ x, y }) => ({ x, y })),
    };

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
    const geometry: {
        anchor: { x: number; y: number };
        bounds: { left: number; top: number; right: number; bottom: number };
    }[] = [];
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
        const width = ctx.measureText(label).width;
        const halfHeight = cell * (isFull ? 0.33 : 0.3);
        geometry.push({
            anchor: { x: p.x, y: p.y },
            bounds: {
                left: p.x - width / 2,
                top: p.y - halfHeight,
                right: p.x + width / 2,
                bottom: p.y + halfHeight,
            },
        });
        if (isFull) ctx.strokeText(label, p.x, p.y);
        ctx.fillText(label, p.x, p.y);
    }
    ctx.restore();
    (window as unknown as { __test_instruction_label_geometry__?: typeof geometry })
        .__test_instruction_label_geometry__ = geometry;
}

function renderSymmetryGuides(
    ctx: CanvasRenderingContext2D, view: ViewState, dpr: number,
    pattern: PatternState, mirrors: ReadonlyArray<MirrorCenter>,
    color: string, selectedId: string | null, editable: boolean,
) {
    const guides = mirrors.filter(mirror => mirror.enabled).flatMap(mirror =>
        mirrorTypePresentation(mirror.types).filter(type => type.chosen || type.implied).map(type => ({
            axis: mirrorAxes({ ...mirror, types: [type.key] })[0], implied: type.implied,
        })));
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
        const r = 8 / view.zoom;
        ctx.setLineDash([]);
        ctx.fillStyle = "#fff"; ctx.strokeStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - r / 2, y); ctx.lineTo(x + r / 2, y);
        ctx.moveTo(x, y - r / 2); ctx.lineTo(x, y + r / 2); ctx.stroke();
        ctx.setLineDash([dash, dashGap]);
    };

    ctx.save();
    ctx.lineWidth = lw;
    ctx.setLineDash([dash, dashGap]);

    for (const { axis: a } of guides) {
        ctx.globalAlpha = 1;
        ctx.setLineDash([dash, dashGap]);
        switch (a.kind) {
            case "V": {
                // Vertical mirror line at cell-edge x; +0.5 shifts cell-index to render coords.
                const x = a.x + 0.5;
                draw(x, -overhang, x, H + overhang);
                break;
            }
            case "H": {
                const y = a.y + 0.5;
                draw(-overhang, y, W + overhang, y);
                break;
            }
            case "D1": {
                // x − y = c (cell coords) ⇒ render x − y = c (cell+0.5 cancels).
                const c = a.c;
                const yMin = Math.max(0, -c);
                const yMax = Math.min(H, W - c);
                draw(yMin + c - ovhDiag, yMin - ovhDiag,
                     yMax + c + ovhDiag, yMax + ovhDiag);
                break;
            }
            case "D2": {
                // x + y = c (cell coords) ⇒ render x + y = c + 1 (each cell shifts by +0.5).
                const s = a.c + 1;
                const yMin = Math.max(0, s - W);
                const yMax = Math.min(H, s);
                draw(s - yMin + ovhDiag, yMin - ovhDiag,
                     s - yMax - ovhDiag, yMax + ovhDiag);
                break;
            }
            case "C": {
                ctx.setLineDash([]);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(a.x + 0.5, a.y + 0.5, 6 / view.zoom, 0, Math.PI * 2);
                ctx.fill();
                ctx.setLineDash([dash, dashGap]);
                break;
            }
        }
    }
    if (editable) for (const mirror of mirrors) {
        ctx.globalAlpha = mirror.enabled ? 1 : 0.55;
        handle(mirror.x + 0.5, mirror.y + 0.5);
        if (mirror.id === selectedId) {
            ctx.setLineDash([]);
            const r = 10 / view.zoom;
            ctx.beginPath();
            ctx.arc(mirror.x + 0.5, mirror.y + 0.5, r, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.stroke();
        }
    }
    ctx.restore();
}

export function updateCoordinates(x: number | null, y: number | null) {
    const coordinates = document.getElementById("status-coordinates")!;
    coordinates.textContent = x !== null && y !== null ? `${x}, ${y}` : "";
    coordinates.hidden = x === null || y === null;
}
