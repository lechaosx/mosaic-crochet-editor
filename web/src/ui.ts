import { Tool, SymKey, PatternState, Axis, GridRecipe } from "@mosaic/logic/types";
import type { SelectMode } from "@mosaic/logic/selection";
import type { OverlayAction } from "@mosaic/logic/paint";
import { el, setRadio, clampInputDisplay, radioValue } from "./dom";
import type { CanvasWorkspace } from "./render";

export type SelectionMoveMode = "move" | "duplicate" | "mask-only";
export type SelectionMode = SelectMode;

export function instructionBadgeTextColor(color: string): "#000000" | "#ffffff" {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return "#ffffff";
    const channel = (offset: number) => {
        const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

function bindLongPress(target: HTMLElement, onClick: () => void, onLong: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;

    const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

    target.addEventListener("pointerdown", event => {
        startX = event.clientX;
        startY = event.clientY;
        cancel();
        timer = setTimeout(() => { timer = null; onLong(); }, 500);
    });
    target.addEventListener("pointermove", event => {
        if (timer !== null && Math.hypot(event.clientX - startX, event.clientY - startY) > 8) cancel();
    });
    target.addEventListener("pointerup", () => {
        if (timer !== null) { cancel(); onClick(); }
    });
    target.addEventListener("pointercancel", cancel);
    target.addEventListener("pointerleave", cancel);
}

// ─── Global Mirror button ids ─────────────────────────────────────────────────
// One "Add <kind>" button per kind in the inspector's add row.
const SYM_ADD_BUTTONS: { id: string; key: SymKey; glyph: string }[] = [
    { id: "add-sym-v",  key: "V",  glyph: "↔" },
    { id: "add-sym-h",  key: "H",  glyph: "↕" },
    { id: "add-sym-c",  key: "C",  glyph: "⊕" },
    { id: "add-sym-d1", key: "D1", glyph: "╲" },
    { id: "add-sym-d2", key: "D2", glyph: "╱" },
];

// ─── Public surface ───────────────────────────────────────────────────────────
export interface UICallbacks {
    onTool:            (t: Tool) => void;
    onOverlayAction:   (action: OverlayAction) => void;
    onSelectionMoveMode: (mode: SelectionMoveMode) => void;
    onSelectionMode:     (mode: SelectionMode) => void;
    onSelectionCopy:     () => void;
    onSelectionCut:      () => void;
    onSelectionPaste:    () => void;
    onSelectionDeselect: () => void;
    onPrimaryColor:    (slot: 1 | 2) => void;
    onSwapYarns:       () => void;
    onColorChange:     () => void;
    onColorCommit:     () => void;
    onAddAxis:         (k: SymKey) => void;
    onToggleAxis:      (id: string) => void;
    onDeleteAxis:      (id: string) => void;
    onAxisPosition:    (id: string, position: { x?: number; y?: number; c?: number }) => Axis | null;
    onCreateRecipe:    () => void;
    onActivateRecipe:  (id: string) => void;
    onDeleteRecipe:    (id: string) => void;
    onRecipeChange:    (id: string, change: Partial<GridRecipe>) => void;
    onApplyRecipe:     () => void;
    onLiveMirrorsChange: (enabled: boolean) => void;
    onTransformPopoverToggle: (open: boolean) => void;
    onReplicateSelection: () => void;
    onHighlightChange:        () => void;
    onDangerColorChange:      () => void;
    onAccentColorChange:      () => void;
    onDangerColorReset:       () => void;
    onAccentColorReset:       () => void;
    onLabelsVisibleChange:    () => void;
    onLockInvalidChange: () => void;
    onUndo:            () => void;
    onRedo:            () => void;
    onRotate:          (delta: number) => void;
    onResetRotation:   () => void;
    onFit:             () => void;
    onZoom:            (factor: number) => void;
    onNavigate:        () => void;
    onEditOpen:        () => void;
    onEditChange:      () => boolean;
    onEditCommit:      () => void;
    onEditRevert:      () => void;
    onSave:            () => void;
    onLoad:            () => void;
    onInstructions:    () => void;
    onAbout:           () => void;
}

export interface UIHandle {
    setTool:            (t: Tool) => void;
    setOverlayAction:   (action: OverlayAction) => void;
    setSelectionState:  (selectedCount: number, clipboardCount: number, mode: SelectionMoveMode) => void;
    setSelectionMode:   (tool: Tool, mode: SelectionMode, hasSelection: boolean) => void;
    setCanvasFeedback:  (message: string | null) => void;
    setPrimary:         (slot: 1 | 2) => void;
    setColors:          (a: string, b: string) => void;
    setAxes:            (axes: ReadonlyArray<Axis>) => void;
    setRecipes:         (recipes: ReadonlyArray<GridRecipe>, activeId: string | null) => void;
    setRecipeError:     (message: string | null) => void;
    setTransformState:  (hasSelection: boolean, hasTransforms: boolean, liveEnabled: boolean) => void;
    setTransformError:  (message: string | null) => void;
    setHistory:         (undo: boolean, redo: boolean) => void;
    setCrochetProgress: (hasProgress: boolean) => void;
    setCrochetErrors:   (count: number) => void;
    setRecoveryStatus:  (state: "saved" | "recovered" | "failed") => void;
    setDocumentError:   (message: string | null, returnTo?: "load" | "save") => void;
    getCanvasWorkspace: () => CanvasWorkspace;
    setViewState:       (rotation: number, navigating: boolean) => void;
    setEditError:       (message: string | null) => void;
    setEditSummary:     (width: number, height: number, preserved: number, added: number, removed: number) => void;
    syncEditInputs:     (s: PatternState) => void;
    openInstructions:   () => InstructionsView;
}

export interface InstructionOverviewUnit {
    label: string;
    yarn: "A" | "B";
    color: string;
    text: string;
    invalid: boolean;
    start: { x: number; y: number; nextX: number; nextY: number } | null;
}

export interface InstructionsView {
    setProgress: (count: number, total: number) => void;
    endProgress: () => void;
    appendLine:  (line: string) => void;
    appendUnit:  (unit: InstructionOverviewUnit) => void;
    clearText:   () => void;
    clearUnits:  () => void;
    setLivePlan: (units: readonly InstructionOverviewUnit[], completedUnits: number,
                  onProgress: (completedUnits: number) => boolean) => void;
    setErrors:   (count: number) => void;
    alternate:   () => boolean;
    setBusy:     (busy: boolean) => void;
    onAlternate: (cb: () => void) => void;
    onLivePreview: (cb: (completedUnits: number | null) => void) => void;
    onClose:     (cb: () => void) => void;
    close:       () => void;
}

// ─── Mount ────────────────────────────────────────────────────────────────────
export function mountUI(cb: UICallbacks): UIHandle {
    type InspectorPanel = "selection" | "settings" | "transforms" | "pattern";
    const inspectorHost = el("inspector-host");
    const inspectorTitle = el("inspector-title");
    const inspectorPanels: Record<InspectorPanel, HTMLElement> = {
        selection: el("selection-popover"),
        settings: el("hl-popover"),
        transforms: el("sym-popover"),
        pattern: el("edit-pattern-widget"),
    };
    const inspectorTriggers: Record<InspectorPanel, HTMLElement> = {
        selection: el("selection-actions"),
        settings: el("btn-hl-toggle"),
        transforms: el("btn-sym-toggle"),
        pattern: el("btn-edit"),
    };
    let activeInspector: InspectorPanel | null = null;
    let closeInstructionsWorkspace: ((restoreFocus: boolean) => void) | null = null;
    let finishPatternEdit = () => {};
    const enterDesignForCommand = () => closeInstructionsWorkspace?.(false);

    const workspaceShell = document.querySelector<HTMLElement>(".workspace")!;
    const canvasShell = document.querySelector<HTMLElement>(".canvas-area")!;
    const canvas = el("canvas");
    const canvasControls = document.querySelector<HTMLElement>(".canvas-controls")!;
    const canvasStatus = el("status");
    const canvasInstruction = el("instructions-current");
    const authoringPanel = el("authoring-dock");
    const crochetPanel = el("instructions-workspace");
    let canvasWorkspace: CanvasWorkspace = {
        left: 0, top: 0, right: canvas.clientWidth, bottom: canvas.clientHeight,
    };
    const syncCanvasChromeInsets = () => {
        const workspaceRect = workspaceShell.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const wide = matchMedia("(min-width: 64rem)").matches;
        const authoringRect = authoringPanel.hidden ? null : authoringPanel.getBoundingClientRect();
        const crochetRect = crochetPanel.hidden ? null : crochetPanel.getBoundingClientRect();
        const inspectorRect = inspectorHost.hidden ? null : inspectorHost.getBoundingClientRect();
        const modeRect = crochetRect ?? authoringRect;
        const left = wide && modeRect ? modeRect.right - workspaceRect.left : 0;
        const right = wide && inspectorRect ? workspaceRect.right - inspectorRect.left : 0;
        const bottom = wide ? 0 : Math.max(
            modeRect ? workspaceRect.bottom - modeRect.top : 0,
            inspectorRect ? workspaceRect.bottom - inspectorRect.top : 0,
        );
        canvasShell.style.setProperty("--canvas-chrome-left", `${Math.max(0, left)}px`);
        canvasShell.style.setProperty("--canvas-chrome-right", `${Math.max(0, right)}px`);
        canvasShell.style.setProperty("--canvas-chrome-bottom", `${Math.max(0, bottom)}px`);
        const workspace: CanvasWorkspace = {
            left: Math.max(0, left),
            top: 0,
            right: Math.max(0, canvasRect.width - right),
            bottom: Math.max(0, canvasRect.height - bottom),
        };
        for (const chrome of [canvasControls, canvasStatus, canvasInstruction]) {
            if (chrome.getClientRects().length === 0) continue;
            const chromeRect = chrome.getBoundingClientRect();
            const chromeLeft = chromeRect.left - canvasRect.left;
            const chromeRight = chromeRect.right - canvasRect.left;
            if (chromeRight <= workspace.left || chromeLeft >= workspace.right) continue;
            const chromeTop = chromeRect.top - canvasRect.top;
            const chromeBottom = chromeRect.bottom - canvasRect.top;
            if (chromeTop + chromeBottom <= canvasRect.height) {
                workspace.top = Math.max(workspace.top, chromeBottom);
            } else {
                workspace.bottom = Math.min(workspace.bottom, chromeTop);
            }
        }
        canvasWorkspace = workspace;
    };
    const queueCanvasChromeSync = () => requestAnimationFrame(syncCanvasChromeInsets);
    const canvasChromeObserver = new ResizeObserver(queueCanvasChromeSync);
    for (const panel of [workspaceShell, authoringPanel, crochetPanel, inspectorHost]) {
        canvasChromeObserver.observe(panel);
    }
    window.addEventListener("resize", queueCanvasChromeSync);
    syncCanvasChromeInsets();

    function isInspectorOpen(panel: InspectorPanel) {
        return !inspectorHost.hidden && activeInspector === panel;
    }

    function openInspector(panel: InspectorPanel, title: string) {
        if (activeInspector === "pattern" && panel !== "pattern") finishPatternEdit();
        if (activeInspector === "transforms" && panel !== "transforms") {
            cb.onTransformPopoverToggle(false);
        }
        activeInspector = panel;
        inspectorHost.hidden = false;
        inspectorTitle.textContent = title;
        (Object.keys(inspectorPanels) as InspectorPanel[]).forEach(key => {
            inspectorPanels[key].hidden = key !== panel;
            inspectorTriggers[key].setAttribute("aria-expanded", String(key === panel));
        });
        if (panel === "transforms") cb.onTransformPopoverToggle(true);
        syncCanvasChromeInsets();
        queueCanvasChromeSync();
    }

    function focusFirstInspectorControl(panel: InspectorPanel) {
        const controls = inspectorPanels[panel].querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
        );
        Array.from(controls).find(control => control.getClientRects().length > 0)?.focus();
    }

    function closeInspector() {
        const panel = activeInspector;
        if (activeInspector === "pattern") finishPatternEdit();
        if (activeInspector === "transforms") cb.onTransformPopoverToggle(false);
        inspectorHost.hidden = true;
        (Object.keys(inspectorPanels) as InspectorPanel[]).forEach(key => {
            inspectorPanels[key].hidden = true;
            inspectorTriggers[key].setAttribute("aria-expanded", "false");
        });
        activeInspector = null;
        syncCanvasChromeInsets();
        queueCanvasChromeSync();

        const trigger = panel === null ? null : inspectorTriggers[panel];
        const more = el<HTMLButtonElement>("btn-more");
        const activeTool = document.querySelector<HTMLButtonElement>(
            ".authoring-dock .btn[aria-pressed='true']",
        );
        const triggerAvailable = trigger && trigger.getClientRects().length > 0
            && (!(trigger instanceof HTMLButtonElement) || !trigger.disabled);
        const target = triggerAvailable
            ? trigger
            : more.getClientRects().length > 0 ? more : activeTool;
        target?.focus();
    }

    const inspectorClose = el("inspector-close");
    inspectorClose.addEventListener("pointerdown", event => {
        event.preventDefault();
        closeInspector();
    });
    inspectorClose.addEventListener("click", () => {
        if (activeInspector !== null) closeInspector();
    });
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || activeInspector === null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeInspector();
    }, true);

    /* ── Tool buttons ─────────────────────────────────────────────────── */
    const toolButtons: Record<Tool, HTMLButtonElement> = {
        pencil:  el("tool-pencil"),
        fill:    el("tool-fill"),
        eraser:  el("tool-eraser"),
        overlay: el("tool-overlay"),
        invert:  el("tool-invert"),
        select:  el("tool-select"),
        wand:    el("tool-wand"),
        move:    el("tool-move"),
    };
    (Object.keys(toolButtons) as Tool[]).forEach(t => {
        if (t !== "overlay") toolButtons[t].addEventListener("click", () => cb.onTool(t));
    });
    const overlayButtons: Record<OverlayAction, HTMLButtonElement> = {
        place: toolButtons.overlay,
        clear: el("overlay-clear"),
        invert: el("overlay-invert"),
    };
    let overlayAction: OverlayAction = "place";
    let currentTool: Tool = "pencil";
    (Object.keys(overlayButtons) as OverlayAction[]).forEach(action =>
        overlayButtons[action].addEventListener("click", () => cb.onOverlayAction(action))
    );

    function setTool(t: Tool) {
        currentTool = t;
        (Object.keys(toolButtons) as Tool[]).forEach(k => {
            const active = k === t && (k !== "overlay" || overlayAction === "place");
            toolButtons[k].classList.toggle("btn--active", active);
            toolButtons[k].setAttribute("aria-pressed", String(active));
        });
        for (const action of ["clear", "invert"] as const) {
            const active = t === "overlay" && overlayAction === action;
            overlayButtons[action].classList.toggle("btn--active", active);
            overlayButtons[action].setAttribute("aria-pressed", String(active));
        }
    }
    function setOverlayAction(action: OverlayAction) {
        overlayAction = action;
        setTool("overlay");
    }

    /* ── Selection card ──────────────────────────────────────────────── */
    const selectionTrigger = el<HTMLButtonElement>("selection-actions");
    const selectionStatus = el("status-selection");
    const selectionModeControls = el("selection-mode-controls");
    const selectionModeButtons: Record<SelectionMode, HTMLButtonElement> = {
        replace: el("selection-replace"),
        add: el("selection-add"),
        remove: el("selection-subtract"),
    };
    const selectionTitle = el("selection-card-title");
    const selectionClipboard = el("selection-card-clipboard");
    const selectionModes = el("selection-modes");
    const selectionCopy = el<HTMLButtonElement>("selection-copy");
    const selectionCut = el<HTMLButtonElement>("selection-cut");
    const selectionPaste = el<HTMLButtonElement>("selection-paste");
    const selectionDeselect = el<HTMLButtonElement>("selection-deselect");
    const modeButtons: Record<SelectionMoveMode, HTMLButtonElement> = {
        move: el("selection-mode-move"),
        duplicate: el("selection-mode-duplicate"),
        "mask-only": el("selection-mode-area"),
    };

    selectionTrigger.addEventListener("click", event => {
        event.preventDefault();
        if (isInspectorOpen("selection")) closeInspector();
        else {
            openInspector("selection", "Selection");
            focusFirstInspectorControl("selection");
        }
    });
    (Object.keys(selectionModeButtons) as SelectionMode[]).forEach(mode =>
        selectionModeButtons[mode].addEventListener("click", () => cb.onSelectionMode(mode))
    );
    function setSelectionMode(tool: Tool, mode: SelectionMode, hasSelection: boolean) {
        currentTool = tool;
        selectionModeControls.hidden = tool !== "select" && tool !== "wand";
        for (const key of Object.keys(selectionModeButtons) as SelectionMode[]) {
            const button = selectionModeButtons[key];
            const active = key === mode;
            button.classList.toggle("btn--active", active);
            button.setAttribute("aria-pressed", String(active));
            if (key === "remove") button.setAttribute("aria-disabled", String(!hasSelection));
        }
    }
    (Object.keys(modeButtons) as SelectionMoveMode[]).forEach(mode =>
        modeButtons[mode].addEventListener("click", () => {
            cb.onSelectionMoveMode(mode);
        })
    );
    selectionCopy.addEventListener("click", cb.onSelectionCopy);
    selectionCut.addEventListener("click", cb.onSelectionCut);
    selectionPaste.addEventListener("click", cb.onSelectionPaste);
    selectionDeselect.addEventListener("click", cb.onSelectionDeselect);

    function setSelectionState(selectedCount: number, clipboardCount: number, mode: SelectionMoveMode) {
        const hasSelection = selectedCount > 0;
        const hasClip = clipboardCount > 0;
        selectionTrigger.disabled = !hasSelection && !hasClip
            && currentTool !== "select" && currentTool !== "wand";
        if (hasSelection) {
            selectionTrigger.textContent = `Selection · ${selectedCount}`;
            selectionTrigger.setAttribute("aria-label", `Selection actions, ${selectedCount} selected`);
            selectionTrigger.title = `Open actions for ${selectedCount} selected ${selectedCount === 1 ? "cell" : "cells"}`;
            selectionTitle.textContent = `Selection · ${selectedCount} ${selectedCount === 1 ? "cell" : "cells"}`;
            selectionStatus.textContent = `${selectedCount} selected`;
        } else if (hasClip) {
            selectionTrigger.textContent = `Clipboard · ${clipboardCount}`;
            selectionTrigger.setAttribute("aria-label", `Selection actions, clipboard has ${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"}`);
            selectionTrigger.title = `Open clipboard actions for ${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"}`;
            selectionTitle.textContent = "Clipboard";
            selectionStatus.textContent = `${clipboardCount} copied`;
        } else {
            selectionTrigger.textContent = "Selection";
            selectionTrigger.setAttribute("aria-label", "Selection actions");
            selectionStatus.textContent = "";
        }
        selectionStatus.hidden = !hasSelection && !hasClip;
        selectionClipboard.textContent = hasSelection && hasClip
            ? `${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"} copied`
            : "";
        selectionModes.hidden = !hasSelection;
        selectionCopy.hidden = !hasSelection;
        selectionCut.hidden = !hasSelection;
        selectionDeselect.hidden = !hasSelection;
        selectionPaste.disabled = !hasClip;
        selectionPaste.title = hasClip ? "Paste copied cells (Ctrl+V)" : "Nothing copied";
        (Object.keys(modeButtons) as SelectionMoveMode[]).forEach(key => {
            const active = key === mode;
            modeButtons[key].classList.toggle("btn--active", active);
            modeButtons[key].setAttribute("aria-pressed", String(active));
        });
        if (selectionTrigger.disabled && isInspectorOpen("selection")) closeInspector();
    }

    function setCanvasFeedback(message: string | null) {
        const feedback = el("status-feedback");
        feedback.textContent = message ?? "";
        feedback.hidden = message === null;
    }

    /* ── Colour swatches ──────────────────────────────────────────────── */
    const swatchA = el("swatch-a");
    const swatchB = el("swatch-b");
    const colorA  = el<HTMLInputElement>("color-a");
    const colorB  = el<HTMLInputElement>("color-b");

    const openYarnPicker = (slot: 1 | 2) => {
        if (!isInspectorOpen("pattern")) {
            openInspector("pattern", "Pattern");
            cb.onEditOpen();
        }
        const picker = slot === 1 ? colorA : colorB;
        picker.focus();
        picker.click();
    };
    bindLongPress(swatchA, () => cb.onPrimaryColor(1), () => openYarnPicker(1));
    bindLongPress(swatchB, () => cb.onPrimaryColor(2), () => openYarnPicker(2));
    const selectWithKeyboard = (event: KeyboardEvent, slot: 1 | 2) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        cb.onPrimaryColor(slot);
    };
    swatchA.addEventListener("keydown", event => selectWithKeyboard(event, 1));
    swatchB.addEventListener("keydown", event => selectWithKeyboard(event, 2));
    swatchA.addEventListener("dblclick", () => openYarnPicker(1));
    swatchB.addEventListener("dblclick", () => openYarnPicker(2));
    el("swap-yarns").addEventListener("click", cb.onSwapYarns);
    colorA.addEventListener("input",  cb.onColorChange);
    colorB.addEventListener("input",  cb.onColorChange);
    // `change` fires when the picker closes — that's the user's "I'm done"
    // signal and the right moment to push a history snapshot.
    colorA.addEventListener("change", cb.onColorCommit);
    colorB.addEventListener("change", cb.onColorCommit);

    function setPrimary(slot: 1 | 2) {
        swatchA.classList.toggle("swatch--active", slot === 1);
        swatchB.classList.toggle("swatch--active", slot === 2);
        swatchA.setAttribute("aria-pressed", String(slot === 1));
        swatchB.setAttribute("aria-pressed", String(slot === 2));
    }
    function setColors(a: string, b: string) {
        colorA.value = a; colorB.value = b;
        swatchA.style.background = a;
        swatchB.style.background = b;
    }

    /* ── Global Mirror inspector ──────────────────────────────────────── */
    const symList    = el("sym-list");
    const symToggle  = el("btn-sym-toggle");

    symToggle.addEventListener("click", e => {
        e.preventDefault();
        if (isInspectorOpen("transforms")) closeInspector();
        else {
            openInspector("transforms", "Global Mirror");
            focusFirstInspectorControl("transforms");
        }
    });

    SYM_ADD_BUTTONS.forEach(({ id, key }) =>
        el(id).addEventListener("click", () => cb.onAddAxis(key))
    );
    const replicateSelection = el<HTMLButtonElement>("replicate-selection");
    const transformError = el("transform-error");
    replicateSelection.addEventListener("click", cb.onReplicateSelection);
    const liveTransforms = el<HTMLInputElement>("live-transforms");
    liveTransforms.addEventListener("input", () => cb.onLiveMirrorsChange(liveTransforms.checked));

    function setTransformState(hasSelection: boolean, hasTransforms: boolean, liveEnabled: boolean) {
        replicateSelection.disabled = !hasSelection || !hasTransforms;
        replicateSelection.title = !hasTransforms
            ? "Add a Global Mirror axis first"
            : !hasSelection ? "Select cells to apply Global Mirror" : "Apply Global Mirror (T)";
        liveTransforms.checked = liveEnabled;

        const state = !hasTransforms ? "none" : liveEnabled ? "live" : "paused";
        const label = state === "none"
            ? "Global Mirror: no axes configured"
            : state === "live"
                ? "Global Mirror: applying while drawing"
                : "Global Mirror: drawing application paused";
        symToggle.dataset.transformState = state;
        symToggle.title = label;
        symToggle.setAttribute("aria-label", label);
    }

    function setTransformError(message: string | null) {
        transformError.textContent = message ?? "";
        transformError.hidden = message === null;
        if (message !== null && !isInspectorOpen("transforms")) {
            openInspector("transforms", "Global Mirror");
        }
    }

    const recipeList = el("recipe-list");
    const recipeControls = el("recipe-controls");
    const recipeGridControls = el("recipe-grid-controls");
    const recipeRotationControls = el("recipe-rotation-controls");
    const recipeEnabled = el<HTMLInputElement>("recipe-enabled");
    const recipeLeft = el<HTMLInputElement>("recipe-left");
    const recipeRight = el<HTMLInputElement>("recipe-right");
    const recipeUp = el<HTMLInputElement>("recipe-up");
    const recipeDown = el<HTMLInputElement>("recipe-down");
    const recipeGapX = el<HTMLInputElement>("recipe-gap-x");
    const recipeGapXAlternate = el<HTMLInputElement>("recipe-gap-x-alternate");
    const recipeGapXAlternateRow = el("recipe-gap-x-alternate-row");
    const recipeGapY = el<HTMLInputElement>("recipe-gap-y");
    const recipeGapYAlternate = el<HTMLInputElement>("recipe-gap-y-alternate");
    const recipeGapYAlternateRow = el("recipe-gap-y-alternate-row");
    const recipeColumnOffset = el<HTMLInputElement>("recipe-column-offset");
    const recipeRowOffset = el<HTMLInputElement>("recipe-row-offset");
    const recipeCentreX = el<HTMLInputElement>("recipe-centre-x");
    const recipeCentreY = el<HTMLInputElement>("recipe-centre-y");
    const recipeTurns = [90, 180, 270].map(turn => el<HTMLInputElement>(`recipe-turn-${turn}`));
    const recipeError = el("recipe-error");
    let selectedRecipeId: string | null = null;
    let projectedRecipes: ReadonlyArray<GridRecipe> | null = null;
    let projectedActiveRecipeId: string | null | undefined;
    el("recipe-create").addEventListener("click", cb.onCreateRecipe);
    el("recipe-apply").addEventListener("click", cb.onApplyRecipe);
    const recipeInputs = [
        recipeEnabled, recipeLeft, recipeRight, recipeUp, recipeDown,
        recipeGapX, recipeGapXAlternate, recipeGapY, recipeGapYAlternate,
        recipeColumnOffset, recipeRowOffset, recipeCentreX, recipeCentreY,
        ...recipeTurns,
        ...document.querySelectorAll<HTMLInputElement>('[name="recipe-mode"], [name="recipe-column-orientation"], [name="recipe-row-orientation"]'),
    ];
    function syncRecipeSections() {
        const mode = radioValue("recipe-mode");
        const columnMirrored = radioValue("recipe-column-orientation") === "alternate-mirrored";
        const rowMirrored = radioValue("recipe-row-orientation") === "alternate-mirrored";
        recipeGridControls.hidden = mode !== "grid";
        recipeRotationControls.hidden = mode !== "rotation";
        recipeGapXAlternateRow.hidden = !columnMirrored;
        recipeGapYAlternateRow.hidden = !rowMirrored;
    }
    recipeInputs.forEach(input => input.addEventListener("change", event => {
        const id = selectedRecipeId;
        if (!id) return;
        if (event.target === recipeGapX && radioValue("recipe-column-orientation") === "same") {
            recipeGapXAlternate.value = recipeGapX.value;
        }
        if (event.target === recipeGapY && radioValue("recipe-row-orientation") === "same") {
            recipeGapYAlternate.value = recipeGapY.value;
        }
        syncRecipeSections();
        cb.onRecipeChange(id, {
            enabled: recipeEnabled.checked,
            mode: radioValue("recipe-mode") as GridRecipe["mode"],
            left: recipeLeft.valueAsNumber,
            right: recipeRight.valueAsNumber,
            up: recipeUp.valueAsNumber,
            down: recipeDown.valueAsNumber,
            columnSpacing: recipeGapX.valueAsNumber,
            columnSpacingAlternate: recipeGapXAlternate.valueAsNumber,
            rowSpacing: recipeGapY.valueAsNumber,
            rowSpacingAlternate: recipeGapYAlternate.valueAsNumber,
            columnOffset: recipeColumnOffset.valueAsNumber,
            rowOffset: recipeRowOffset.valueAsNumber,
            columnOrientation: radioValue("recipe-column-orientation") as GridRecipe["columnOrientation"],
            rowOrientation: radioValue("recipe-row-orientation") as GridRecipe["rowOrientation"],
            rotationCentreX: recipeCentreX.valueAsNumber,
            rotationCentreY: recipeCentreY.valueAsNumber,
            rotationTurns: recipeTurns.filter(input => input.checked).map(input => Number(input.value)) as GridRecipe["rotationTurns"],
        });
    }));
    function setRecipes(recipes: ReadonlyArray<GridRecipe>, activeId: string | null) {
        if (recipes !== projectedRecipes || activeId !== projectedActiveRecipeId) {
            projectedRecipes = recipes;
            projectedActiveRecipeId = activeId;
            selectedRecipeId = activeId;
            recipeList.replaceChildren(...recipes.map((recipe, index) => {
                const row = document.createElement("div");
                const activate = document.createElement("button");
                activate.className = "btn";
                activate.textContent = `Repeat ${index + 1}`;
                activate.title = "Activate this saved repeat selection";
                activate.dataset.recipeId = recipe.id;
                activate.setAttribute("aria-pressed", String(recipe.id === activeId));
                activate.addEventListener("click", () => cb.onActivateRecipe(recipe.id));
                const remove = document.createElement("button");
                remove.className = "btn btn--icon"; remove.textContent = "×";
                remove.setAttribute("aria-label", `Delete repeat ${index + 1}`);
                remove.title = `Delete repeat ${index + 1}`;
                remove.addEventListener("click", () => cb.onDeleteRecipe(recipe.id));
                row.append(activate, remove);
                return row;
            }));
        }
        const active = activeId === null ? null : recipes.find(recipe => recipe.id === activeId) ?? null;
        recipeControls.hidden = active === null;
        if (!active) return;
        recipeEnabled.checked = active.enabled;
        setRadio("recipe-mode", active.mode);
        recipeLeft.value = String(active.left);
        recipeRight.value = String(active.right);
        recipeUp.value = String(active.up);
        recipeDown.value = String(active.down);
        recipeGapX.value = String(active.columnSpacing);
        recipeGapXAlternate.value = String(active.columnSpacingAlternate);
        recipeGapY.value = String(active.rowSpacing);
        recipeGapYAlternate.value = String(active.rowSpacingAlternate);
        recipeColumnOffset.value = String(active.columnOffset);
        recipeRowOffset.value = String(active.rowOffset);
        setRadio("recipe-column-orientation", active.columnOrientation);
        setRadio("recipe-row-orientation", active.rowOrientation);
        recipeCentreX.value = String(active.rotationCentreX);
        recipeCentreY.value = String(active.rotationCentreY);
        recipeTurns.forEach(input => { input.checked = active.rotationTurns.includes(Number(input.value) as 90 | 180 | 270); });
        syncRecipeSections();
    }
    function setRecipeError(message: string | null) { recipeError.textContent = message ?? ""; recipeError.hidden = message === null; }


    function formatPosition(a: Axis): string {
        switch (a.kind) {
            case "V":  return `x=${a.x}`;
            case "H":  return `y=${a.y}`;
            case "C":  return `(${a.x}, ${a.y})`;
            case "D1":
            case "D2": return `c=${a.c}`;
        }
    }
    function axisField(a: Axis, coordinate: "x" | "y" | "c"): number {
        if (coordinate === "x" && "x" in a) return a.x;
        if (coordinate === "y" && "y" in a) return a.y;
        if (coordinate === "c" && "c" in a) return a.c;
        throw new Error("Axis coordinate does not match its kind.");
    }
    const KIND_GLYPH: Record<SymKey, string> = { V: "↔", H: "↕", C: "⊕", D1: "╲", D2: "╱" };
    const KIND_NAME: Record<SymKey, string> = {
        V: "vertical",
        H: "horizontal",
        C: "central",
        D1: "diagonal",
        D2: "anti-diagonal",
    };

    function setAxes(axes: ReadonlyArray<Axis>) {
        // Axis lists stay small in normal editor use, so rebuilding avoids
        // stateful DOM diffing without affecting interaction latency.
        symList.replaceChildren(...axes.map((a, index) => {
            const row = document.createElement("div");
            row.className = "sym-list-row" + (a.active ? "" : " is-inactive");
            row.dataset.axisId = a.id;

            const kind = document.createElement("span");
            kind.className = "sym-list-row__kind";
            kind.textContent = KIND_GLYPH[a.kind];

            const pos = document.createElement("div");
            pos.className = "sym-list-row__pos";
            const summary = document.createElement("span");
            summary.textContent = formatPosition(a);
            pos.append(summary);

            const fields = document.createElement("div");
            fields.className = "sym-list-row__fields";
            const coordinates: ("x" | "y" | "c")[] = a.kind === "C"
                ? ["x", "y"]
                : a.kind === "H" ? ["y"] : a.kind === "V" ? ["x"] : ["c"];
            for (const coordinate of coordinates) {
                const label = document.createElement("label");
                label.textContent = coordinate;
                const input = document.createElement("input");
                input.type = "number";
                input.step = coordinate === "c" ? "1" : "0.5";
                input.value = String(axisField(a, coordinate));
                input.setAttribute("aria-label", `${KIND_NAME[a.kind][0].toUpperCase()}${KIND_NAME[a.kind].slice(1)} axis ${coordinate} position`);
                input.addEventListener("change", () => {
                    const value = input.valueAsNumber;
                    if (!Number.isFinite(value)) {
                        input.value = String(axisField(a, coordinate));
                        return;
                    }
                    const updated = cb.onAxisPosition(a.id, { [coordinate]: value });
                    if (!updated) return;
                    input.value = String(axisField(updated, coordinate));
                    summary.textContent = formatPosition(updated);
                    const updatedDescription = `${KIND_NAME[updated.kind]} axis at ${formatPosition(updated)}`;
                    const toggle = row.querySelector<HTMLButtonElement>("[data-axis-action='toggle']")!;
                    const del = row.querySelector<HTMLButtonElement>("[data-axis-action='delete']")!;
                    toggle.title = `${updated.active ? "Disable" : "Enable"} ${updatedDescription}`;
                    toggle.setAttribute("aria-label", toggle.title);
                    del.title = `Delete ${updatedDescription}`;
                    del.setAttribute("aria-label", del.title);
                });
                label.append(input);
                fields.append(label);
            }
            pos.append(fields);

            const description = `${KIND_NAME[a.kind]} axis at ${formatPosition(a)}`;

            const toggle = document.createElement("button");
            toggle.className = "btn btn--icon";
            toggle.type = "button";
            toggle.title = `${a.active ? "Disable" : "Enable"} ${description}`;
            toggle.setAttribute("aria-label", toggle.title);
            toggle.dataset.axisAction = "toggle";
            toggle.textContent = a.active ? "●" : "○";
            toggle.addEventListener("click", () => {
                cb.onToggleAxis(a.id);
                const replacement = Array.from(symList.children)
                    .find(child => (child as HTMLElement).dataset.axisId === a.id);
                replacement?.querySelector<HTMLButtonElement>("[data-axis-action='toggle']")?.focus();
            });

            const del = document.createElement("button");
            del.className = "btn btn--icon";
            del.type = "button";
            del.title = `Delete ${description}`;
            del.setAttribute("aria-label", del.title);
            del.dataset.axisAction = "delete";
            del.textContent = "×";
            del.addEventListener("click", () => {
                const fallback = axes[index + 1] ?? axes[index - 1];
                cb.onDeleteAxis(a.id);
                if (fallback) {
                    const replacement = Array.from(symList.children)
                        .find(child => (child as HTMLElement).dataset.axisId === fallback.id);
                    replacement?.querySelector<HTMLButtonElement>("[data-axis-action='delete']")?.focus();
                } else {
                    const addButton = SYM_ADD_BUTTONS.find(button => button.key === a.kind)!;
                    el<HTMLButtonElement>(addButton.id).focus();
                }
            });

            row.append(kind, pos, toggle, del);
            return row;
        }));
    }
    /* ── Settings inspector ───────────────────────────────────────────── */
    el("btn-hl-toggle").addEventListener("click", e => {
        e.preventDefault();
        if (isInspectorOpen("settings")) closeInspector();
        else {
            openInspector("settings", "Settings");
            focusFirstInspectorControl("settings");
        }
    });
    el<HTMLInputElement>("hl-opacity")        .addEventListener("input",  cb.onHighlightChange);
    el<HTMLInputElement>("danger-color")      .addEventListener("input",  cb.onDangerColorChange);
    el<HTMLInputElement>("accent-color")      .addEventListener("input",  cb.onAccentColorChange);
    el("danger-color-reset").addEventListener("click", cb.onDangerColorReset);
    el("accent-color-reset").addEventListener("click", cb.onAccentColorReset);
    el<HTMLInputElement>("labels-on")   .addEventListener("change", cb.onLabelsVisibleChange);
    el<HTMLInputElement>("lock-invalid").addEventListener("change", cb.onLockInvalidChange);
    el("settings-about").addEventListener("click", () => {
        closeInspector();
        cb.onAbout();
    });

    /* ── History and canvas view ─────────────────────────────────────── */
    el("btn-undo").addEventListener("click", () => {
        enterDesignForCommand();
        cb.onUndo();
    });
    el("btn-redo").addEventListener("click", () => {
        enterDesignForCommand();
        cb.onRedo();
    });
    el("rotate-cw") .addEventListener("click", () => cb.onRotate( 45));
    el("rotate-ccw").addEventListener("click", () => cb.onRotate(-45));
    el("view-rotation-reset").addEventListener("click", cb.onResetRotation);
    el("view-fit").addEventListener("click", cb.onFit);
    el("view-zoom-in").addEventListener("click", () => cb.onZoom(1.15));
    el("view-zoom-out").addEventListener("click", () => cb.onZoom(1 / 1.15));
    el("view-navigate").addEventListener("click", cb.onNavigate);

    function setHistory(canU: boolean, canR: boolean) {
        el<HTMLButtonElement>("btn-undo").disabled = !canU;
        el<HTMLButtonElement>("btn-redo").disabled = !canR;
    }

    function setRecoveryStatus(state: "saved" | "recovered" | "failed") {
        const status = el("recovery-status");
        status.dataset.state = state;
        status.hidden = state === "saved";
        status.textContent = state === "failed"
            ? "Recovery failed"
            : state === "recovered" ? "Recovered" : "";
        status.title = state === "failed"
            ? "Browser recovery could not be updated; recent changes may be lost if this tab closes."
            : "Browser recovery is current. Save creates a separate editable pattern file.";
    }

    let documentErrorReturn: "load" | "save" = "load";
    function setDocumentError(message: string | null, returnTo: "load" | "save" = "load") {
        const error = el("document-error");
        if (message !== null) documentErrorReturn = returnTo;
        el("document-error-message").textContent = message ?? "";
        error.hidden = message === null;
    }
    el("document-error-dismiss").addEventListener("click", () => {
        setDocumentError(null);
        const action = el<HTMLButtonElement>(documentErrorReturn === "save" ? "btn-save" : "btn-load");
        const more = el<HTMLButtonElement>("btn-more");
        (action.getClientRects().length > 0 ? action : more).focus();
    });

    function setViewState(rotation: number, navigating: boolean) {
        const navigate = el<HTMLButtonElement>("view-navigate");
        navigate.classList.toggle("btn--active", navigating);
        navigate.setAttribute("aria-pressed", String(navigating));
        el("canvas").classList.toggle("canvas--navigate", navigating);
        const normalized = ((Math.round(rotation) % 360) + 360) % 360;
        const signed = normalized > 180 ? normalized - 360 : normalized;
        const angle = `${signed < 0 ? "−" : ""}${Math.abs(signed)}°`;
        const reset = el<HTMLButtonElement>("view-rotation-reset");
        reset.disabled = signed === 0;
        reset.setAttribute("aria-label", signed === 0 ? "Reset view orientation" : `Reset view orientation from ${angle}`);
        reset.title = signed === 0 ? "Reset view orientation" : `Reset view orientation from ${angle}`;
        el<HTMLElement>("view-orientation-arrow").style.transform = `rotate(${rotation}deg)`;
    }

    /* ── Save / load / Instructions ─────────────────────────────────── */
    el("btn-save")  .addEventListener("click", cb.onSave);
    el("btn-load").addEventListener("click", () => {
        enterDesignForCommand();
        cb.onLoad();
    });

    /* ── Pattern inspector ────────────────────────────────────────────── */
    const editWidget = el("edit-pattern-widget");
    const btnEdit    = el<HTMLButtonElement>("btn-edit");
    const editError  = el("edit-error");
    const editSummary = el("edit-summary");
    let editValid = true;
    let editPreviewActive = false;
    let skipPatternChange = false;

    function setEditError(message: string | null) {
        editError.textContent = message ?? "";
        editError.hidden = message === null;
        editValid = message === null;
    }

    function setEditSummary(width: number, height: number, _preserved: number, added: number, removed: number) {
        const changes = [
            added > 0 ? `${added} cell${added === 1 ? "" : "s"} added` : null,
            removed > 0 ? `${removed} cell${removed === 1 ? "" : "s"} removed` : null,
        ].filter((change): change is string => change !== null);
        editSummary.textContent = changes.length > 0
            ? `${width} × ${height} cells · ${changes.join(" · ")}`
            : "";
        editSummary.hidden = changes.length === 0;
    }

    finishPatternEdit = () => {
        if (!editPreviewActive) return;
        skipPatternChange = true;
        queueMicrotask(() => { skipPatternChange = false; });
        if (editValid) cb.onEditCommit();
        else cb.onEditRevert();
        editPreviewActive = false;
    };
    btnEdit.addEventListener("click", e => {
        e.preventDefault();
        if (isInspectorOpen("pattern")) {
            closeInspector();
            return;
        }
        openInspector("pattern", "Pattern");
        cb.onEditOpen();
        focusFirstInspectorControl("pattern");
    });

    document.addEventListener("pointerdown", e => {
        if (!isInspectorOpen("pattern") || editWidget.contains(e.target as Node)) return;
        if ((e.target as Element).closest?.("#inspector-close")) return;
        finishPatternEdit();
    }, true);

    let editOpenState: PatternState | null = null;

    // Row and centre-out cells have no stable coordinate mapping, so a mode
    // change uses the same natural-colour reset as the explicit reset action.
    function refreshWipeAvailability() {
        if (!editOpenState) return;
        const newMode = radioValue("edit-mode");
        const force = newMode !== editOpenState.mode;
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        if (force) wipeEl.checked = true;
        wipeEl.disabled = force;
    }

    function applyAndCommitPatternEdit() {
        editPreviewActive = true;
        if (cb.onEditChange()) {
            cb.onEditCommit();
            enterDesignForCommand();
        } else cb.onEditRevert();
        editPreviewActive = false;
    }

    document.querySelectorAll<HTMLInputElement>('[name="edit-mode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const mode = radio.value;
            el("edit-row-controls")  .hidden = mode !== "row";
            el("edit-round-controls").hidden = mode !== "round";
            refreshWipeAvailability();
            if (isInspectorOpen("pattern")) applyAndCommitPatternEdit();
        });
    });
    document.querySelectorAll<HTMLInputElement>('[name="edit-submode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            if (isInspectorOpen("pattern")) applyAndCommitPatternEdit();
        });
    });
    const EDIT_INPUTS: { id: string; min: number }[] = [
        { id: "edit-width",        min: 2 },
        { id: "edit-height",       min: 2 },
        { id: "edit-inner-width",  min: 0 },
        { id: "edit-inner-height", min: 0 },
        { id: "edit-rounds",       min: 1 },
    ];
    EDIT_INPUTS.forEach(({ id, min }) => {
        const preview = () => {
            refreshWipeAvailability();
            if (isInspectorOpen("pattern")) {
                editPreviewActive = true;
                if (cb.onEditChange()) enterDesignForCommand();
            }
        };
        el(id).addEventListener("input", preview);
        el(id).addEventListener("change", () => {
            if (skipPatternChange) {
                skipPatternChange = false;
                return;
            }
            clampInputDisplay(id, min);
            refreshWipeAvailability();
            if (isInspectorOpen("pattern")) applyAndCommitPatternEdit();
        });
    });
    el("edit-reset").addEventListener("click", () => {
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        wipeEl.checked = true;
        if (isInspectorOpen("pattern")) applyAndCommitPatternEdit();
        wipeEl.checked = false;
        refreshWipeAvailability();
    });

    function syncEditInputs(s: PatternState) {
        editOpenState = s;
        setEditError(null);
        setRadio("edit-mode", s.mode);
        el("edit-row-controls")  .hidden = s.mode !== "row";
        el("edit-round-controls").hidden = s.mode !== "round";
        if (s.mode === "row") {
            el<HTMLInputElement>("edit-width") .value = String(s.canvasWidth);
            el<HTMLInputElement>("edit-height").value = String(s.canvasHeight);
        } else {
            const innerW = s.virtualWidth  - s.rounds * 2;
            const innerH = s.virtualHeight - s.rounds * 2;
            const sub = s.offsetX === 0 && s.offsetY === 0
                ? "full"
                : s.canvasWidth === s.virtualWidth ? "half" : "quarter";
            setRadio("edit-submode", sub);
            el<HTMLInputElement>("edit-inner-width") .value = String(innerW);
            el<HTMLInputElement>("edit-inner-height").value = String(innerH);
            el<HTMLInputElement>("edit-rounds")      .value = String(s.rounds);
        }
        // Every committed change starts the next field from preservation.
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        wipeEl.checked = false;
        refreshWipeAvailability();
        setEditSummary(s.canvasWidth, s.canvasHeight, s.canvasWidth * s.canvasHeight, 0, 0);
    }

    /* ── Crochet workspace ──────────────────────────────────────────── */
    const instructions   = el("instructions-workspace");
    const unitsList      = el<HTMLOListElement>("instructions-units");
    const exportProgress = el("export-progress");
    const alternateChk   = el<HTMLInputElement>("alternate");
    const liveUnavailable = el("instructions-live-unavailable");
    const liveProgress   = el("instructions-live-progress");
    const liveSaveWarning = el("instructions-live-save-warning");
    const currentInstruction = el("instructions-current");
    const currentInstructionText = el("instructions-current-text");
    const liveBack       = el<HTMLButtonElement>("instructions-live-back");
    const liveForward    = el<HTMLButtonElement>("instructions-live-forward");
    const exportActionStatus = el("export-action-status");
    const instructionErrors = el("instructions-errors");
    const crochetMode    = el<HTMLButtonElement>("btn-export");
    let hasCrochetProgress = false;
    let crochetErrors = 0;
    const setCrochetMode = (open: boolean) => {
        const label = open
            ? "Back to Design"
            : hasCrochetProgress ? "Continue Crocheting" : "Begin Crocheting";
        const errors = crochetErrors === 1 ? "1 invalid stitch" : `${crochetErrors} invalid stitches`;
        crochetMode.textContent = !open && crochetErrors ? `${label} !` : label;
        crochetMode.title = (open
            ? "Return to pattern design"
            : hasCrochetProgress ? "Resume crochet progress" : "Start crochet instructions")
            + (!open && crochetErrors ? ` — ${errors}` : "");
        crochetMode.setAttribute("aria-label", `${label}${!open && crochetErrors ? ` — ${errors}` : ""}`);
        crochetMode.classList.toggle("btn--danger", !open && crochetErrors > 0);
        crochetMode.setAttribute("aria-pressed", String(open));
    };
    crochetMode.addEventListener("click", () => {
        if (closeInstructionsWorkspace) closeInstructionsWorkspace(true);
        else cb.onInstructions();
    });
    let instructionText = "";
    el("export-copy").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(instructionText);
            exportActionStatus.textContent = "Copied";
        } catch {
            exportActionStatus.textContent = "Copy failed";
        }
    });

    function openInstructions(): InstructionsView {
        const altListeners: (() => void)[] = [];
        const closeListeners: (() => void)[] = [];
        const livePreviewListeners: ((completedUnits: number | null) => void)[] = [];
        const unitElements: HTMLButtonElement[] = [];
        let liveUnits: readonly InstructionOverviewUnit[] = [];
        let liveCompleted = 0;
        let liveProgressChanged = (_completedUnits: number) => true;
        let isBusy = true;
        const inspectorWasHidden = inspectorHost.hidden;
        const onAlt = () => altListeners.forEach(f => f());
        alternateChk.addEventListener("change", onAlt);
        canvas.removeAttribute("aria-describedby");
        canvas.setAttribute("aria-label", "Crochet progress chart");
        instructions.hidden = false;
        inspectorHost.hidden = true;
        document.body.classList.add("crochet-mode");
        setCrochetMode(true);
        syncCanvasChromeInsets();
        queueCanvasChromeSync();
        instructions.focus();

        const workKind = () => liveUnits[0]?.label.startsWith("Round") ? "round" : "row";
        const renderCrochet = () => {
            const total = liveUnits.length;
            const current = total === 0 ? 0 : Math.min(liveCompleted + 1, total);
            liveProgress.textContent = `${current} / ${total}`;
            liveBack.disabled = isBusy || liveCompleted === 0;
            liveBack.setAttribute("aria-label", `Back one ${workKind()}`);
            liveBack.title = `Back one ${workKind()}`;
            liveForward.disabled = isBusy || total === 0 || liveCompleted >= total - 1;
            liveForward.setAttribute("aria-label", `Forward one ${workKind()}`);
            liveForward.title = `Forward one ${workKind()}`;
            unitElements.forEach((item, index) => {
                item.disabled = isBusy;
                item.classList.toggle("instructions-unit--complete", index < liveCompleted);
                if (index === liveCompleted) {
                    item.setAttribute("aria-current", "step");
                } else {
                    item.removeAttribute("aria-current");
                }
            });
            const currentUnit = liveUnits[liveCompleted] ?? null;
            currentInstruction.hidden = currentUnit === null;
            if (currentUnit) {
                currentInstructionText.textContent =
                    currentUnit.text.slice(currentUnit.text.indexOf(":") + 1).trim();
            }
            livePreviewListeners.forEach(f => f(current));
            unitElements[Math.min(liveCompleted, total - 1)]?.scrollIntoView({ block: "nearest" });
        };
        const refreshCrochetAvailability = () => {
            if (!isBusy && liveUnits.length === 0) {
                liveUnavailable.textContent = "No instructions";
                liveUnavailable.hidden = false;
            } else {
                liveUnavailable.hidden = true;
            }
            liveBack.disabled = isBusy || liveCompleted === 0;
            liveForward.disabled = isBusy || liveUnits.length === 0
                || liveCompleted >= liveUnits.length - 1;
        };
        liveBack.onclick = () => {
            if (liveCompleted === 0) return;
            liveCompleted--;
            liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            renderCrochet();
        };
        liveForward.onclick = () => {
            if (liveCompleted >= liveUnits.length - 1) return;
            liveCompleted++;
            liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            renderCrochet();
        };

        const close = (restoreFocus = true) => {
            if (closeInstructionsWorkspace !== close) return;
            closeInstructionsWorkspace = null;
            alternateChk.removeEventListener("change", onAlt);
            liveBack.onclick = null;
            liveForward.onclick = null;
            canvas.setAttribute("aria-label", "Editable pattern chart");
            instructions.hidden = true;
            if (inspectorHost.hidden) inspectorHost.hidden = inspectorWasHidden;
            document.body.classList.remove("crochet-mode");
            setCrochetMode(false);
            syncCanvasChromeInsets();
            queueCanvasChromeSync();
            closeListeners.forEach(f => f());
            if (restoreFocus) crochetMode.focus();
        };
        closeInstructionsWorkspace = close;

        return {
            setProgress: (count, total) => {
                exportProgress.hidden = false;
                exportProgress.textContent = `Generating… ${count} / ${total}`;
            },
            endProgress: () => { exportProgress.hidden = true; },
            appendLine: (line) => {
                instructionText += (instructionText ? "\n" : "") + line;
            },
            appendUnit: (unit) => {
                const row = document.createElement("li");
                const item = document.createElement("button");
                item.type = "button";
                item.disabled = isBusy;
                item.className = "instructions-unit";
                item.classList.toggle("instructions-unit--invalid", unit.invalid);
                item.setAttribute("aria-label", `${unit.label}, Yarn ${unit.yarn}${unit.invalid ? ", contains invalid stitches" : ""}`);
                item.title = `Go to ${unit.label}, Yarn ${unit.yarn}${unit.invalid ? " · contains invalid stitches" : ""}`;
                const index = unitElements.length;
                item.onclick = () => {
                    if (isBusy || index >= liveUnits.length) return;
                    liveCompleted = index;
                    liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
                    renderCrochet();
                };
                const meta = document.createElement("span");
                meta.className = "instructions-unit-number";
                meta.textContent = unit.label.replace(/^\D+/, "");
                meta.style.backgroundColor = unit.color;
                meta.style.color = instructionBadgeTextColor(unit.color);
                const text = document.createElement("code");
                text.textContent = unit.text.slice(unit.text.indexOf(":") + 1).trim();
                item.append(meta, text);
                row.append(item);
                unitsList.append(row);
                unitElements.push(item);
            },
            clearText: () => {
                instructionText = "";
                exportActionStatus.textContent = "";
            },
            clearUnits: () => {
                unitsList.replaceChildren();
                unitElements.length = 0;
                liveUnits = [];
                liveCompleted = 0;
                currentInstruction.hidden = true;
                refreshCrochetAvailability();
            },
            setLivePlan: (units, completedUnits, onProgress) => {
                liveUnits = units;
                liveCompleted = units.length === 0
                    ? 0
                    : Math.min(Math.max(0, completedUnits), units.length - 1);
                liveProgressChanged = onProgress;
                liveSaveWarning.hidden = true;
                refreshCrochetAvailability();
                renderCrochet();
            },
            setErrors: (count) => {
                instructionErrors.textContent = count === 1 ? "1 error" : `${count} errors`;
                instructionErrors.hidden = count === 0;
            },
            alternate: () => alternateChk.checked,
            setBusy: (busy) => {
                isBusy = busy;
                el<HTMLButtonElement>("export-copy").disabled = busy;
                refreshCrochetAvailability();
                renderCrochet();
            },
            onAlternate: (f) => altListeners.push(f),
            onLivePreview: (f) => livePreviewListeners.push(f),
            onClose:     (f) => closeListeners.push(f),
            close: () => close(true),
        };
    }

    mountToolbarLayout();

    return {
        setTool, setOverlayAction, setSelectionState, setSelectionMode, setCanvasFeedback, setPrimary, setColors, setAxes, setRecipes, setRecipeError,
        setTransformState, setTransformError,
        setHistory, setCrochetProgress: (hasProgress) => {
            hasCrochetProgress = hasProgress;
            if (!closeInstructionsWorkspace) setCrochetMode(false);
        }, setCrochetErrors: (count) => {
            crochetErrors = count;
            if (!closeInstructionsWorkspace) setCrochetMode(false);
        }, setRecoveryStatus, setDocumentError, getCanvasWorkspace: () => {
            syncCanvasChromeInsets();
            return canvasWorkspace;
        },
        setViewState, setEditError, setEditSummary,
        syncEditInputs,
        openInstructions,
    };
}

