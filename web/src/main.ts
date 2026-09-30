import { PlanType, lock_invalid_row, lock_invalid_round, transformed_target_indices,
         overlay_target_available_row, overlay_target_available_round,
         overlay_inward_cell_row, overlay_inward_cell_round,
         initialize_row_pattern,
         instruction_start_row, instruction_start_round,
         instruction_wip_row, instruction_wip_round,
         InstructionUnitKind, InstructionYarn } from "@mosaic/wasm";
import { Tool, PatternState, SymKey, Float, Axis, GridRecipe } from "@mosaic/logic/types";
import { makeViewport, makeRendererState, observeCanvasResize,
         render, fitToView, zoomAt, screenToPattern, screenToPatternFrac, updateCoordinates } from "./render";
import { applyEditSettings, readEditSettings } from "./pattern";
import { Store, SessionState, visiblePixels, outOfBounds } from "@mosaic/logic/store";
import { historySave, historyReplaceCurrent, historyReset, historyEnsureInitialized,
         historyUndo, historyRedo, canUndo, canRedo, Restored } from "./history";
import { addAxis, removeAxis, toggleAxisActive,
         pickAxesAt, setAxisPosition, snapHalf, snapInt,
         axisOffCanvas, axisIsProjectValid } from "@mosaic/logic/symmetry";
import { axesToFlat } from "@mosaic/logic/symmetry";
import { emptyGridRecipe, evaluateGridRecipe, gridRecipeError, gridRecipesEqual } from "@mosaic/logic/grid-recipes";
import { saveToLocalStorage, loadFromLocalStorage, saveToFile, loadFromFile, LoadedFile } from "./storage-io";
import { mountUI, UIHandle, SelectionMoveMode, SelectionMode, InstructionOverviewUnit } from "./ui";
import { InstructionCache, CachedInstructionUnit, cachedInstructionUnit, shouldYieldInstructionGeneration, InstructionUnitSignature } from "./instruction-cache";
import { packInstructionCoordinates } from "./instruction-coordinates";
import { mountGestures } from "./gesture";
import { SelectMode, liftCells, shiftedFloatMask, anchorIntoCanvas,
         previewSelectRectMask,
         commitSelectRect, commitWandAt, selectAll, deselect, anchorFloat,
         deleteFloat, clipFloatToCanvas, replicateSelection, createGridRecipe,
         activateGridRecipe, deleteGridRecipe, activeGridRecipe, applyGridRecipe,
         syncActiveGridRecipe } from "@mosaic/logic/selection";
import { copyFloat, cutFloat, pasteClipboard, clipboardCellCount } from "@mosaic/logic/clipboard";
import { OverlayAction, PaintTool, paintOps } from "@mosaic/logic/paint";
import { MAX_CANVAS_DIMENSION, patternChangeSummary } from "@mosaic/logic/pattern";
import { fingerprintPattern, fingerprintPatternShape, loadLiveProgress, saveLiveProgress,
         clearLiveProgress, hasLiveProgress } from "./live-progress";
import { copyrightNotice, markAboutSeen, shouldShowAbout } from "./about";
import { contrastingProjectColors } from "./contrast-colors";
import {
    AppPreferences,
    DEFAULT_APP_PREFERENCES,
    loadAppPreferences,
    saveAppPreferences,
} from "./preferences";

const DEFAULT_YARN_A = "#000000";
const DEFAULT_YARN_B = "#ffffff";

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function sameAuthoredPattern(pattern: PatternState, pixels: Uint8Array): boolean {
    const current = store.state.pattern;
    if (current.mode !== pattern.mode
        || current.canvasWidth !== pattern.canvasWidth
        || current.canvasHeight !== pattern.canvasHeight) return false;
    if (current.mode === "round" && pattern.mode === "round"
        && (current.virtualWidth !== pattern.virtualWidth
            || current.virtualHeight !== pattern.virtualHeight
            || current.offsetX !== pattern.offsetX
            || current.offsetY !== pattern.offsetY
            || current.rounds !== pattern.rounds)) return false;
    return arraysEqual(visiblePixels(store.state), pixels);
}

function axesEqual(a: ReadonlyArray<Axis>, b: ReadonlyArray<Axis>): boolean {
    return a.length === b.length && a.every((axis, index) => {
        const other = b[index];
        if (axis.id !== other.id || axis.kind !== other.kind || axis.active !== other.active) return false;
        if (axis.kind === "V" && other.kind === "V") return axis.x === other.x;
        if (axis.kind === "H" && other.kind === "H") return axis.y === other.y;
        if (axis.kind === "C" && other.kind === "C") return axis.x === other.x && axis.y === other.y;
        if (axis.kind === "D1" && other.kind === "D1") return axis.c === other.c;
        if (axis.kind === "D2" && other.kind === "D2") return axis.c === other.c;
        return false;
    });
}

function sameProject(loaded: LoadedFile): boolean {
    return sameAuthoredPattern(loaded.pattern, loaded.pixels)
        && loaded.colorA === store.state.colorA
        && loaded.colorB === store.state.colorB
        && (loaded.dangerColorOverride ?? null) === store.state.dangerColorOverride
        && (loaded.accentColorOverride ?? null) === store.state.accentColorOverride
        && axesEqual(loaded.axes, store.state.axes)
        && gridRecipesEqual(loaded.recipes, store.state.recipes);
}

// Minimal sensible defaults — only used when no saved session exists.
function defaultSession(): SessionState {
    const recipe = emptyGridRecipe();
    return {
        pattern:       { mode: "row", canvasWidth: 9, canvasHeight: 9 },
        pixels:        new Uint8Array(81),
        colorA:        "#000000",
        colorB:        "#ffffff",
        dangerColorOverride: null,
        accentColorOverride: null,
        activeTool:    "pencil",
        primaryColor:  1,
        axes:           [],
        recipes:        [recipe],
        activeRecipeId: recipe.id,
        liveMirrors:    true,
        float:           null,
        rotation:        0,
    };
}

function exampleSession(): SessionState {
    const pattern: PatternState = { mode: "row", canvasWidth: 9, canvasHeight: 9 };
    const axes = addAxis([], "V", pattern.canvasWidth, pattern.canvasHeight);
    let pixels: Uint8Array = initialize_row_pattern(pattern.canvasWidth, pattern.canvasHeight).slice();
    for (const x of [1, 4, 7]) {
        const index = pattern.canvasWidth + x;
        pixels[index] = pixels[index] === 1 ? 2 : 1;
    }
    for (const x of [2, 4, 6]) {
        pixels = paintOps.overlay({
            visible: pixels, pattern, x, y: 2,
            color: 1, primary: 1, invertVisited: null,
            overlayAction: "place",
            transforms: new Float64Array(0), shifted: null,
        });
    }
    return {
        ...defaultSession(),
        pattern,
        pixels,
        colorA: "#264653",
        colorB: "#f4a261",
        dangerColorOverride: null,
        accentColorOverride: null,
        axes,
    };
}

// ── Boot ─────────────────────────────────────────────────────────────────────
const viewport = makeViewport(document.getElementById("canvas") as HTMLCanvasElement);
function editableAxisTolerance(): number {
    return Math.max(AXIS_HIT_TOLERANCE, Math.min(1.2, 22 / viewport.view.zoom));
}
const ctx      = viewport.canvas.getContext("2d", { alpha: false })!;
const saved    = loadFromLocalStorage();
let preferences: AppPreferences = loadAppPreferences();
const rs       = makeRendererState(preferences);
const store    = new Store(saved ?? defaultSession());
const aboutDialog = document.getElementById("about-dialog") as HTMLDialogElement;
const aboutReleaseNotes = document.getElementById("about-release-notes") as HTMLElement;
const currentReleaseHash = aboutReleaseNotes.dataset.currentHash!;
(document.getElementById("about-updated") as HTMLElement).textContent =
    aboutReleaseNotes.querySelector("h3")!.textContent;
(document.getElementById("about-copyright") as HTMLElement).textContent =
    copyrightNotice(new Date().getFullYear());

function showAbout() {
    if (!aboutDialog.open) aboutDialog.showModal();
}

function closeAbout() {
    if (!aboutDialog.open) return;
    markAboutSeen(currentReleaseHash);
    aboutDialog.close();
}

aboutDialog.addEventListener("close", () => markAboutSeen(currentReleaseHash));
aboutDialog.addEventListener("click", event => {
    if (event.target === aboutDialog) closeAbout();
});
document.getElementById("about-close")!.addEventListener("click", closeAbout);
let instructionsPreviewStore: Store | null = null;
let instructionsView: ReturnType<UIHandle["openInstructions"]> | null = null;
let instructionsOpen = false;
let instructionCache: InstructionCache | null = null;
let overlayAction: OverlayAction = "place";
let selectionMoveMode: SelectionMoveMode = "move";
let selectionMode: SelectionMode = "replace";
let navigateLatched = false;
let navigateMomentary = false;

// Move-tool drag mode, chosen at paintdown from the UI mode and modifiers:
//   "move"      → no modifier; drag repositions the float, release records.
//   "duplicate" → Ctrl; pre-stamps the float into canvas at paintdown so the
//                 duplicate is visible during drag, release records the new pos.
//   "mask-only" → latched UI mode or Alt (dominates Ctrl); stamps at paintdown,
//                 drag carries the marquee shape (pixels mirror canvas at the
//                 new position), release re-lifts the canvas content there.
type MoveMode = SelectionMoveMode;

