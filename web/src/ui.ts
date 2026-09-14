import { Tool, SymKey, PatternState, Axis, RepeatGrid } from "@mosaic/logic/types";
import { el, setRadio, clampInputDisplay, radioValue } from "./dom";

export type SelectionMoveMode = "move" | "duplicate" | "mask-only";

// ─── Long-press / click helper (works for mouse, pen, touch) ──────────────────
function bindLongPress(target: HTMLElement, onClick: () => void, onLong: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;

    const cancel = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

    target.addEventListener("pointerdown", e => {
        startX = e.clientX; startY = e.clientY;
        cancel();
        timer = setTimeout(() => { timer = null; onLong(); }, 500);
    });
    target.addEventListener("pointermove", e => {
        if (timer === null) return;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) cancel();
    });
    target.addEventListener("pointerup", () => {
        if (timer !== null) { cancel(); onClick(); }
    });
    target.addEventListener("pointercancel", cancel);
    target.addEventListener("pointerleave",  cancel);
}

// ─── Mirror & Repeat button ids ───────────────────────────────────────────────
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
    onMaskMove:        () => void;
    onSelectionMoveMode: (mode: SelectionMoveMode) => void;
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
    onRepeatInput:     () => void;
    onRepeatCommit:    () => void;
    onLiveTransformsChange: (enabled: boolean) => void;
    onTransformPopoverToggle: (open: boolean) => void;
    onReplicateSelection: () => void;
    onHighlightChange:        () => void;
    onInvalidIntensityChange: () => void;
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
    onEditChange:      () => void;
    onEditApply:       () => void;
    onEditCancel:      () => void;
    onSave:            () => void;
    onLoad:            () => void;
    onInstructions:    () => void;
}

export interface UIHandle {
    setTool:            (t: Tool) => void;
    setMaskMove:        (active: boolean) => void;
    setSelectionState:  (selectedCount: number, clipboardCount: number, mode: SelectionMoveMode) => void;
    setCanvasFeedback:  (message: string | null) => void;
    setPrimary:         (slot: 1 | 2) => void;
    setColors:          (a: string, b: string) => void;
    setAxes:            (axes: ReadonlyArray<Axis>) => void;
    readRepeatGrid:     () => RepeatGrid;
    setRepeatGrid:      (repeat: RepeatGrid) => void;
    setRepeatError:     (message: string | null) => void;
    setTransformState:  (hasSelection: boolean, hasTransforms: boolean, liveEnabled: boolean) => void;
    setTransformError:  (message: string | null) => void;
    setHistory:         (undo: boolean, redo: boolean) => void;
    setRecoveryStatus:  (state: "saved" | "recovered" | "failed") => void;
    setViewState:       (zoom: number, rotation: number, navigating: boolean) => void;
    setEditError:       (message: string | null) => void;
    syncEditInputs:     (s: PatternState) => void;
    closeEdit:          () => void;
    openInstructions:   () => InstructionsView;
}

export interface InstructionOverviewUnit {
    label: string;
    yarn: "A" | "B";
    text: string;
    workedCoords: number[];
}