// ─── Toolbar layout ──────────────────────────────────────────────────────────
function mountToolbarLayout() {
    const documentBar = el("document-bar");
    const modeGroup = document.querySelector(".g-mode") as HTMLElement;
    const fileGroup = document.querySelector(".g-file") as HTMLElement;
    const viewGroup = document.querySelector(".g-hlrot") as HTMLElement;
    const moreButton = el<HTMLButtonElement>("btn-more");
    const morePopover = el("more-popover");
    const moreActions = el("more-actions");
    const fileActions = [el("btn-edit"), el("btn-load"), el("btn-save")];
    const viewActions = [el("btn-hl-toggle")];
    const compactActions = [...fileActions, ...viewActions] as HTMLButtonElement[];
    let compact = false;
    let compactBelow = 0;

    moreButton.addEventListener("click", e => {
        e.preventDefault();
        if (morePopover.matches(":popover-open")) morePopover.hidePopover();
        else {
            positionPopover(morePopover, moreButton, "left");
            morePopover.showPopover();
            compactActions.find(button => !button.disabled)?.focus();
        }
    });
    morePopover.addEventListener("toggle", e => {
        moreButton.setAttribute("aria-expanded", String((e as ToggleEvent).newState === "open"));
    });
    moreActions.addEventListener("click", e => {
        if ((e.target as Element).closest("button") && morePopover.matches(":popover-open"))
            morePopover.hidePopover();
    });
    morePopover.addEventListener("keydown", e => {
        if (e.key === "Tab") {
            morePopover.hidePopover();
            return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const enabled = compactActions.filter(button => !button.disabled);
        const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
        const target = e.key === "Home" ? enabled[0]
            : e.key === "End" ? enabled.at(-1)!
            : enabled[(current + (e.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length];
        target.focus();
    });

    function setCompact(next: boolean) {
        if (compact === next) return;
        compact = next;
        if (compact) {
            for (const button of compactActions) {
                button.setAttribute("role", "menuitem");
                button.tabIndex = -1;
            }
            moreActions.append(...fileActions, ...viewActions);
            moreButton.hidden = false;
        } else {
            fileGroup.prepend(...fileActions);
            viewGroup.append(...viewActions);
            for (const button of compactActions) {
                button.removeAttribute("role");
                button.tabIndex = 0;
            }
            moreButton.hidden = true;
            if (morePopover.matches(":popover-open")) morePopover.hidePopover();
        }
    }

    function measure() {
        setCompact(false);
        documentBar.classList.remove("document-bar--compact");
        const cs = getComputedStyle(documentBar);
        const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const gap     = parseFloat(cs.columnGap) || 0;
        compactBelow = padding + gap * 2 + modeGroup.offsetWidth + fileGroup.offsetWidth + viewGroup.offsetWidth;
    }

    function applyLayout() {
        const useCompact = window.innerWidth < compactBelow;
        setCompact(useCompact);
        documentBar.classList.toggle("document-bar--compact", useCompact);
    }

    function update() { measure(); applyLayout(); }

    update();
    window.addEventListener("resize", applyLayout);

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(update);
    }
}

// Position a popover under its anchor button using fixed coords.
// (anchor-positioning CSS is still rolling out; this works everywhere.)
function positionPopover(pop: HTMLElement, anchor: HTMLElement, align: "left" | "right") {
    const r = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top      = `${r.bottom + 4}px`;
    if (align === "left") {
        pop.style.left  = `${r.left}px`;
        pop.style.right = "auto";
    } else {
        pop.style.right = `${window.innerWidth - r.right}px`;
        pop.style.left  = "auto";
    }
}