// One discriminated-union active per gesture, set at `onPaintStart`,
// updated on `onPaintAt`, consumed (committed or reverted) on
// `onPaintEnd` / `onPaintCancel`, then cleared.
//   paint  — pencil / fill / eraser / overlay / invert. `prePixels` /
//            `preFloat` snapshot pre-stroke state for cancel revert and
//            history dedupe; `invertVisited` only non-null for invert.
//   select — rect drag. `rect` stays null until the first paintAt so
//            single-click vs drag is detected consistently.
//   wand   — wand drag. `lastCell` dedupes when the cursor lingers in
//            one cell across moves.
//   move   — Move-tool drag. `drag` is null until the first paintAt
//            resolves the click cell. `prePixels` is only set when
//            paintdown mutated `s.pixels` (duplicate's pre-stamp,
//            mask-only's stamp) so cancel can revert.
type Gesture =
    | { kind: "paint";
        guidePickPending: boolean;
        color: 1 | 2;
        prePixels: Uint8Array;
        preFloat: Float | null;
        invertVisited: Set<number> | null;
      }
    | { kind: "select";
        guidePickPending: boolean;
        mode: SelectMode;
        rect: { startX: number; startY: number; endX: number; endY: number } | null;
      }
    | { kind: "wand";
        guidePickPending: boolean;
        mode: SelectMode;
        lastCell: { x: number; y: number } | null;
        prePixels: Uint8Array;
        preFloat: Float | null;
        preRecipes: GridRecipe[];
        preActiveRecipeId: string | null;
      }
    | { kind: "move";
        guidePickPending: boolean;
        mode: MoveMode;
        drag: { anchorX: number; anchorY: number; startDx: number; startDy: number } | null;
        prePixels: Uint8Array | null;
        preFloat: Float | null;
        preRecipes: GridRecipe[];
        preActiveRecipeId: string | null;
      }
    | { kind: "axis-drag";
        // One pick per kind: clicking an intersection grabs one of each
        // kind so dragging moves them together. Parallel overlapping axes
        // of the same kind are disambiguated by closeness (only the
        // nearest is picked), so the user can drag it away to separate.
        picks: { id: string; kind: SymKey }[];
        // Snapshot the axes list so cancel can revert without recomputing.
        preAxes: Axis[];
      }
    ;
// Click within this many cell-units of an active axis guide starts an
// axis-drag instead of float-move. ~0.4 keeps the affordance close to the
// 1-cell-wide visual line without being so wide that float-move suffers.
const AXIS_HIT_TOLERANCE = 0.4;

let gesture: Gesture | null = null;
let gestureFeedbackShown = false;
let ctrlArrowStamped = false;                        // bake happens once per Ctrl-down
let maskArrowState: { preFloat: Float } | null = null; // non-null while Alt+Arrow is active

function modeToCode(m: SelectMode): number {
    return m === "replace" ? 0 : m === "add" ? 1 : 2;
}

function showGestureFeedback(message: string) {
    if (gestureFeedbackShown) return;
    gestureFeedbackShown = true;
    ui.setCanvasFeedback(message);
}

function overlayTargetAvailable(pattern: PatternState, x: number, y: number): boolean {
    return pattern.mode === "row"
        ? overlay_target_available_row(pattern.canvasWidth, pattern.canvasHeight, x, y)
        : overlay_target_available_round(
            pattern.canvasWidth, pattern.canvasHeight,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, pattern.rounds,
            x, y,
        );
}

function syncSelectPreview() {
    const g = gesture?.kind === "select" ? gesture : null;
    if (!g || !g.rect) {
        rs.hideCommittedSelection = false;
        rs.dragRect               = null;
        rs.selectPreviewMask      = null;
        return;
    }
    rs.hideCommittedSelection = true;
    rs.dragRect = {
        x1: g.rect.startX, y1: g.rect.startY,
        x2: g.rect.endX,   y2: g.rect.endY,
    };
    rs.selectPreviewMask = previewSelectRectMask(
        store.state,
        g.rect.startX, g.rect.startY, g.rect.endX, g.rect.endY,
        g.mode,
    );
}

function renderCanvas() {
    render(viewport, ctx, rs, instructionsPreviewStore ?? store);
}

function crochetErrorCount() {
    const errors = new Set<string>();
    for (let i = 0; i < store.plan.length; i += 4) {
        if (store.plan[i] === PlanType.Invalid) errors.add(`${store.plan[i + 2]},${store.plan[i + 3]}`);
    }
    return errors.size;
}

observeCanvasResize(viewport.canvas, v => { viewport.dpr = v; }, renderCanvas);

// Renderer + side-effect channels (Store invokes them on every `commit`).
store.setRenderer(s => {
    if (instructionsPreviewStore) {
        instructionsPreviewStore.commit(
            preview => {
                preview.rotation = s.state.rotation;
                preview.colorA = s.state.colorA;
                preview.colorB = s.state.colorB;
                preview.dangerColorOverride = s.state.dangerColorOverride;
                preview.accentColorOverride = s.state.accentColorOverride;
            },
            { recompute: false, render: false, persist: false },
        );
        instructionsView?.setYarnColors(s.state.colorA, s.state.colorB);
    }
    renderCanvas();
});
let patternHistorySession = false;
let savingPatternHistory = false;
let applyingPatternPreview = false;
store.setHistoryFn(s => {
    if (!savingPatternHistory) patternHistorySession = false;
    historySave(s);
});
store.setPersistFn(s => {
    ui.setRecoveryStatus(saveToLocalStorage(s) ? "saved" : "failed");
});

// Observers — run after every commit.
store.addObserver(() => ui.setHistory(canUndo(), canRedo()));
store.addObserver(s => ui.setViewState(
    s.state.rotation, instructionsOpen || navigateLatched || navigateMomentary,
));
store.addObserver(() => updateCoordinates(null, null));
store.addObserver(() => ui.setCrochetErrors(crochetErrorCount()));
store.addObserver(s => syncProjectColorInputs(s.state));
store.addObserver(s => {
    if (editSessionSource && !applyingPatternPreview) {
        const current = patternEditSnapshot(s.state);
        if (!editSessionPreview || !samePatternEditSnapshot(current, editSessionPreview)) {
            editSessionSource = current;
            editSessionPreview = current;
        }
    }
});
store.addObserver(s => {
    if (!s.state.float && selectionMode === "remove") selectionMode = "replace";
    ui.setRecipes(s.state.recipes, s.state.activeRecipeId);
    ui.setTransformState(Boolean(s.state.float), hasConfiguredTransforms());
    ui.setTransformError(null);
    ui.setSelectionMode(s.state.activeTool, selectionMode, Boolean(s.state.float));
    ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
});

function selectionCellCount(): number {
    return store.state.float?.pixels.reduce((count, pixel) => count + Number(pixel !== 0), 0) ?? 0;
}

// ── Paint ────────────────────────────────────────────────────────────────────
// `g.prePixels` / `g.preFloat` (captured at paintdown) drive cancel revert
// and the change-detection that decides whether release pushes a snapshot.
interface PaintOutcome {
    before: Uint8Array;
    after: Uint8Array;
    targets: Uint32Array;
    floatPixels: Uint8Array | null;
    canvasPixels: Uint8Array | null;
    reason: string | null;
    protectedSkipped: boolean;
}

function overlayInwardCell(pattern: PatternState, x: number, y: number): Int32Array {
    return pattern.mode === "row"
        ? overlay_inward_cell_row(pattern.canvasWidth, pattern.canvasHeight, x, y)
        : overlay_inward_cell_round(
            pattern.canvasWidth, pattern.canvasHeight,
            pattern.virtualWidth, pattern.virtualHeight,
            pattern.offsetX, pattern.offsetY, x, y,
        );
}

function evaluatePaintAt(tool: PaintTool, color: 1 | 2, x: number, y: number, invertVisited: Set<number> | null): PaintOutcome {
    const s = store.state;
    const { pattern } = s;
    const { canvasWidth: W, canvasHeight: H } = pattern;
    const inCanvas = !outOfBounds(x, y, W, H);
    const shifted = s.float ? shiftedFloatMask(s) : null;
    const visible = visiblePixels(s);
    const recipe = activeGridRecipe(s);
    const evaluatedRecipe = recipe ? evaluateGridRecipe(recipe) : null;
    const recipeCell = evaluatedRecipe
        ? evaluatedRecipe.cells.find(cell => cell.x === x && cell.y === y) ?? null
        : null;
    let paintMask = shifted;
    if (evaluatedRecipe) {
        paintMask = shifted?.slice() ?? new Uint8Array(W * H);
        for (const cell of evaluatedRecipe.cells) {
            if (outOfBounds(cell.x, cell.y, W, H)) continue;
            const index = cell.y * W + cell.x;
            if (visible[index] !== 0) paintMask[index] = 1;
        }
    }
    const blocked = (reason: string): PaintOutcome => ({
        before: visible, after: visible, targets: new Uint32Array(0),
        floatPixels: null, canvasPixels: null, reason, protectedSkipped: false,
    });

    if (!inCanvas && tool !== "overlay") return blocked("Outside pattern");
    if (inCanvas && visible[y * W + x] === 0) return blocked("Outside pattern");
    if (inCanvas && shifted && shifted[y * W + x] === 0 && !recipeCell) return blocked("Outside selection");
    const effectiveOverlayAction = tool === "overlay" && color !== s.primaryColor
        ? overlayAction === "place" ? "clear"
            : overlayAction === "clear" ? "place"
                : "invert"
        : overlayAction;
    if (tool === "overlay" && effectiveOverlayAction === "place" && !overlayTargetAvailable(pattern, x, y)) {
        return blocked(overlayInwardCell(pattern, x, y).length === 0
            ? "No inward supporting cell"
            : "Overlay unavailable at this cell");
    }

    const transforms = axesToFlat(s.axes);
    const targets = transformed_target_indices(W, H, x, y, transforms);
    let next: Uint8Array;
    try {
        next = paintOps[tool]({
            visible, pattern, x, y,
            color, primary: s.primaryColor,
            overlayAction: effectiveOverlayAction,
            invertVisited,
            transforms, shifted: paintMask, repeat: evaluatedRecipe,
        });
    } catch (error) {
        if (error instanceof RangeError) return blocked(error.message);
        throw error;
    }
    let protectedSkipped = false;
    if (preferences.lockInvalid) {
        const unlocked = next;
        next = lockAlwaysInvalid(pattern, visible, unlocked);
        protectedSkipped = !arraysEqual(unlocked, next);
    }
    let floatPixels: Uint8Array | null = null;
    let canvasPixels: Uint8Array | null = null;
    let after = next;
    if (s.float) {
        const f = s.float;
        const newFP = f.pixels.slice();
        for (let ly = 0; ly < f.h; ly++) {
            for (let lx = 0; lx < f.w; lx++) {
                if (f.pixels[ly * f.w + lx] === 0) continue;
                const cx = f.x + lx, cy = f.y + ly;
                if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
                newFP[ly * f.w + lx] = next[cy * W + cx];
            }
        }
        floatPixels = newFP;
        canvasPixels = next.slice();
        for (let ly = 0; ly < f.h; ly++) for (let lx = 0; lx < f.w; lx++) {
            if (f.pixels[ly * f.w + lx] === 0) continue;
            const cx = f.x + lx, cy = f.y + ly;
            if (cx >= 0 && cx < W && cy >= 0 && cy < H) canvasPixels[cy * W + cx] = s.pixels[cy * W + cx];
        }
        after = visiblePixels({ ...s, pixels: canvasPixels, float: { ...f, pixels: newFP } });
    }
    return { before: visible, after, targets, floatPixels, canvasPixels, reason: null, protectedSkipped };
}