export interface InstructionIssue {
    x: number;
    y: number;
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
    setBlockers: (issues: InstructionIssue[]) => void;
    alternate:   () => boolean;
    setBusy:     (busy: boolean) => void;
    onAlternate: (cb: () => void) => void;
    onUnitFocus: (cb: (coords: number[], label: string) => void) => void;
    onIssueFocus: (cb: (issue: InstructionIssue) => void) => void;
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
        selection: el("status-selection"),
        settings: el("btn-hl-toggle"),
        transforms: el("btn-sym-toggle"),
        pattern: el("btn-edit"),
    };
    let activeInspector: InspectorPanel | null = null;

    function isInspectorOpen(panel: InspectorPanel) {
        return !inspectorHost.hidden && activeInspector === panel;
    }

    function openInspector(panel: InspectorPanel, title: string) {
        if (activeInspector === "pattern" && panel !== "pattern") return;
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
    }

    function closeInspector(commitPattern = false) {
        const panel = activeInspector;
        if (activeInspector === "pattern" && !commitPattern) cb.onEditCancel();
        if (activeInspector === "transforms") cb.onTransformPopoverToggle(false);
        inspectorHost.hidden = true;
        (Object.keys(inspectorPanels) as InspectorPanel[]).forEach(key => {
            inspectorPanels[key].hidden = true;
            inspectorTriggers[key].setAttribute("aria-expanded", "false");
        });
        activeInspector = null;

        const trigger = panel === null ? null : inspectorTriggers[panel];
        const more = el<HTMLButtonElement>("btn-more");
        const activeTool = document.querySelector<HTMLButtonElement>(
            ".authoring-dock .btn[aria-pressed='true']",
        );
        const target = trigger && trigger.getClientRects().length > 0
            ? trigger
            : more.getClientRects().length > 0 ? more : activeTool;
        target?.focus();
    }

    el("inspector-close").addEventListener("click", () => closeInspector());
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || activeInspector === null || activeInspector === "pattern") return;
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
    (Object.keys(toolButtons) as Tool[]).forEach(t =>
        toolButtons[t].addEventListener("click", () => cb.onTool(t))
    );
    const maskMove = el<HTMLButtonElement>("move-mask");
    maskMove.addEventListener("click", cb.onMaskMove);

    function setTool(t: Tool) {
        (Object.keys(toolButtons) as Tool[]).forEach(k => {
            const active = k === t;
            toolButtons[k].classList.toggle("btn--active", active);
            toolButtons[k].setAttribute("aria-pressed", String(active));
        });
    }
    function setMaskMove(active: boolean) {
        maskMove.classList.toggle("btn--active", active);
        maskMove.setAttribute("aria-pressed", String(active));
    }

    /* ── Selection card ──────────────────────────────────────────────── */
    const selectionTrigger = el<HTMLButtonElement>("status-selection");
    const selectionTitle = el("selection-card-title");
    const selectionClipboard = el("selection-card-clipboard");
    const selectionModes = el("selection-modes");
    const selectionCopy = el<HTMLButtonElement>("selection-copy");
    const selectionCut = el<HTMLButtonElement>("selection-cut");
    const selectionPaste = el<HTMLButtonElement>("selection-paste");
    const selectionDeselect = el<HTMLButtonElement>("selection-deselect");
    const selectionDeselectHelp = el("selection-deselect-help");
    const selectionPasteHelp = el("selection-paste-help");
    const modeButtons: Record<SelectionMoveMode, HTMLButtonElement> = {
        move: el("selection-mode-move"),
        duplicate: el("selection-mode-duplicate"),
        "mask-only": el("selection-mode-area"),
    };

    selectionTrigger.addEventListener("click", event => {
        event.preventDefault();
        if (isInspectorOpen("selection")) closeInspector();
        else openInspector("selection", "Selection");
    });
    (Object.keys(modeButtons) as SelectionMoveMode[]).forEach(mode =>
        modeButtons[mode].addEventListener("click", () => {
            cb.onSelectionMoveMode(mode);
            closeInspector();
        })
    );
    selectionCopy.addEventListener("click", cb.onSelectionCopy);
    selectionCut.addEventListener("click", cb.onSelectionCut);
    selectionPaste.addEventListener("click", cb.onSelectionPaste);
    selectionDeselect.addEventListener("click", cb.onSelectionDeselect);

    function setSelectionState(selectedCount: number, clipboardCount: number, mode: SelectionMoveMode) {
        const hasSelection = selectedCount > 0;
        const hasClip = clipboardCount > 0;
        selectionTrigger.hidden = !hasSelection && !hasClip;
        if (hasSelection) {
            selectionTrigger.textContent = `${selectedCount} selected`;
            selectionTrigger.setAttribute("aria-label", `${selectedCount} selected`);
            selectionTitle.textContent = `Selection · ${selectedCount} ${selectedCount === 1 ? "cell" : "cells"}`;
        } else if (hasClip) {
            selectionTrigger.textContent = `Clipboard · ${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"}`;
            selectionTrigger.setAttribute("aria-label", `Clipboard, ${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"}`);
            selectionTitle.textContent = "Clipboard";
        }
        selectionClipboard.textContent = hasSelection && hasClip
            ? `${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"} copied`
            : "";
        selectionModes.hidden = !hasSelection;
        selectionCopy.hidden = !hasSelection;
        selectionCut.hidden = !hasSelection;
        selectionDeselect.hidden = !hasSelection;
        selectionDeselectHelp.hidden = !hasSelection;
        selectionPaste.disabled = !hasClip;
        selectionPasteHelp.hidden = hasClip;
        (Object.keys(modeButtons) as SelectionMoveMode[]).forEach(key => {
            const active = key === mode;
            modeButtons[key].classList.toggle("btn--active", active);
            modeButtons[key].setAttribute("aria-pressed", String(active));
        });
        if (!hasSelection && !hasClip && isInspectorOpen("selection")) {
            closeInspector();
        }
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
    const editYarn = el<HTMLButtonElement>("edit-yarn");
    let activeYarn: 1 | 2 = 1;

    bindLongPress(swatchA, () => cb.onPrimaryColor(1), () => colorA.click());
    bindLongPress(swatchB, () => cb.onPrimaryColor(2), () => colorB.click());
    const selectWithKeyboard = (event: KeyboardEvent, slot: 1 | 2) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        cb.onPrimaryColor(slot);
    };
    swatchA.addEventListener("keydown", event => selectWithKeyboard(event, 1));
    swatchB.addEventListener("keydown", event => selectWithKeyboard(event, 2));
    swatchA.addEventListener("dblclick", () => colorA.click());
    swatchB.addEventListener("dblclick", () => colorB.click());
    editYarn.addEventListener("click", () => (activeYarn === 1 ? colorA : colorB).click());
    el("swap-yarns").addEventListener("click", cb.onSwapYarns);
    colorA.addEventListener("input",  cb.onColorChange);
    colorB.addEventListener("input",  cb.onColorChange);
    // `change` fires when the picker closes — that's the user's "I'm done"
    // signal and the right moment to push a history snapshot.
    colorA.addEventListener("change", cb.onColorCommit);
    colorB.addEventListener("change", cb.onColorCommit);

    function setPrimary(slot: 1 | 2) {
        activeYarn = slot;
        swatchA.classList.toggle("swatch--active", slot === 1);
        swatchB.classList.toggle("swatch--active", slot === 2);
        swatchA.setAttribute("aria-pressed", String(slot === 1));
        swatchB.setAttribute("aria-pressed", String(slot === 2));
        editYarn.setAttribute("aria-label", `Edit Yarn ${slot === 1 ? "A" : "B"}`);
        editYarn.title = `Edit Yarn ${slot === 1 ? "A" : "B"} colour`;
    }
    function setColors(a: string, b: string) {
        colorA.value = a; colorB.value = b;
        swatchA.style.background = a;
        swatchB.style.background = b;
    }

    /* ── Mirror & Repeat inspector ────────────────────────────────────── */
    const symList    = el("sym-list");
    const symToggle  = el("btn-sym-toggle");

    symToggle.addEventListener("click", e => {
        e.preventDefault();
        if (isInspectorOpen("transforms")) closeInspector();
        else openInspector("transforms", "Mirror & Repeat");
    });

    SYM_ADD_BUTTONS.forEach(({ id, key }) =>
        el(id).addEventListener("click", () => cb.onAddAxis(key))
    );
    const replicateSelection = el<HTMLButtonElement>("replicate-selection");
    const replicateSelectionHint = el("replicate-selection-hint");
    const transformError = el("transform-error");
    replicateSelection.addEventListener("click", cb.onReplicateSelection);
    const liveTransforms = el<HTMLInputElement>("live-transforms");
    liveTransforms.addEventListener("input", () => cb.onLiveTransformsChange(liveTransforms.checked));

    function setTransformState(hasSelection: boolean, hasTransforms: boolean, liveEnabled: boolean) {
        replicateSelection.disabled = !hasSelection || !hasTransforms;
        replicateSelectionHint.hidden = hasSelection && hasTransforms;
        replicateSelectionHint.textContent = !hasTransforms
            ? "Configure a symmetry axis or repeat grid."
            : "Select cells to stamp transformed copies.";
        liveTransforms.checked = liveEnabled;

        const state = !hasTransforms ? "none" : liveEnabled ? "live" : "paused";
        const label = state === "none"
            ? "Symmetry and repeat: no transforms configured"
            : state === "live"
                ? "Symmetry and repeat: applying while drawing"
                : "Symmetry and repeat: drawing application paused";
        symToggle.dataset.transformState = state;
        symToggle.title = label;
        symToggle.setAttribute("aria-label", label);
    }

    function setTransformError(message: string | null) {
        transformError.textContent = message ?? "";
        transformError.hidden = message === null;
        if (message !== null && !isInspectorOpen("transforms")) {
            openInspector("transforms", "Mirror & Repeat");
        }
    }

    const repeatEnabled = el<HTMLInputElement>("repeat-enabled");
    const repeatTileWidth = el<HTMLInputElement>("repeat-tile-width");
    const repeatTileHeight = el<HTMLInputElement>("repeat-tile-height");
    const repeatCopiesX = el<HTMLInputElement>("repeat-copies-x");
    const repeatCopiesY = el<HTMLInputElement>("repeat-copies-y");
    const repeatError = el("repeat-error");
    const repeatInputs = [repeatEnabled, repeatTileWidth, repeatTileHeight, repeatCopiesX, repeatCopiesY];
    repeatInputs.forEach(input => {
        input.addEventListener("input", cb.onRepeatInput);
        input.addEventListener("change", cb.onRepeatCommit);
    });

    function readRepeatGrid(): RepeatGrid {
        return {
            enabled: repeatEnabled.checked,
            tileWidth: repeatTileWidth.valueAsNumber,
            tileHeight: repeatTileHeight.valueAsNumber,
            copiesX: repeatCopiesX.valueAsNumber,
            copiesY: repeatCopiesY.valueAsNumber,
        };
    }

    function setRepeatGrid(repeat: RepeatGrid) {
        repeatEnabled.checked = repeat.enabled;
        repeatTileWidth.value = String(repeat.tileWidth);
        repeatTileHeight.value = String(repeat.tileHeight);
        repeatCopiesX.value = String(repeat.copiesX);
        repeatCopiesY.value = String(repeat.copiesY);
        setRepeatError(null);
    }

    function setRepeatError(message: string | null) {
        repeatError.textContent = message ?? "";
        repeatError.hidden = message === null;
    }

    function formatPosition(a: Axis): string {
        switch (a.kind) {
            case "V":  return `x=${a.x}`;
            case "H":  return `y=${a.y}`;
            case "C":  return `(${a.x}, ${a.y})`;
            case "D1":
            case "D2": return `c=${a.c}`;
        }
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

            const pos = document.createElement("span");
            pos.className = "sym-list-row__pos";
            pos.textContent = formatPosition(a);

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
        else openInspector("settings", "Settings");
    });
    el<HTMLInputElement>("hl-opacity")        .addEventListener("input",  cb.onHighlightChange);
    el<HTMLInputElement>("invalid-intensity") .addEventListener("input",  cb.onInvalidIntensityChange);
    el<HTMLInputElement>("labels-on")   .addEventListener("change", cb.onLabelsVisibleChange);
    el<HTMLInputElement>("lock-invalid").addEventListener("change", cb.onLockInvalidChange);

    /* ── History and canvas view ─────────────────────────────────────── */
    el("btn-undo")  .addEventListener("click", cb.onUndo);
    el("btn-redo")  .addEventListener("click", cb.onRedo);
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
        status.textContent = state === "failed"
            ? "Local save failed"
            : state === "recovered" ? "Recovered from this device" : "Saved locally";
        status.title = state === "failed"
            ? "Browser recovery could not be updated; recent changes may be lost if this tab closes."
            : "Browser recovery is current. Save .mcw creates a separate editable pattern file.";
    }

    function setViewState(zoom: number, rotation: number, navigating: boolean) {
        el("view-zoom-value").textContent = `${Math.round(zoom)} px`;
        const navigate = el<HTMLButtonElement>("view-navigate");
        navigate.classList.toggle("btn--active", navigating);
        navigate.setAttribute("aria-pressed", String(navigating));
        el("canvas").classList.toggle("canvas--navigate", navigating);
        el<HTMLButtonElement>("view-rotation-reset").disabled = rotation % 360 === 0;
    }

    /* ── Save / load / Instructions ─────────────────────────────────── */
    el("btn-save")  .addEventListener("click", cb.onSave);
    el("btn-load")  .addEventListener("click", cb.onLoad);
    el("btn-export").addEventListener("click", cb.onInstructions);

    /* ── Pattern inspector ────────────────────────────────────────────── */
    const editWidget = el("edit-pattern-widget");
    const btnEdit    = el<HTMLButtonElement>("btn-edit");
    const editError  = el("edit-error");
    const editApply  = el<HTMLButtonElement>("edit-apply");
    const editCancel = el<HTMLButtonElement>("edit-cancel");
    const canvas     = el("canvas");

    function setEditError(message: string | null) {
        editError.textContent = message ?? "";
        editError.hidden = message === null;
        editApply.disabled = message !== null;
    }

    function closeEdit() {
        closeInspector(true);
    }

    btnEdit.addEventListener("click", e => {
        e.preventDefault();
        if (isInspectorOpen("pattern")) return;
        openInspector("pattern", "Pattern");
        cb.onEditOpen();
        editWidget.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])")?.focus();
    });

    editApply.addEventListener("click", () => {
        cb.onEditApply();
        closeEdit();
    });
    editCancel.addEventListener("click", () => {
        cb.onEditCancel();
        closeEdit();
    });

    editWidget.addEventListener("keydown", e => {
        if (e.key === "Escape") {
            e.preventDefault();
            cb.onEditCancel();
            closeEdit();
        }
        e.stopPropagation();
    });

    const blockOutsideEdit = (e: Event) => {
        if (!isInspectorOpen("pattern") || editWidget.contains(e.target as Node)) return;
        if ((e.target as Element).closest?.("#inspector-close")) return;
        if (e.target === canvas) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", blockOutsideEdit, true);
    document.addEventListener("click", blockOutsideEdit, true);
    document.addEventListener("keydown", e => {
        if (!isInspectorOpen("pattern") || editWidget.contains(e.target as Node)) return;
        if (e.key === "Escape") {
            cb.onEditCancel();
            closeEdit();
        }
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    let editOpenState: PatternState | null = null;

    // "Wipe" is forced ON (visibly checked, disabled) only for mode switches —
    // row ↔ round can't preserve content. Inner-dim and rounds changes within
    // the same mode are handled by the round-mode corner/strip transfer (see
    // `preserveRound` in pattern.ts) and need no force.
    //
    // When force kicks in we stash the user's actual preference on the
    // element's dataset and tick the checkbox so the disabled state
    // communicates *which way* it's forced. When force lifts, restore the
    // stashed preference. The user's choice is never lost, just suppressed.
    function refreshWipeAvailability() {
        if (!editOpenState) return;
        const newMode = radioValue("edit-mode");
        const force = newMode !== editOpenState.mode;
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        if (force) {
            if (wipeEl.dataset.userPref === undefined) {
                wipeEl.dataset.userPref = wipeEl.checked ? "1" : "0";
            }
            wipeEl.checked = true;
        } else if (wipeEl.dataset.userPref !== undefined) {
            wipeEl.checked = wipeEl.dataset.userPref === "1";
            delete wipeEl.dataset.userPref;
        }
        wipeEl.disabled = force;
    }

    document.querySelectorAll<HTMLInputElement>('[name="edit-mode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            const mode = radio.value;
            el("edit-row-controls")  .hidden = mode !== "row";
            el("edit-round-controls").hidden = mode !== "round";
            refreshWipeAvailability();
            if (isInspectorOpen("pattern")) cb.onEditChange();
        });
    });
    document.querySelectorAll<HTMLInputElement>('[name="edit-submode"]').forEach(radio => {
        radio.addEventListener("change", () => {
            if (isInspectorOpen("pattern")) cb.onEditChange();
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
        const apply = () => {
            refreshWipeAvailability();
            if (isInspectorOpen("pattern")) cb.onEditChange();
        };
        el(id).addEventListener("input", apply);
        el(id).addEventListener("change", () => {
            clampInputDisplay(id, min);
            apply();
        });
    });
    el<HTMLInputElement>("edit-wipe").addEventListener("change", () => {
        if (isInspectorOpen("pattern")) cb.onEditChange();
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
        // Each fresh Pattern open resets the user preference to "preserve"
        // (i.e. Wipe unchecked) and drops any stashed force-state from the
        // previous open.
        const wipeEl = el<HTMLInputElement>("edit-wipe");
        delete wipeEl.dataset.userPref;
        wipeEl.checked = false;
        refreshWipeAvailability();
    }

    /* ── Instructions workspace ─────────────────────────────────────── */
    const instructions   = el("instructions-workspace");
    const canvasArea     = el("canvas").parentElement as HTMLElement;
    const authoringDock  = el("authoring-dock");
    const overviewPanel  = el("instructions-overview");
    const livePanel      = el("instructions-live");
    const textPanel      = el("instructions-text-panel");
    const overviewTab    = el<HTMLButtonElement>("instructions-overview-tab");
    const liveTab        = el<HTMLButtonElement>("instructions-live-tab");
    const textTab        = el<HTMLButtonElement>("instructions-text-tab");
    const instructionsChart = el("instructions-canvas").parentElement as HTMLElement;
    const instructionsTitle = el("instructions-title");
    const unitsList      = el<HTMLOListElement>("instructions-units");
    const focusStatus    = el("instructions-focus-status");
    const exportText     = el<HTMLTextAreaElement>("export-text");
    const exportProgress = el("export-progress");
    const exportWarning  = el("export-warning");
    const blockerSummary = el("instructions-blocker-summary");
    const issuesList     = el("instructions-issues");
    const alternateChk   = el<HTMLInputElement>("alternate");
    const liveUnavailable = el("instructions-live-unavailable");
    const liveProgress   = el("instructions-live-progress");
    const liveSaveWarning = el("instructions-live-save-warning");
    const liveUnit       = el("instructions-live-unit");
    const liveYarn       = el("instructions-live-yarn");
    const liveText       = el("instructions-live-text");
    const liveBack       = el<HTMLButtonElement>("instructions-live-back");
    const liveDone       = el<HTMLButtonElement>("instructions-live-done");
    el("export-copy").addEventListener("click", () =>
        navigator.clipboard.writeText(exportText.value)
    );
    el("export-download").addEventListener("click", () => {
        const blob = new Blob([exportText.value], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement("a"), { href: url, download: "pattern.txt" }).click();
        URL.revokeObjectURL(url);
    });

    type InstructionsTab = "overview" | "live" | "text";
    let instructionsTabChanged: ((tab: InstructionsTab) => void) | null = null;

    function selectInstructionsTab(tab: InstructionsTab) {
        if (tab === "live" && liveTab.disabled) return;
        overviewPanel.hidden = tab !== "overview";
        livePanel.hidden = tab !== "live";
        textPanel.hidden = tab !== "text";
        if (tab === "overview") overviewPanel.prepend(instructionsChart);
        if (tab === "live") livePanel.prepend(instructionsChart);
        for (const [name, button] of [
            ["overview", overviewTab], ["live", liveTab], ["text", textTab],
        ] as const) {
            const selected = tab === name;
            button.setAttribute("aria-selected", String(selected));
            button.tabIndex = selected ? 0 : -1;
        }
        instructionsTitle.textContent = tab === "overview" ? "Overview" : tab === "live" ? "Live" : "Text";
        instructionsTabChanged?.(tab);
    }
    overviewTab.addEventListener("click", () => selectInstructionsTab("overview"));
    liveTab.addEventListener("click", () => selectInstructionsTab("live"));
    textTab.addEventListener("click", () => selectInstructionsTab("text"));
    for (const tab of [overviewTab, liveTab, textTab]) {
        tab.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const enabled = [overviewTab, liveTab, textTab].filter(button => !button.disabled);
            const current = enabled.indexOf(tab);
            const target = event.key === "Home" ? enabled[0]
                : event.key === "End" ? enabled.at(-1)!
                : enabled[(current + (event.key === "ArrowLeft" ? -1 : 1) + enabled.length) % enabled.length];
            const name = target === overviewTab ? "overview" : target === liveTab ? "live" : "text";
            selectInstructionsTab(name);
            target.focus();
        });
    }

    function openInstructions(): InstructionsView {
        const altListeners: (() => void)[] = [];
        const closeListeners: (() => void)[] = [];
        const focusListeners: ((coords: number[], label: string) => void)[] = [];
        const issueListeners: ((issue: InstructionIssue) => void)[] = [];
        let activeFocus: HTMLButtonElement | null = null;
        let liveUnits: readonly InstructionOverviewUnit[] = [];
        let liveCompleted = 0;
        let liveProgressChanged = (_completedUnits: number) => true;
        let isBusy = true;
        let hasBlockers = false;
        const inspectorWasHidden = inspectorHost.hidden;
        const onAlt = () => altListeners.forEach(f => f());
        alternateChk.addEventListener("change", onAlt);
        selectInstructionsTab("overview");
        instructions.hidden = false;
        canvasArea.hidden = true;
        authoringDock.hidden = true;
        inspectorHost.hidden = true;
        el("btn-export").setAttribute("aria-current", "page");

        const workKind = () => liveUnits[0]?.label.startsWith("Round") ? "round" : "row";
        const focusLive = (unit: InstructionOverviewUnit) => {
            focusListeners.forEach(f => f(unit.workedCoords, unit.label));
        };
        const renderLive = () => {
            const total = liveUnits.length;
            liveProgress.textContent = `${liveCompleted} of ${total} complete`;
            liveBack.disabled = liveCompleted === 0;
            liveBack.setAttribute("aria-label", `Back one ${workKind()}`);
            if (liveCompleted >= total) {
                liveUnit.textContent = "Pattern complete";
                liveYarn.hidden = true;
                liveText.textContent = "All chart-derived work units are complete.";
                liveDone.hidden = true;
                if (total > 0) focusLive(liveUnits[total - 1]);
                return;
            }
            const unit = liveUnits[liveCompleted];
            liveUnit.textContent = unit.label;
            liveYarn.hidden = false;
            liveYarn.textContent = `Yarn ${unit.yarn}`;
            liveText.textContent = unit.text.slice(unit.text.indexOf(":") + 1).trim();
            liveDone.hidden = false;
            liveDone.setAttribute("aria-label", `Done with ${unit.label}`);
            focusLive(unit);
        };
        const refreshLiveAvailability = () => {
            liveTab.disabled = isBusy || hasBlockers || liveUnits.length === 0;
            if (hasBlockers) {
                liveUnavailable.textContent = "Resolve chart issues to use Live.";
                liveUnavailable.hidden = false;
            } else if (!isBusy && liveUnits.length === 0) {
                liveUnavailable.textContent = "No rows or rounds are available for Live.";
                liveUnavailable.hidden = false;
            } else {
                liveUnavailable.hidden = true;
            }
            if (liveTab.disabled && liveTab.getAttribute("aria-selected") === "true") {
                selectInstructionsTab("overview");
            }
        };
        instructionsTabChanged = tab => {
            if (tab === "live" && liveUnits.length > 0) renderLive();
            if (tab === "overview") activeFocus?.click();
        };
        liveBack.onclick = () => {
            if (liveCompleted === 0) return;
            liveCompleted--;
            liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            renderLive();
        };
        liveDone.onclick = () => {
            if (liveCompleted >= liveUnits.length) return;
            liveCompleted++;
            liveSaveWarning.hidden = liveProgressChanged(liveCompleted);
            renderLive();
        };

        const close = () => {
            alternateChk.removeEventListener("change", onAlt);
            instructionsTabChanged = null;
            liveBack.onclick = null;
            liveDone.onclick = null;
            instructions.hidden = true;
            canvasArea.hidden = false;
            authoringDock.hidden = false;
            inspectorHost.hidden = inspectorWasHidden;
            el("btn-export").removeAttribute("aria-current");
            closeListeners.forEach(f => f());
            el<HTMLButtonElement>("btn-export").focus();
        };
        el("instructions-design").addEventListener("click", close, { once: true });

        return {
            setProgress: (count, total) => {
                exportProgress.hidden = false;
                exportProgress.textContent = `Generating… ${count} / ${total}`;
            },
            endProgress: () => { exportProgress.hidden = true; },
            appendLine: (line) => {
                exportText.value += (exportText.value ? "\n" : "") + line;
            },
            appendUnit: (unit) => {
                const item = document.createElement("li");
                const button = document.createElement("button");
                button.type = "button";
                button.className = "instructions-unit";
                button.setAttribute("aria-label", `${unit.label}, Yarn ${unit.yarn}`);
                button.setAttribute("aria-pressed", "false");
                const meta = document.createElement("span");
                meta.className = "instructions-unit-meta";
                meta.textContent = `${unit.label} · Yarn ${unit.yarn}`;
                const text = document.createElement("code");
                text.textContent = unit.text.slice(unit.text.indexOf(":") + 1).trim();
                button.append(meta, text);
                item.append(button);
                unitsList.append(item);
                const focus = () => {
                    activeFocus?.setAttribute("aria-pressed", "false");
                    activeFocus = button;
                    button.setAttribute("aria-pressed", "true");
                    focusStatus.textContent = `Showing ${unit.label} path`;
                    focusListeners.forEach(f => f(unit.workedCoords, unit.label));
                };
                button.addEventListener("click", focus);
                if (activeFocus === null) focus();
            },
            clearText: () => { exportText.value = ""; },
            clearUnits: () => {
                unitsList.replaceChildren();
                activeFocus = null;
                focusStatus.textContent = "";
                liveUnits = [];
                liveCompleted = 0;
                refreshLiveAvailability();
            },
            setLivePlan: (units, completedUnits, onProgress) => {
                liveUnits = units;
                liveCompleted = Math.min(Math.max(0, completedUnits), units.length);
                liveProgressChanged = onProgress;
                liveSaveWarning.hidden = true;
                refreshLiveAvailability();
                if (liveTab.getAttribute("aria-selected") === "true") renderLive();
            },
            setBlockers: (issues) => {
                hasBlockers = issues.length > 0;
                issuesList.replaceChildren();
                exportWarning.hidden = issues.length === 0;
                blockerSummary.textContent = issues.length === 1
                    ? "Draft — 1 unresolved overlay position"
                    : `Draft — ${issues.length} unresolved overlay positions`;
                for (const issue of issues) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "btn instructions-issue";
                    button.setAttribute("aria-label", `Focus unresolved overlay at ${issue.x}, ${issue.y}`);
                    button.setAttribute("aria-pressed", "false");
                    button.textContent = `Unresolved overlay · ${issue.x}, ${issue.y}`;
                    const focus = () => {
                        activeFocus?.setAttribute("aria-pressed", "false");
                        activeFocus = button;
                        button.setAttribute("aria-pressed", "true");
                        focusStatus.textContent = `Showing issue at ${issue.x}, ${issue.y}`;
                        issueListeners.forEach(f => f(issue));
                    };
                    button.addEventListener("click", focus);
                    issuesList.append(button);
                    if (activeFocus === null) focus();
                }
                refreshLiveAvailability();
            },
            alternate: () => alternateChk.checked,
            setBusy: (busy) => {
                isBusy = busy;
                el<HTMLButtonElement>("export-copy")    .disabled = busy;
                el<HTMLButtonElement>("export-download").disabled = busy;
                refreshLiveAvailability();
            },
            onAlternate: (f) => altListeners.push(f),
            onUnitFocus: (f) => focusListeners.push(f),
            onIssueFocus: (f) => issueListeners.push(f),
            onClose:     (f) => closeListeners.push(f),
            close,
        };
    }

    mountToolbarLayout();

    return {
        setTool, setMaskMove, setSelectionState, setCanvasFeedback, setPrimary, setColors, setAxes,
        readRepeatGrid, setRepeatGrid, setRepeatError,
        setTransformState, setTransformError,
        setHistory, setRecoveryStatus, setViewState, setEditError,
        syncEditInputs, closeEdit,
        openInstructions,
    };
}