function paintAt(clientX: number, clientY: number, g: Extract<Gesture, { kind: "paint" }>) {
    const pattern = store.state.pattern;
    const { x, y } = screenToPattern(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation, pattern, clientX, clientY,
    );
    const tool = store.state.activeTool;
    if (tool === "select" || tool === "wand" || tool === "move") return;
    const outcome = evaluatePaintAt(tool, g.color, x, y, g.invertVisited);
    if (outcome.reason) {
        if (outcome.reason !== "Outside pattern") showGestureFeedback(outcome.reason);
        return;
    }
    if (outcome.protectedSkipped) showGestureFeedback("Protected · Settings");
    if (outcome.floatPixels) {
        const pixels = outcome.floatPixels;
        const base = outcome.canvasPixels;
        store.commit(state => { state.float = { ...state.float!, pixels }; if (base) state.pixels = base; }, { persist: false });
    } else {
        const pixels = outcome.after;
        store.commit(state => { state.pixels = pixels; }, { persist: false });
    }
    updateCoordinates(x, y);
}

function lockAlwaysInvalid(p: PatternState, before: Uint8Array, after: Uint8Array): Uint8Array {
    return p.mode === "row"
        ? lock_invalid_row(before, after, p.canvasWidth, p.canvasHeight)
        : lock_invalid_round(
            before, after,
            p.canvasWidth, p.canvasHeight,
            p.virtualWidth, p.virtualHeight,
            p.offsetX, p.offsetY, p.rounds,
          );
}

// ── Symmetry ─────────────────────────────────────────────────────────────────
function refreshSymmetryUi() {
    ui.setAxes(store.state.axes);
    ui.setTransformState(Boolean(store.state.float), hasConfiguredTransforms());
    ui.setRecipes(store.state.recipes, store.state.activeRecipeId);
}

function hasConfiguredTransforms() {
    return store.state.axes.some(a => a.active);
}
// Shortcuts and popover buttons append an active, canonically positioned
// axis. Axis ids keep multiple entries of the same kind independent.
function addAxisOfKind(k: SymKey) {
    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
    store.commit(s => { s.axes = addAxis(s.axes, k, W, H); }, { recompute: false, history: true });
    refreshSymmetryUi();
}

function deleteAxisById(id: string) {
    store.commit(s => { s.axes = removeAxis(s.axes, id); }, { history: true });
    refreshSymmetryUi();
}

function toggleAxisById(id: string) {
    store.commit(s => { s.axes = toggleAxisActive(s.axes, id); }, { history: true });
    refreshSymmetryUi();
}

function onAxisPosition(id: string, position: { x?: number; y?: number; c?: number }): Axis | null {
    const axis = store.state.axes.find(a => a.id === id);
    if (!axis) return null;
    const snapped = {
        x: position.x === undefined ? undefined : snapHalf(position.x),
        y: position.y === undefined ? undefined : snapHalf(position.y),
        c: position.c === undefined ? undefined : snapInt(position.c),
    };
    const updated = setAxisPosition(store.state.axes, id, snapped).find(a => a.id === id)!;
    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
    if (axisOffCanvas(updated, W, H)) {
        ui.setCanvasFeedback("Keep the axis where it can transform at least two cells");
        return axis;
    }
    if (JSON.stringify(updated) !== JSON.stringify(axis)) {
        store.commit(s => { s.axes = setAxisPosition(s.axes, id, snapped); }, { history: true });
    }
    return updated;
}

function onTransformPopoverToggle(open: boolean) {
    rs.previewRepeatGuides = open;
    if (!open) viewport.canvas.style.cursor = "";
    renderCanvas();
}

function onReplicateSelection() {
    const result = replicateSelection(store);
    if (result === "conflict") {
        ui.setTransformError("Stamp failed: different colours claim the same transformed destination.");
    } else if (result === "orbit-limit") {
        ui.setTransformError("Stamp failed: the transformed target set exceeds the safety limit.");
    } else {
        ui.setTransformError(null);
    }
}

function refreshRecipeUi(error: string | null = null) {
    ui.setRecipes(store.state.recipes, store.state.activeRecipeId);
    ui.setRecipeError(error);
}

function onCreateRecipe() {
    createGridRecipe(store);
    refreshRecipeUi();
}

function onActivateRecipe(id: string) {
    if (!activateGridRecipe(store, id)) refreshRecipeUi("This recipe's source is not available on the chart.");
    else refreshRecipeUi();
}

function onDeleteRecipe(id: string) {
    deleteGridRecipe(store, id);
    refreshRecipeUi();
}

function onRecipeChange(id: string, change: Partial<GridRecipe>) {
    const recipe = store.state.recipes.find(candidate => candidate.id === id);
    if (!recipe) return;
    const updated = {
        ...recipe,
        ...change,
        enabled: true,
        columnSpacingAlternate: change.columnSpacingAlternate ?? recipe.columnSpacingAlternate,
        rowSpacingAlternate: change.rowSpacingAlternate ?? recipe.rowSpacingAlternate,
    };
    const visible = visiblePixels(store.state);
    const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
    const error = gridRecipeError(updated, (x, y) =>
        !outOfBounds(x, y, W, H) && visible[y * W + x] !== 0
    );
    if (error) { refreshRecipeUi(error); return; }
    store.commit(s => { s.recipes = s.recipes.map(candidate => candidate.id === id ? updated : candidate); }, { history: true });
    refreshRecipeUi();
}

function onApplyRecipe() {
    const result = applyGridRecipe(store);
    refreshRecipeUi(result === "no-selection" ? "Select cells for this selection first."
        : result === "conflict" ? "Repeat instances overlap." : null);
}