// ─── Toolbar layout ──────────────────────────────────────────────────────────
function mountToolbarLayout() {
    const documentBar = el("document-bar");
    const fileGroup = document.querySelector(".g-file") as HTMLElement;
    const viewGroup = document.querySelector(".g-hlrot") as HTMLElement;
    const moreButton = el<HTMLButtonElement>("btn-more");
    const morePopover = el("more-popover");
    const moreActions = el("more-actions");
    const fileActions = [el("btn-edit"), el("btn-load"), el("btn-save"), el("btn-export")];
    const viewActions = [el("btn-hl-toggle")];
    let compact = false;
    let compactBelow = 0;

    moreButton.addEventListener("click", e => {
        e.preventDefault();
        if (morePopover.matches(":popover-open")) morePopover.hidePopover();
        else {
            positionPopover(morePopover, moreButton, "left");
            morePopover.showPopover();
        }
    });
    morePopover.addEventListener("toggle", e => {
        moreButton.setAttribute("aria-expanded", String((e as ToggleEvent).newState === "open"));
    });
    moreActions.addEventListener("click", e => {
        if ((e.target as Element).closest("button") && morePopover.matches(":popover-open"))
            morePopover.hidePopover();
    });

    function setCompact(next: boolean) {
        if (compact === next) return;
        compact = next;
        if (compact) {
            moreActions.append(...fileActions, ...viewActions);
            moreButton.hidden = false;
        } else {
            fileGroup.prepend(...fileActions);
            viewGroup.append(...viewActions);
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
        compactBelow = padding + gap + fileGroup.offsetWidth + viewGroup.offsetWidth;
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