// ── Tool / colour / settings handlers ────────────────────────────────────────
// Switching tools keeps any active float alive — paint tools clip to its
// shifted mask, so the selection survives across tool changes.
function setTool(t: Tool) {
    const wasSelectionTool = store.state.activeTool === "select" || store.state.activeTool === "wand";
    const isSelectionTool = t === "select" || t === "wand";
    if (wasSelectionTool && !isSelectionTool) selectionMode = "replace";
    if (navigateLatched) {
        navigateLatched = false;
        ui.setViewState(store.state.rotation, navigateMomentary);
    }
    ui.setCanvasFeedback(null);
    store.commit(s => { s.activeTool = t; }, { recompute: false, render: false });
    ui.setTool(t);
    ui.setSelectionMode(t, selectionMode, Boolean(store.state.float));
}
function setSelectionMode(mode: SelectionMode) {
    if (mode === "remove" && !store.state.float) {
        ui.setCanvasFeedback("No selection");
        return;
    }
    selectionMode = mode;
    ui.setCanvasFeedback(null);
    ui.setSelectionMode(store.state.activeTool, mode, Boolean(store.state.float));
}
function setSelectionMoveMode(mode: SelectionMoveMode) {
    if (store.state.activeTool !== "move") setTool("move");
    selectionMoveMode = mode;
    ui.setSelectionState(selectionCellCount(), clipboardCellCount(), mode);
}
function setOverlayAction(action: OverlayAction) {
    overlayAction = action;
    if (store.state.activeTool !== "overlay") setTool("overlay");
    ui.setOverlayAction(action);
}
function setPrimary(slot: 1 | 2) {
    store.commit(s => { s.primaryColor = slot; }, { recompute: false, render: false });
    ui.setPrimary(slot);
}
function onColorInput() {
    const a = (document.getElementById("color-a") as HTMLInputElement).value;
    const b = (document.getElementById("color-b") as HTMLInputElement).value;
    store.commit(s => { s.colorA = a; s.colorB = b; }, { recompute: false });
    ui.setColors(a, b);
}
function onColorCommit() {
    store.commit(() => {}, { recompute: false, render: false, history: true });
}
function onSwapYarns() {
    store.commit(s => {
        [s.colorA, s.colorB] = [s.colorB, s.colorA];
    }, { history: true });
    ui.setColors(store.state.colorA, store.state.colorB);
}
function resetYarnColor(slot: 1 | 2) {
    store.commit(s => {
        if (slot === 1) s.colorA = DEFAULT_YARN_A;
        else s.colorB = DEFAULT_YARN_B;
    }, { history: true });
    ui.setColors(store.state.colorA, store.state.colorB);
}
function onHlOpacityInput() {
    const v = parseInt((document.getElementById("hl-opacity") as HTMLInputElement).value);
    preferences.guidanceOpacity = v;
    saveAppPreferences(preferences);
    renderCanvas();
}
function onDangerColorInput() {
    const value = (document.getElementById("danger-color") as HTMLInputElement).value;
    store.commit(s => { s.dangerColorOverride = value; }, { recompute: false });
}
function onAccentColorInput() {
    const value = (document.getElementById("accent-color") as HTMLInputElement).value;
    store.commit(s => { s.accentColorOverride = value; }, { recompute: false });
}
function resetProjectColor(kind: "danger" | "accent") {
    store.commit(s => {
        if (kind === "danger") s.dangerColorOverride = null;
        else s.accentColorOverride = null;
    }, { recompute: false });
}
function findContrastColors() {
    const colors = contrastingProjectColors(store.state.colorA, store.state.colorB);
    store.commit(s => {
        s.dangerColorOverride = colors.danger;
        s.accentColorOverride = colors.accent;
    }, { recompute: false });
}
function onLabelsToggle() {
    const v = (document.getElementById("labels-on") as HTMLInputElement).checked;
    preferences.labelsVisible = v;
    saveAppPreferences(preferences);
    renderCanvas();
    ui.setViewState(store.state.rotation, instructionsOpen || navigateLatched || navigateMomentary);
}
function onLockInvalidToggle() {
    const v = (document.getElementById("lock-invalid") as HTMLInputElement).checked;
    preferences.lockInvalid = v;
    saveAppPreferences(preferences);
}
function rotate(delta: number) {
    store.commit(s => { s.rotation += delta; }, { recompute: false });
}
function resetRotation() {
    store.commit(s => { s.rotation = 0; }, { recompute: false });
}
function fitPattern() {
    fitToView(
        viewport.canvas, viewport.view, store.state.pattern, store.state.rotation,
        ui.getCanvasWorkspace(),
    );
    renderCanvas();
    ui.setViewState(store.state.rotation, instructionsOpen || navigateLatched || navigateMomentary);
}
function zoomView(factor: number) {
    const rect = viewport.canvas.getBoundingClientRect();
    zoomAt(viewport.canvas, viewport.view, rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    renderCanvas();
    ui.setViewState(store.state.rotation, instructionsOpen || navigateLatched || navigateMomentary);
}
function toggleNavigate() {
    if (instructionsOpen) return;
    navigateLatched = !navigateLatched;
    ui.setViewState(store.state.rotation, navigateLatched || navigateMomentary);
}

// Paste switches to the Move tool so the user can drag the result.
// `pasteClipboard` itself only touches state; the tool switch is a UI side
// effect that lives here in the orchestrator.
function onPaste() {
    ui.setCanvasFeedback(null);
    if (store.state.activeTool !== "move") setTool("move");
    pasteClipboard(store);
}
function onCopy() {
    copyFloat(store);
    ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
}
function onCut() { cutFloat(store); }
function onDeselect() {
    ui.setCanvasFeedback(null);
    deselect(store);
}

// ── Pattern inspector ───────────────────────────────────────────────────────
interface PatternEditSnapshot {
    pattern: PatternState;
    pixels: Uint8Array;
    float: Float | null;
    axes: Axis[];
    recipes: GridRecipe[];
    activeRecipeId: string | null;
}

let editBaseline: PatternEditSnapshot | null = null;
let editSessionSource: PatternEditSnapshot | null = null;
let editSessionPreview: PatternEditSnapshot | null = null;

function patternEditSnapshot(state: Readonly<SessionState>): PatternEditSnapshot {
    return {
        pattern: state.pattern,
        pixels: state.pixels.slice(),
        float: state.float ? { ...state.float, pixels: state.float.pixels.slice() } : null,
        axes: [...state.axes],
        recipes: state.recipes,
        activeRecipeId: state.activeRecipeId,
    };
}

function patternEditVisibleSource(snapshot: PatternEditSnapshot) {
    return snapshot.float
        ? { pattern: snapshot.pattern,
            pixels: visiblePixels({ ...store.state, pattern: snapshot.pattern,
                pixels: snapshot.pixels, float: snapshot.float }) }
        : { pattern: snapshot.pattern, pixels: snapshot.pixels };
}

function samePatternGeometry(a: PatternState, b: PatternState): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function samePatternEditSnapshot(a: PatternEditSnapshot, b: PatternEditSnapshot): boolean {
    return samePatternGeometry(a.pattern, b.pattern)
        && arraysEqual(a.pixels, b.pixels)
        && a.float?.x === b.float?.x
        && a.float?.y === b.float?.y
        && a.float?.w === b.float?.w
        && a.float?.h === b.float?.h
        && (a.float === null) === (b.float === null)
        && (a.float === null || b.float === null || arraysEqual(a.float.pixels, b.float.pixels))
        && axesEqual(a.axes, b.axes)
        && gridRecipesEqual(a.recipes, b.recipes)
        && a.activeRecipeId === b.activeRecipeId;
}

function onEditOpen() {
    editBaseline = null;
    editSessionSource = null;
    editSessionPreview = null;
    ui.syncEditInputs(store.state.pattern);
    const source = { pattern: store.state.pattern, pixels: visiblePixels(store.state) };
    const summary = patternChangeSummary(readEditSettings(), source, source);
    ui.setEditSummary(summary.width, summary.height, summary.preserved, summary.added, summary.removed);
}
function captureEditBaseline() {
    editBaseline = patternEditSnapshot(store.state);
}
function onEditChange(clearDesign = false): boolean {
    if (!editBaseline) captureEditBaseline();
    const baseline = editBaseline!;
    if (!editSessionSource) editSessionSource = patternEditSnapshot(store.state);
    const sessionSource = editSessionSource;
    const source = patternEditVisibleSource(sessionSource);
    let edited: { pattern: PatternState; pixels: Uint8Array };
    try {
        edited = applyEditSettings(source);
    } catch (error) {
        ui.setEditError(error instanceof Error ? error.message : "Invalid pattern dimensions.");
        return false;
    }
    ui.setEditError(null);
    const { pattern, pixels } = edited;
    const settings = readEditSettings();
    const summary = patternChangeSummary(settings, source, edited);
    ui.setEditSummary(summary.width, summary.height, summary.preserved, summary.added, summary.removed);
    if (!clearDesign) {
        fitToView(
            viewport.canvas, viewport.view, pattern, store.state.rotation,
            ui.getCanvasWorkspace(),
        );
    }
    const restoreSessionSource = !settings.wipe
        && samePatternGeometry(pattern, sessionSource.pattern);
    applyingPatternPreview = true;
    try {
        store.commit(s => {
            if (restoreSessionSource) {
                s.pattern = sessionSource.pattern;
                s.pixels = sessionSource.pixels.slice();
                s.axes = [...sessionSource.axes];
                s.recipes = sessionSource.recipes;
                s.float = sessionSource.float
                    ? { ...sessionSource.float, pixels: sessionSource.float.pixels.slice() }
                    : null;
                s.activeRecipeId = sessionSource.activeRecipeId;
                return;
            }
            s.pattern = pattern;
            s.pixels = pixels;
            s.axes = clearDesign ? [] : sessionSource.axes.filter(axis => axisIsProjectValid(axis, pattern));
            s.recipes = clearDesign
                ? [{ ...emptyGridRecipe(), id: sessionSource.recipes[0].id }]
                : sessionSource.recipes;
            if (clearDesign) s.activeRecipeId = null;
            s.float = null;
        }, { persist: false });
    } finally {
        applyingPatternPreview = false;
    }
    editSessionPreview = patternEditSnapshot(store.state);
    if (settings.wipe) editSessionSource = editSessionPreview;
    refreshSymmetryUi();
    return true;
}
function onEditCommit(clearDesign = false) {
    if (clearDesign) patternHistorySession = false;
    if (!editBaseline) return;
    const baseline = editBaseline;
    editBaseline = null;
    const changed = !samePatternEditSnapshot(baseline, store.state);
    if (changed && patternHistorySession) {
        applyingPatternPreview = true;
        try {
            store.commit(() => {}, { recompute: false, render: false });
        } finally {
            applyingPatternPreview = false;
        }
        patternHistorySession = historyReplaceCurrent(store.state);
        ui.setHistory(canUndo(), canRedo());
    } else if (changed) {
        savingPatternHistory = true;
        try {
            applyingPatternPreview = true;
            store.commit(() => {}, { recompute: false, render: false, history: true });
        } finally {
            applyingPatternPreview = false;
            savingPatternHistory = false;
        }
        patternHistorySession = !clearDesign;
    }
    ui.syncEditInputs(store.state.pattern);
}
function onEditRevert() {
    if (!editBaseline) return;
    const baseline = editBaseline;
    editBaseline = null;
    fitToView(
        viewport.canvas, viewport.view, baseline.pattern, store.state.rotation,
        ui.getCanvasWorkspace(),
    );
    applyingPatternPreview = true;
    try {
        store.replace({
            ...store.state,
            pattern: baseline.pattern,
            pixels: baseline.pixels,
            float: baseline.float,
            axes: baseline.axes,
            recipes: baseline.recipes,
            activeRecipeId: baseline.activeRecipeId,
        }, { persist: false });
    } finally {
        applyingPatternPreview = false;
    }
    editSessionPreview = patternEditSnapshot(store.state);
    ui.syncEditInputs(baseline.pattern);
    refreshSymmetryUi();
}

// ── Undo / redo ──────────────────────────────────────────────────────────────
function applyRestored(r: Restored) {
    const dimsChanged = r.pattern.canvasWidth  !== store.state.pattern.canvasWidth
                     || r.pattern.canvasHeight !== store.state.pattern.canvasHeight;
    if (dimsChanged) {
        fitToView(
            viewport.canvas, viewport.view, r.pattern, store.state.rotation,
            ui.getCanvasWorkspace(),
        );
    }
    store.replace(
        { ...store.state, pattern: r.pattern, pixels: r.pixels, float: r.float,
          axes: r.axes, recipes: r.recipes, activeRecipeId: r.activeRecipeId,
          colorA: r.colorA, colorB: r.colorB },
        { persist: true },
    );
    (document.getElementById("color-a") as HTMLInputElement).value = r.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = r.colorB;
    ui.setColors(r.colorA, r.colorB);
    ui.syncEditInputs(r.pattern);
    refreshSymmetryUi();
}
function undo() {
    patternHistorySession = false;
    const r = historyUndo();
    if (r) applyRestored(r);
}
function redo() {
    patternHistorySession = false;
    const r = historyRedo();
    if (r) applyRestored(r);
}

// ── Save / load ──────────────────────────────────────────────────────────────
async function onSave() {
    ui.setDocumentError(null);
    // Save reflects the user-visible state — bake the float into a
    // throwaway snapshot for the file, but leave the live float alone so
    // the selection survives across save.
    const snapshot: SessionState = store.state.float
        ? { ...store.state, ...anchorIntoCanvas(store.state) }
        : store.state;
    try {
        await saveToFile(snapshot);
    } catch (error) {
        const detail = error instanceof Error ? error.message : "The file could not be written.";
        ui.setDocumentError(`Could not save pattern: ${detail}`, "save");
    }
}
async function onLoad() {
    ui.setDocumentError(null);
    let loaded: LoadedFile | null;
    try {
        loaded = await loadFromFile();
    } catch (error) {
        ui.setDocumentError(error instanceof Error ? error.message : "Invalid pattern file.");
        return;
    }
    if (!loaded) return;
    if (sameProject(loaded)) {
        closeAbout();
        return;
    }
    if (!sameAuthoredPattern(loaded.pattern, loaded.pixels)) clearCrochetProgress();
    fitToView(
        viewport.canvas, viewport.view, loaded.pattern, store.state.rotation,
        ui.getCanvasWorkspace(),
    );
    store.replace(
        { ...store.state, pattern: loaded.pattern, pixels: loaded.pixels,
          colorA: loaded.colorA, colorB: loaded.colorB, axes: loaded.axes,
          dangerColorOverride: loaded.dangerColorOverride ?? null,
          accentColorOverride: loaded.accentColorOverride ?? null,
          recipes: loaded.recipes, activeRecipeId: null, float: null },
        { history: true, persist: true },
    );
    closeAbout();
    (document.getElementById("color-a") as HTMLInputElement).value = loaded.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = loaded.colorB;
    ui.setColors(loaded.colorA, loaded.colorB);
    ui.syncEditInputs(loaded.pattern);
    refreshSymmetryUi();
}

// ── Instructions ─────────────────────────────────────────────────────────────
async function onInstructions() {
    if (instructionsOpen) return;
    // Instructions reflect the visible pattern without anchoring the live float.
    const exportPixels = store.state.float
        ? anchorIntoCanvas(store.state).pixels
        : store.state.pixels;
    instructionsOpen = true;
    ui.setViewState(store.state.rotation, true);
    const dlg = ui.openInstructions();
    instructionsView = dlg;
    let cancelled = false;
    dlg.onClose(() => {
        instructionsOpen = false;
        cancelled = true;
        if (instructionsView === dlg) instructionsView = null;
        instructionsPreviewStore = null;
        rs.instructionSeam = null;
        rs.instructionGuidanceCoords = null;
        ui.setViewState(store.state.rotation, instructionsOpen || navigateLatched || navigateMomentary);
        renderCanvas();
    });
    const plan = store.plan;
    const instructionErrors = new Set<string>();
    for (let i = 0; i < plan.length; i += 4) {
        if (plan[i] === PlanType.Invalid) {
            instructionErrors.add(`${plan[i + 2]},${plan[i + 3]}`);
        }
    }

    instructionsPreviewStore = new Store({
        ...store.state,
        pixels: exportPixels,
        axes: [],
        liveMirrors: false,
        float: null,
    });
    renderCanvas();

    dlg.onLivePreview((completedUnits) => {
        if (!instructionsPreviewStore) return;
        const { pattern } = store.state;
        const { canvasWidth: W, canvasHeight: H } = pattern;
        const pixels = completedUnits === null
            ? exportPixels
            : pattern.mode === "row"
                ? instruction_wip_row(exportPixels, W, H, completedUnits)
                : instruction_wip_round(
                    exportPixels, W, H,
                    pattern.virtualWidth, pattern.virtualHeight,
                    pattern.offsetX, pattern.offsetY, pattern.rounds,
                    completedUnits,
                );
        instructionsPreviewStore.commit(
            preview => { preview.pixels = pixels; },
            { render: false, persist: false },
        );
        const selectedUnit = completedUnits === null
            ? null
            : previewUnits[completedUnits - 1] ?? null;
        rs.instructionSeam = selectedUnit?.seam ? { ...selectedUnit.seam, invalid: selectedUnit.invalid } : null;
        rs.instructionGuidanceCoords = completedUnits !== null && completedUnits < previewUnits.length
            ? selectedUnit?.guidanceCoords ?? null : null;
        renderCanvas();
    });

    const startSession = () => {
        const { pattern } = store.state;
        const { canvasWidth: W, canvasHeight: H } = pattern;
        if (pattern.mode === "row") return instruction_start_row(exportPixels, W, H);
        const { virtualWidth: vw, virtualHeight: vh, offsetX: ox, offsetY: oy, rounds } = pattern;
        return instruction_start_round(exportPixels, W, H, vw, vh, ox, oy, rounds);
    };

    const patternFingerprint = fingerprintPattern(store.state.pattern, exportPixels);
    const progressFingerprint = fingerprintPatternShape(store.state.pattern);
    const totalUnits = store.state.pattern.mode === "row"
        ? store.state.pattern.canvasHeight
        : store.state.pattern.rounds;
    let completedUnits = loadLiveProgress(progressFingerprint, totalUnits);
    ui.setCrochetProgress(hasLiveProgress(progressFingerprint, totalUnits));
    let generatedUnits: readonly CachedInstructionUnit[] = [];
    // Reversed corner groups can jump diagonally; markers must stay on cell edges.
    const edgeDirection = (dx: number, dy: number) => Math.abs(dx) >= Math.abs(dy)
        ? { dx: Math.sign(dx), dy: 0 } : { dx: 0, dy: Math.sign(dy) };
    const directionalUnit = (unit: CachedInstructionUnit, index: number): InstructionOverviewUnit => {
        const reversed = dlg.alternate() && index % 2 === 1;
        const direction = reversed ? unit.reversedStartDirection : unit.startDirection;
        const pattern = store.state.pattern;
        const width = pattern.canvasWidth;
        const coords = reversed ? unit.reversedWorkedCoords : unit.workedCoords;
        const last = coords.length - 2;
        const sharedEdge = pattern.mode === "round"
            && pattern.canvasWidth === pattern.virtualWidth && pattern.canvasHeight === pattern.virtualHeight
            && Math.abs(coords[0] - coords[last]) + Math.abs(coords[1] - coords[last + 1]) === 1;
        const startDirection = sharedEdge
            ? edgeDirection(coords[0] - coords[last], coords[1] - coords[last + 1])
            : edgeDirection(direction[2] - direction[0], direction[3] - direction[1]);
        return {
            label: unit.label,
            yarn: unit.yarn,
            color: unit.yarn === "A" ? store.state.colorA : store.state.colorB,
            text: reversed ? unit.reversedText : unit.text,
            invalid: unit.invalid,
            guidanceCoords: packInstructionCoordinates(coords, width),
            seam: direction.length >= 4 ? {
                start: { x: direction[0], y: direction[1], ...startDirection },
            } : null,
        };
    };
    let previewUnits: readonly InstructionOverviewUnit[] = [];
    const copiedInstruction = (unit: InstructionOverviewUnit) => {
        const content = unit.text.slice(unit.text.indexOf(":") + 1).trim();
        return `${unit.label} · Yarn ${unit.yarn}: ${content}`;
    };
    const renderUnits = (units: readonly CachedInstructionUnit[], live: boolean) => {
        dlg.clearText();
        dlg.clearUnits();
        const directionalUnits = units.map(directionalUnit);
        previewUnits = directionalUnits;
        directionalUnits.forEach(directional => {
            dlg.appendUnit(directional);
            dlg.appendLine(copiedInstruction(directional));
        });
        if (live) {
            dlg.setLivePlan(directionalUnits, completedUnits, nextCompleted => {
                completedUnits = nextCompleted;
                const saved = saveLiveProgress(progressFingerprint, completedUnits);
                if (saved) ui.setCrochetProgress(hasLiveProgress(progressFingerprint, totalUnits));
                return saved;
            });
        }
    };
    const cached = instructionCache?.fingerprint === patternFingerprint
        ? instructionCache.units
        : null;

    const run = async () => {
        dlg.setBusy(true);
        dlg.clearText();
        dlg.clearUnits();
        dlg.setErrors(instructionErrors.size);
        const session = startSession();
        const total = session.total();
        const units: CachedInstructionUnit[] = [];
        generatedUnits = units;
        for (let index = 0; index < total; index++) {
            if (cancelled) {
                session.free();
                dlg.endProgress();
                return;
            }
            const signature = session.signature_at(index)!;
            const rawSignature: InstructionUnitSignature = {
                label: `${signature.kind() === InstructionUnitKind.Row ? "Row" : "Round"} ${signature.number()}`,
                yarn: signature.yarn() === InstructionYarn.A ? "A" : "B",
                contentKey: signature.content_key(),
                invalidWorkedCoords: signature.invalid_worked_coords(),
                startDirection: signature.start_direction(),
                reversedStartDirection: signature.reversed_start_direction(),
            };
            signature.free();
            let cachedUnit = cachedInstructionUnit(instructionCache, progressFingerprint, index, rawSignature);
            const recomputed = !cachedUnit;
            if (!cachedUnit) {
                const unit = session.unit_at(index)!;
                cachedUnit = {
                    ...rawSignature,
                    text: unit.text(), reversedText: unit.reversed_text(),
                    workedCoords: unit.worked_coords(), reversedWorkedCoords: unit.reversed_worked_coords(),
                    invalid: rawSignature.invalidWorkedCoords.length > 0,
                };
                unit.free();
            }
            units.push(cachedUnit);
            const directional = directionalUnit(cachedUnit, units.length - 1);
            dlg.appendUnit(directional);
            dlg.appendLine(copiedInstruction(directional));
            dlg.setProgress(index + 1, total);
            if (shouldYieldInstructionGeneration(index, recomputed)) {
                const hooks = window as unknown as {
                    __test_instruction_yields__?: { index: number; recomputed: boolean }[];
                    __test_on_instruction_yield__?: (yielded: { index: number; recomputed: boolean }) => void;
                };
                const yielded = { index, recomputed };
                hooks.__test_instruction_yields__?.push(yielded);
                hooks.__test_on_instruction_yield__?.(yielded);
                await new Promise<void>(res => requestAnimationFrame(() => res()));
            }
        }
        session.free();
        if (!cancelled) {
            generatedUnits = units;
            instructionCache = { fingerprint: patternFingerprint, shapeFingerprint: progressFingerprint, units };
            renderUnits(generatedUnits, true);
        }
        dlg.endProgress();
        dlg.setBusy(false);
    };

    dlg.onAlternate(() => {
        const units = instructionCache?.fingerprint === patternFingerprint
            ? instructionCache.units
            : generatedUnits;
        renderUnits(units, instructionCache?.fingerprint === patternFingerprint);
    });
    dlg.setErrors(instructionErrors.size);
    if (cached) {
        generatedUnits = cached;
        renderUnits(cached, true);
        dlg.endProgress();
        dlg.setBusy(false);
    } else {
        run();
    }
}

// ── Mount UI + gestures ─────────────────────────────────────────────────────
const ui: UIHandle = mountUI({
    onTool: setTool,
    onOverlayAction: setOverlayAction,
    onSelectionMoveMode: setSelectionMoveMode,
    onSelectionMode: setSelectionMode,
    onSelectionCopy: onCopy,
    onSelectionCut: onCut,
    onSelectionPaste: onPaste,
    onSelectionDeselect: onDeselect,
    onPrimaryColor: setPrimary,
    onSwapYarns,
    onResetYarnColor: resetYarnColor,
    onColorChange:  onColorInput,
    onColorCommit,
    onAddAxis:    addAxisOfKind,
    onToggleAxis: toggleAxisById,
    onDeleteAxis: deleteAxisById,
    onAxisPosition,
    onCreateRecipe,
    onActivateRecipe,
    onDeleteRecipe,
    onRecipeChange,
    onApplyRecipe,
    onTransformPopoverToggle,
    onReplicateSelection,
    onHighlightChange:         onHlOpacityInput,
    onDangerColorChange:       onDangerColorInput,
    onAccentColorChange:       onAccentColorInput,
    onDangerColorReset:        () => resetProjectColor("danger"),
    onAccentColorReset:        () => resetProjectColor("accent"),
    onFindContrastColors:      findContrastColors,
    onLabelsVisibleChange:     onLabelsToggle,
    onLockInvalidChange:   onLockInvalidToggle,
    onUndo: undo,
    onRedo: redo,
    onRotate: rotate,
    onResetRotation: resetRotation,
    onFit: fitPattern,
    onZoom: zoomView,
    onNavigate: toggleNavigate,
    onEditOpen, onEditChange, onEditCommit, onEditRevert,
    onSave, onLoad, onInstructions, onAbout: showAbout,
});

function crochetProgressFingerprint() {
    return fingerprintPatternShape(store.state.pattern);
}

function crochetProgressTotal() {
    return store.state.pattern.mode === "row"
        ? store.state.pattern.canvasHeight
        : store.state.pattern.rounds;
}

function syncCrochetProgressControl() {
    ui.setCrochetProgress(hasLiveProgress(crochetProgressFingerprint(), crochetProgressTotal()));
}

function clearCrochetProgress() {
    clearLiveProgress();
    ui.setCrochetProgress(false);
}

store.addObserver(syncCrochetProgressControl);
syncCrochetProgressControl();

function beginFreshPattern() {
    const fresh = defaultSession();
    fresh.pixels = initialize_row_pattern(
        fresh.pattern.canvasWidth, fresh.pattern.canvasHeight,
    ).slice();
    if (!sameAuthoredPattern(fresh.pattern, fresh.pixels)) clearCrochetProgress();
    fitToView(
        viewport.canvas, viewport.view, fresh.pattern, fresh.rotation,
        ui.getCanvasWorkspace(),
    );
    historyReset(fresh);
    patternHistorySession = false;
    store.replace(fresh, { persist: true });
    syncDomInputs(fresh);
    ui.setTool(fresh.activeTool);
    ui.setPrimary(fresh.primaryColor);
    ui.setColors(fresh.colorA, fresh.colorB);
    ui.syncEditInputs(fresh.pattern);
    refreshSymmetryUi();
    ui.setHistory(false, false);
    closeAbout();
    (document.getElementById("btn-edit") as HTMLButtonElement).click();
}

function useExample() {
    const example = exampleSession();
    fitToView(
        viewport.canvas, viewport.view, example.pattern, example.rotation,
        ui.getCanvasWorkspace(),
    );
    historyReset(example);
    store.replace(example, { persist: true });
    syncDomInputs(example);
    ui.setTool(example.activeTool);
    ui.setPrimary(example.primaryColor);
    ui.setColors(example.colorA, example.colorB);
    ui.syncEditInputs(example.pattern);
    refreshSymmetryUi();
    closeAbout();
}

document.getElementById("about-new")!.addEventListener("click", beginFreshPattern);
document.getElementById("about-open")!.addEventListener("click", () => {
    (document.getElementById("btn-load") as HTMLButtonElement).click();
});
document.getElementById("about-example")!.addEventListener("click", useExample);

const clientToPattern = (cx: number, cy: number) => {
    const pattern = store.state.pattern;
    const { x, y } = screenToPattern(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation, pattern, cx, cy,
    );
    const inside = !outOfBounds(x, y, pattern.canvasWidth, pattern.canvasHeight);
    return { x, y, inside };
};

mountGestures(viewport.canvas, viewport.view, clientToPattern, {
    primaryColor: () => store.state.primaryColor,
    onPaintStart: (color, mods) => {
        if (instructionsOpen || editBaseline) {
            gesture = null;
            return;
        }
        gestureFeedbackShown = false;
        ui.setCanvasFeedback(null);
        const tool = store.state.activeTool;
        if (tool === "move") {
            const mode: MoveMode = mods.alt ? "mask-only" : mods.ctrl ? "duplicate" : selectionMoveMode;
            let prePixels: Uint8Array | null = null;
            const preFloat = store.state.float;
            const preRecipes = store.state.recipes;
            const preActiveRecipeId = store.state.activeRecipeId;
            if (mode === "mask-only" && preFloat) {
                const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
                const clipped = clipFloatToCanvas(preFloat, W, H);
                if (!clipped) {
                    // Float entirely off-canvas — destroy it, don't start a drag.
                    store.commit(s => { s.float = null; }, { history: true });
                    return;
                }
                prePixels = store.state.pixels.slice();
                const stamped = visiblePixels(store.state);
                store.commit(s => { s.pixels = stamped; s.float = clipped; }, { persist: false });
                gesture = { kind: "move", guidePickPending: true, mode, drag: null, prePixels, preFloat: clipped, preRecipes, preActiveRecipeId };
                return;
            } else if (mode === "duplicate" && preFloat) {
                // Pre-stamp the float into canvas so the duplicate is
                // visible throughout the drag.
                prePixels = store.state.pixels.slice();
                const stamped = visiblePixels(store.state);
                store.commit(s => { s.pixels = stamped; }, { persist: false });
            }
            gesture = { kind: "move", guidePickPending: true, mode, drag: null, prePixels, preFloat, preRecipes, preActiveRecipeId };
            return;
        }
        if (tool === "select") {
            const mode = mods.shift ? "add" : mods.ctrl ? "remove" : selectionMode;
            gesture = {
                kind: "select",
                guidePickPending: true,
                mode,
                rect: null,
            };
            ui.setCanvasFeedback(`${mode === "remove" ? "Subtract" : mode === "add" ? "Add" : "Replace"} selection · drag to preview`);
            return;
        }
        if (tool === "wand") {
            const mode = mods.shift ? "add" : mods.ctrl ? "remove" : selectionMode;
            gesture = {
                kind: "wand",
                guidePickPending: true,
                mode,
                lastCell: null,
                prePixels: store.state.pixels.slice(),
                preFloat:  store.state.float,
                preRecipes: store.state.recipes,
                preActiveRecipeId: store.state.activeRecipeId,
            };
            ui.setCanvasFeedback(`${mode === "remove" ? "Subtract" : mode === "add" ? "Add" : "Replace"} selection · release to commit`);
            return;
        }
        gesture = {
            kind: "paint",
            guidePickPending: true,
            color,
            prePixels: store.state.pixels.slice(),
            preFloat:  store.state.float,
            invertVisited: tool === "invert" || (tool === "overlay" && overlayAction === "invert")
                ? new Set<number>() : null,
        };
    },
    onPaintAt:    (cx, cy) => {
        if (!gesture) return;
        if ("guidePickPending" in gesture && gesture.guidePickPending) {
            gesture.guidePickPending = false;
            if (rs.previewRepeatGuides) {
                const frac = screenToPatternFrac(
                    viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                    store.state.pattern, cx, cy,
                );
                if (gesture.kind !== "move") {
                    const hits = pickAxesAt(store.state.axes, frac.x, frac.y, editableAxisTolerance());
                    if (hits.length > 0) {
                        viewport.canvas.style.cursor = "grabbing";
                        gesture = { kind: "axis-drag",
                            picks: hits.map(a => ({ id: a.id, kind: a.kind })),
                            preAxes: [...store.state.axes] };
                        return;
                    }
                }
            }
        }
        if (gesture.kind === "move") {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            const f = store.state.float;
            if (!gesture.drag) {
                // First paintAt: choose between axis-drag and float-move.
                // Axis-drag wins when the click lands on an active guide
                // line — the float, if any, isn't disturbed. The click must
                // also be in the cell under the cursor, not the float's mask.
                const frac = screenToPatternFrac(
                    viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                    store.state.pattern, cx, cy,
                );
                const hits = pickAxesAt(store.state.axes, frac.x, frac.y, AXIS_HIT_TOLERANCE);
                if (hits.length > 0) {
                    gesture = { kind: "axis-drag",
                                picks: hits.map(a => ({ id: a.id, kind: a.kind })),
                                preAxes: [...store.state.axes] };
                    return;
                }
                // Otherwise the existing float-move path.
                if (!f) {
                    showGestureFeedback("No selection");
                    return;
                }
                const lx = p.x - f.x, ly = p.y - f.y;
                const insideFloat = lx >= 0 && lx < f.w && ly >= 0 && ly < f.h && f.pixels[ly * f.w + lx] !== 0;
                if (!insideFloat) {
                    showGestureFeedback("Start inside selection");
                    return;
                }
                gesture.drag = { anchorX: p.x, anchorY: p.y, startDx: f.x, startDy: f.y };
                return;
            }
            if (!f) { gesture.drag = null; return; }
            const rawX = gesture.drag.startDx + (p.x - gesture.drag.anchorX);
            const rawY = gesture.drag.startDy + (p.y - gesture.drag.anchorY);
            const isMaskOnly = gesture.mode === "mask-only" && gesture.preFloat !== null;
            const W = store.state.pattern.canvasWidth, H = store.state.pattern.canvasHeight;
            const newX = isMaskOnly ? Math.max(0, Math.min(W - f.w, rawX)) : rawX;
            const newY = isMaskOnly ? Math.max(0, Math.min(H - f.h, rawY)) : rawY;
            if (newX !== f.x || newY !== f.y) {
                if (isMaskOnly) {
                    // Mirror canvas content at the new position into float.pixels
                    // so visiblePixels stays a no-op and the marquee shows the shape.
                    const pf = gesture.preFloat!;
                    const newFP = new Uint8Array(pf.w * pf.h);
                    for (let ly = 0; ly < pf.h; ly++) {
                        for (let lx = 0; lx < pf.w; lx++) {
                            if (pf.pixels[ly * pf.w + lx] === 0) continue;
                            const cx = newX + lx, cy = newY + ly;
                            if (!outOfBounds(cx, cy, W, H))
                                newFP[ly * pf.w + lx] = store.state.pixels[cy * W + cx];
                        }
                    }
                    store.commit(s => { if (s.float) { s.float = { ...s.float, x: newX, y: newY, pixels: newFP }; syncActiveGridRecipe(s, { x: newX - f.x, y: newY - f.y }); } }, { persist: false });
                } else {
                    store.commit(s => { if (s.float) { s.float = { ...s.float, x: newX, y: newY }; syncActiveGridRecipe(s, { x: newX - f.x, y: newY - f.y }); } }, { persist: false });
                }
            }
            return;
        }
        if (gesture.kind === "axis-drag") {
            const frac = screenToPatternFrac(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            const picks = gesture.picks;
            // Each picked axis tracks the cursor along its own kind's
            // projection — V follows x, H follows y, C follows both, D1/D2
            // follow the line constant. Multi-axis just iterates this.
            store.commit(s => {
                for (const p of picks) {
                    let pos: { x?: number; y?: number; c?: number };
                    switch (p.kind) {
                        case "V":  pos = { x: snapHalf(frac.x - 0.5) }; break;
                        case "H":  pos = { y: snapHalf(frac.y - 0.5) }; break;
                        case "C":  pos = { x: snapHalf(frac.x - 0.5), y: snapHalf(frac.y - 0.5) }; break;
                        case "D1": pos = { c: snapInt(frac.x - frac.y) }; break;
                        case "D2": pos = { c: snapInt(frac.x + frac.y - 1) }; break;
                    }
                    s.axes = setAxisPosition(s.axes, p.id, pos);
                }
            }, { persist: false });
            // Recompute delete-zone membership across all picked axes.
            const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
            const next = new Set<string>();
            for (const p of picks) {
                const a = store.state.axes.find(x => x.id === p.id);
                if (a && axisOffCanvas(a, W, H)) next.add(p.id);
            }
            const changed = next.size !== rs.axesInDeleteZone.size
                || [...next].some(id => !rs.axesInDeleteZone.has(id));
            if (changed) {
                rs.axesInDeleteZone = next;
                renderCanvas();
            }
            return;
        }
        if (gesture.kind === "select") {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (!gesture.rect) {
                gesture.rect = { startX: p.x, startY: p.y, endX: p.x, endY: p.y };
            } else {
                gesture.rect.endX = p.x;
                gesture.rect.endY = p.y;
            }
            syncSelectPreview();
            const width = Math.abs(gesture.rect.endX - gesture.rect.startX) + 1;
            const height = Math.abs(gesture.rect.endY - gesture.rect.startY) + 1;
            const count = width * height;
            const mode = gesture.mode === "remove" ? "Subtract" : gesture.mode === "add" ? "Add" : "Replace";
            ui.setCanvasFeedback(`${mode} · ${width} × ${height} · ${count} cell${count === 1 ? "" : "s"}`);
            renderCanvas();
            return;
        }
        if (gesture.kind === "wand") {
            const p = screenToPattern(
                viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
                store.state.pattern, cx, cy,
            );
            if (p.x < 0 || p.x >= store.state.pattern.canvasWidth) return;
            if (p.y < 0 || p.y >= store.state.pattern.canvasHeight) return;
            if (gesture.lastCell && gesture.lastCell.x === p.x && gesture.lastCell.y === p.y) return;
            gesture.lastCell = { x: p.x, y: p.y };
            commitWandAt(store, p.x, p.y, gesture.mode, { history: false, persist: false });
            return;
        }
        // gesture.kind === "paint"
        paintAt(cx, cy, gesture);
    },
    onPaintEnd:   () => {
        if (!gesture) return;
        if (gesture.kind === "move") {
            if (!gesture.drag) { gesture = null; return; }
            if (gesture.mode === "mask-only" && store.state.float) {
                // float.pixels mirrors canvas at current position — shiftedFloatMask
                // gives the correct lift shape directly.
                const shifted = shiftedFloatMask(store.state);
                const lifted  = liftCells(store.state.pixels, store.state.pattern, shifted);
                store.commit(s => { s.pixels = lifted.pixels; s.float = lifted.float; syncActiveGridRecipe(s); }, { history: true });
            } else {
                // Move and duplicate converge here: the duplicate's pre-stamp
                // already happened at paintdown, so release just records the
                // final dx/dy.
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            refreshSymmetryUi();
            gesture = null;
            return;
        }
        if (gesture.kind === "select") {
            if (gesture.rect) {
                commitSelectRect(
                    store,
                    gesture.rect.startX, gesture.rect.startY,
                    gesture.rect.endX,   gesture.rect.endY,
                    gesture.mode,
                );
            }
            gesture = null;
            syncSelectPreview();
            ui.setCanvasFeedback(null);
            renderCanvas();
            return;
        }
        if (gesture.kind === "wand") {
            if (gesture.lastCell !== null) {
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            gesture = null;
            ui.setCanvasFeedback(null);
            return;
        }
        if (gesture.kind === "axis-drag") {
            // Each picked axis is independently checked: those in the
            // delete zone get removed, the rest just have their new
            // position committed. One snapshot covers the whole release.
            const g = gesture;
            const { canvasWidth: W, canvasHeight: H } = store.state.pattern;
            const toRemove: string[] = [];
            for (const p of g.picks) {
                const a = store.state.axes.find(x => x.id === p.id);
                if (a && axisOffCanvas(a, W, H)) toRemove.push(p.id);
            }
            const dropped = toRemove.length > 0;
            const moved = !dropped && JSON.stringify(g.preAxes) !== JSON.stringify(store.state.axes);
            if (dropped) {
                store.commit(s => {
                    for (const id of toRemove) s.axes = removeAxis(s.axes, id);
                }, { history: true });
            } else if (moved) {
                store.commit(() => {}, { recompute: false, render: false, history: true });
            }
            // Always refresh — the popover's per-row position display picks
            // up the new x/y/c from `s.axes`, otherwise it'd show stale values
            // after a position-only drag.
            if (dropped || moved) refreshSymmetryUi();
            rs.axesInDeleteZone = new Set();
            viewport.canvas.style.cursor = "";
            gesture = null;
            return;
        }
        // gesture.kind === "paint" — dedupe-push if state actually changed.
        const changed = !arraysEqual(gesture.prePixels, store.state.pixels)
                     || gesture.preFloat !== store.state.float;
        if (changed) store.commit(() => {}, { recompute: false, render: false, history: true });
        gesture = null;
    },
    onPaintCancel: () => {
        gestureFeedbackShown = false;
        ui.setCanvasFeedback(null);
        if (!gesture) return;
        if (gesture.kind === "move") {
            const { prePixels, preFloat, preRecipes, preActiveRecipeId } = gesture;
            gesture = null;
            // Restore pre-drag state: pixels (if paintdown pre-stamped) and
            // the entire float (offset, content, mask).
            store.commit(s => {
                if (prePixels) s.pixels = prePixels;
                s.float = preFloat;
                s.recipes = preRecipes;
                s.activeRecipeId = preActiveRecipeId;
            });
            refreshSymmetryUi();
            return;
        }
        if (gesture.kind === "select") {
            gesture = null;
            syncSelectPreview();
            ui.setCanvasFeedback(null);
            renderCanvas();
            return;
        }
        if (gesture.kind === "wand") {
            // Revert to pre-drag state — partial wand sweep is lost.
            const { prePixels, preFloat, preRecipes, preActiveRecipeId } = gesture;
            gesture = null;
            store.commit(s => {
                s.pixels = prePixels;
                s.float = preFloat;
                s.recipes = preRecipes;
                s.activeRecipeId = preActiveRecipeId;
            });
            return;
        }
        if (gesture.kind === "axis-drag") {
            const { preAxes } = gesture;
            gesture = null;
            rs.axesInDeleteZone = new Set();
            viewport.canvas.style.cursor = "";
            store.commit(s => { s.axes = preAxes; });
            return;
        }
        // gesture.kind === "paint"
        const { prePixels, preFloat } = gesture;
        gesture = null;
        store.commit(s => { s.pixels = prePixels; s.float = preFloat; });
    },
    onHover:      (x, y) => {
        if (instructionsOpen) return;
        updateCoordinates(x, y);
    },
    onView:       () => {
        renderCanvas();
        ui.setViewState(store.state.rotation, instructionsOpen || navigateLatched || navigateMomentary);
    },
    navigate:     () => instructionsOpen || navigateLatched || navigateMomentary,
});

viewport.canvas.addEventListener("pointermove", event => {
    if (instructionsOpen || event.buttons || !rs.previewRepeatGuides) return;
    const frac = screenToPatternFrac(
        viewport.canvas, viewport.view, viewport.dpr, rs.visualRotation,
        store.state.pattern, event.clientX, event.clientY,
    );
    const hits = pickAxesAt(store.state.axes, frac.x, frac.y, editableAxisTolerance());
    viewport.canvas.style.cursor = hits.length > 0 ? "grab" : "";
});
viewport.canvas.addEventListener("pointerleave", () => {
    viewport.canvas.style.cursor = "";
});
viewport.canvas.addEventListener("pointerdown", () => {
    viewport.canvas.focus({ preventScroll: true });
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (instructionsOpen) return;
    if (e.code === "Space" && t === viewport.canvas) {
        e.preventDefault();
        if (!e.repeat) {
            navigateMomentary = true;
            ui.setViewState(store.state.rotation, true);
        }
        return;
    }
    if (e.code === "Space" && t === document.body) {
        e.preventDefault();
        if (!e.repeat) {
            navigateMomentary = true;
            ui.setViewState(store.state.rotation, true);
        }
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key === "y" || (e.shiftKey && (e.key === "Z" || e.key === "z"))) { e.preventDefault(); redo(); }
        else if (e.key === "a" && !e.shiftKey) { e.preventDefault(); selectAll(store); }
        else if (e.key === "A" ||  (e.shiftKey && e.key === "a")) { e.preventDefault(); deselect(store); }
        else if (e.key === "c" && !e.shiftKey) { e.preventDefault(); onCopy(); }
        else if (e.key === "x" && !e.shiftKey) { e.preventDefault(); cutFloat(store); }
        else if (e.key === "v" && !e.shiftKey) { e.preventDefault(); onPaste(); }
        else if (e.key.startsWith("Arrow") && t === viewport.canvas
            && store.state.activeTool === "move" && store.state.float) {
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            const ddx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const ddy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
            store.commit(state => {
                if (!ctrlArrowStamped && state.float) {
                    state.pixels     = visiblePixels(state);
                    ctrlArrowStamped = true;
                }
                if (state.float) {
                    state.float = { ...state.float, x: state.float.x + ddx, y: state.float.y + ddy };
                    syncActiveGridRecipe(state, { x: ddx, y: ddy });
                }
            }, { history: !e.repeat });
        }
        return;
    }
    if (e.altKey) {
        if (e.key.startsWith("Arrow") && t === viewport.canvas
            && store.state.activeTool === "move" && store.state.float) {
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            const ddx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const ddy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
            store.commit(state => {
                if (!maskArrowState && state.float) {
                    const W = state.pattern.canvasWidth, H = state.pattern.canvasHeight;
                    state.pixels = visiblePixels(state);
                    const clipped = clipFloatToCanvas(state.float, W, H);
                    if (!clipped) { state.float = null; return; }   // entirely off-canvas — destroy
                    state.float = clipped;
                    maskArrowState = { preFloat: clipped };
                }
                if (state.float && maskArrowState) {
                    const pf = maskArrowState.preFloat;
                    const W = state.pattern.canvasWidth, H = state.pattern.canvasHeight;
                    const rawX = state.float.x + ddx, rawY = state.float.y + ddy;
                    const newX = Math.max(0, Math.min(W - pf.w, rawX));
                    const newY = Math.max(0, Math.min(H - pf.h, rawY));
                    const newFP = new Uint8Array(pf.w * pf.h);
                    for (let ly = 0; ly < pf.h; ly++) {
                        for (let lx = 0; lx < pf.w; lx++) {
                            if (pf.pixels[ly * pf.w + lx] === 0) continue;
                            const cx = newX + lx, cy = newY + ly;
                            if (!outOfBounds(cx, cy, W, H))
                                newFP[ly * pf.w + lx] = state.pixels[cy * W + cx];
                        }
                    }
                    const translation = { x: newX - state.float.x, y: newY - state.float.y };
                    state.float = { ...state.float, x: newX, y: newY, pixels: newFP };
                    syncActiveGridRecipe(state, translation);
                }
            }, { history: !e.repeat });
        }
        return;
    }
    if (e.key === "Escape") {
        if (store.state.float) { e.preventDefault(); anchorFloat(store); }
        return;
    }
    if (e.key === "Delete") {
        if (store.state.float) { e.preventDefault(); deleteFloat(store); }
        return;
    }
    if (e.key.startsWith("Arrow")) {
        if (t !== viewport.canvas) return;
        if (store.state.activeTool !== "move" || !store.state.float) return;
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const ddx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const ddy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        store.commit(state => {
            state.float = { ...state.float!, x: state.float!.x + ddx, y: state.float!.y + ddy };
            syncActiveGridRecipe(state, { x: ddx, y: ddy });
        }, { history: !e.repeat });
        return;
    }
    const k = e.key.toLowerCase();
    if      (k === "p") setTool("pencil");
    else if (k === "f") setTool("fill");
    else if (k === "e") setTool("eraser");
    else if (k === "o") setOverlayAction(e.shiftKey ? "clear" : "place");
    else if (k === "i") setTool("invert");
    else if (k === "s") setTool("select");
    else if (k === "w") setTool("wand");
    else if (k === "m") setTool("move");
    else if (k === "v") addAxisOfKind("V");
    else if (k === "h") addAxisOfKind("H");
    else if (k === "c") addAxisOfKind("C");
    else if (k === "d") addAxisOfKind("D1");
    else if (k === "a") addAxisOfKind("D2");
    else if (k === "t") { e.preventDefault(); onReplicateSelection(); }
    else if (k === "r") rotate(e.shiftKey ? -45 : 45);
    else if (k === "1") setPrimary(1);
    else if (k === "2") setPrimary(2);
});

document.addEventListener("keyup", e => {
    if (e.code === "Space") {
        navigateMomentary = false;
        ui.setViewState(store.state.rotation, navigateLatched);
    } else if (e.key === "Alt") {
        if (maskArrowState && store.state.float) {
            const shifted = shiftedFloatMask(store.state);
            const lifted  = liftCells(store.state.pixels, store.state.pattern, shifted);
            store.commit(s => { s.pixels = lifted.pixels; s.float = lifted.float; }, { history: true });
        }
        maskArrowState   = null;
        ctrlArrowStamped = false;
    } else if (e.key === "Control" || e.key === "Meta") {
        ctrlArrowStamped = false;
        maskArrowState   = null;   // safety reset
    }
});

window.addEventListener("blur", () => {
    ctrlArrowStamped = false;
    maskArrowState   = null;
    navigateMomentary = false;
    ui.setViewState(store.state.rotation, navigateLatched);
});

// ── Initial DOM-input sync + first render ────────────────────────────────────
function syncDomInputs(s: Readonly<SessionState>) {
    (document.getElementById("color-a") as HTMLInputElement).value = s.colorA;
    (document.getElementById("color-b") as HTMLInputElement).value = s.colorB;
}

function syncPreferenceInputs() {
    (document.getElementById("hl-opacity") as HTMLInputElement).value = String(preferences.guidanceOpacity);
    (document.getElementById("labels-on") as HTMLInputElement).checked = preferences.labelsVisible;
    (document.getElementById("lock-invalid") as HTMLInputElement).checked = preferences.lockInvalid;
}

function syncProjectColorInputs(s: Readonly<SessionState>) {
    const danger = s.dangerColorOverride ?? DEFAULT_APP_PREFERENCES.dangerColor;
    const accent = s.accentColorOverride ?? DEFAULT_APP_PREFERENCES.accentColor;
    (document.getElementById("danger-color") as HTMLInputElement).value = danger;
    (document.getElementById("accent-color") as HTMLInputElement).value = accent;
    ui.setProjectColors(danger, accent);
}

syncDomInputs(store.state);
syncPreferenceInputs();
syncProjectColorInputs(store.state);
ui.setOverlayAction(overlayAction);
ui.setTool(store.state.activeTool);
ui.setPrimary(store.state.primaryColor);
ui.setColors(store.state.colorA, store.state.colorB);
ui.setTransformState(Boolean(store.state.float), hasConfiguredTransforms());
ui.setSelectionState(selectionCellCount(), clipboardCellCount(), selectionMoveMode);
ui.setSelectionMode(store.state.activeTool, selectionMode, Boolean(store.state.float));
ui.syncEditInputs(store.state.pattern);
ui.setHistory(canUndo(), canRedo());
ui.setRecoveryStatus(saved ? "recovered" : "saved");
ui.setCrochetErrors(crochetErrorCount());

if (saved) {
    fitToView(
        viewport.canvas, viewport.view, store.state.pattern, store.state.rotation,
        ui.getCanvasWorkspace(),
    );
    refreshSymmetryUi();
    historyEnsureInitialized(store.state);
    renderCanvas();
} else {
    const { pattern, pixels } = applyEditSettings();
    fitToView(
        viewport.canvas, viewport.view, pattern, store.state.rotation,
        ui.getCanvasWorkspace(),
    );
    store.commit(s => { s.pattern = pattern; s.pixels = pixels; }, { persist: false });
    refreshSymmetryUi();
    historyReset(store.state);
    ui.setHistory(canUndo(), canRedo());
}
ui.setViewState(store.state.rotation, false);
if (shouldShowAbout(currentReleaseHash)) showAbout();
