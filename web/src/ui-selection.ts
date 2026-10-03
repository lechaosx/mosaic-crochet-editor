import type { Tool, GridRecipe } from "@mosaic/logic/types";
import { el, radioValue, setRadio, setPressed, setMessage, iconAction, listRow } from "./dom";
import type { UICallbacks, SelectionMode, SelectionMoveMode, InspectorControls } from "./ui-types";

export function mountSelection(
    cb: Pick<UICallbacks, "onSelectionMoveMode" | "onSelectionMode" | "onSelectionCopy" | "onSelectionCut"
        | "onSelectionPaste" | "onSelectionDeselect" | "onCreateRecipe" | "onActivateRecipe"
        | "onDeleteRecipe" | "onRecipeChange" | "onApplyRecipe">,
    inspector: Pick<InspectorControls, "isOpen" | "close">, syncCanvasChromeInsets: () => void) {
    /* ── Selection card ──────────────────────────────────────────────── */
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

    (Object.keys(selectionModeButtons) as SelectionMode[]).forEach(mode =>
        selectionModeButtons[mode].addEventListener("click", () => cb.onSelectionMode(mode))
    );
    function setSelectionMode(tool: Tool, mode: SelectionMode, hasSelection: boolean) {
        selectionModeControls.hidden = tool !== "select" && tool !== "wand";
        for (const key of Object.keys(selectionModeButtons) as SelectionMode[]) {
            const button = selectionModeButtons[key];
            const active = key === mode;
            setPressed(button, active);
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
    selectionDeselect.addEventListener("click", () => {
        cb.onSelectionDeselect();
        if (inspector.isOpen("selection")) {
            inspector.close(false);
            document.querySelector<HTMLButtonElement>(
                ".authoring-dock .btn[aria-pressed='true']",
            )?.focus();
        }
    });

    function setSelectionState(selectedCount: number, clipboardCount: number, mode: SelectionMoveMode) {
        const hasSelection = selectedCount > 0;
        const hasClip = clipboardCount > 0;
        const statusVisibilityChanged = selectionStatus.hidden === (hasSelection || hasClip);
        if (hasSelection) {
            selectionTitle.textContent = `Selection · ${selectedCount} ${selectedCount === 1 ? "cell" : "cells"}`;
            selectionStatus.textContent = `${selectedCount} selected`;
        } else if (hasClip) {
            selectionTitle.textContent = "Clipboard";
            selectionStatus.textContent = `${clipboardCount} copied`;
        } else {
            selectionTitle.textContent = "Selection";
            selectionStatus.textContent = "";
        }
        selectionStatus.hidden = !hasSelection && !hasClip;
        selectionClipboard.textContent = hasSelection && hasClip
            ? `${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"} copied`
            : "";
        (Object.keys(modeButtons) as SelectionMoveMode[]).forEach(key => {
            modeButtons[key].disabled = !hasSelection;
        });
        selectionCopy.hidden = !hasSelection;
        selectionCut.hidden = !hasSelection;
        selectionDeselect.hidden = !hasSelection;
        selectionPaste.disabled = !hasClip;
        selectionPaste.title = hasClip ? "Paste copied cells (Ctrl+V)" : "Nothing copied";
        (Object.keys(modeButtons) as SelectionMoveMode[]).forEach(key => {
            const active = key === mode;
            setPressed(modeButtons[key], active);
        });
        if (statusVisibilityChanged) syncCanvasChromeInsets();
    }

    const recipeList = el("recipe-list");
    const recipeControls = el("recipe-controls");
    const recipeGridControls = el("recipe-grid-controls");
    const recipeRotationControls = el("recipe-rotation-controls");
    const recipeLeft = el<HTMLInputElement>("recipe-left");
    const recipeRight = el<HTMLInputElement>("recipe-right");
    const recipeUp = el<HTMLInputElement>("recipe-up");
    const recipeDown = el<HTMLInputElement>("recipe-down");
    const recipeGapX = el<HTMLInputElement>("recipe-gap-x");
    const recipeGapY = el<HTMLInputElement>("recipe-gap-y");
    const recipeColumnMirrorHorizontal = el<HTMLInputElement>("recipe-column-mirror-horizontal");
    const recipeColumnMirrorVertical = el<HTMLInputElement>("recipe-column-mirror-vertical");
    const recipeRowMirrorHorizontal = el<HTMLInputElement>("recipe-row-mirror-horizontal");
    const recipeRowMirrorVertical = el<HTMLInputElement>("recipe-row-mirror-vertical");
    const recipeColumnOffset = el<HTMLInputElement>("recipe-column-offset");
    const recipeRowOffset = el<HTMLInputElement>("recipe-row-offset");
    const recipeCentreX = el<HTMLInputElement>("recipe-centre-x");
    const recipeCentreY = el<HTMLInputElement>("recipe-centre-y");
    const recipeTurns = [90, 180, 270].map(turn => el<HTMLInputElement>(`recipe-turn-${turn}`));
    const recipeMirrorHorizontal = el<HTMLInputElement>("recipe-mirror-horizontal");
    const recipeMirrorVertical = el<HTMLInputElement>("recipe-mirror-vertical");
    const recipeError = el("recipe-error");
    let selectedRecipeId: string | null = null;
    let projectedRecipes: ReadonlyArray<GridRecipe> | null = null;
    let projectedActiveRecipeId: string | null | undefined;
    el("recipe-create").addEventListener("click", cb.onCreateRecipe);
    el("recipe-apply").addEventListener("click", cb.onApplyRecipe);
    const recipeInputs = [
        recipeLeft, recipeRight, recipeUp, recipeDown,
        recipeGapX, recipeGapY, recipeColumnMirrorHorizontal, recipeColumnMirrorVertical,
        recipeRowMirrorHorizontal, recipeRowMirrorVertical,
        recipeColumnOffset, recipeRowOffset, recipeCentreX, recipeCentreY,
        ...recipeTurns, recipeMirrorHorizontal, recipeMirrorVertical,
        ...document.querySelectorAll<HTMLInputElement>('[name="recipe-mode"]'),
    ];
    function syncRecipeSections() {
        const mode = radioValue("recipe-mode");
        recipeGridControls.hidden = mode !== "grid";
        recipeRotationControls.hidden = mode !== "rotation";
    }
    recipeInputs.forEach(input => input.addEventListener("change", event => {
        const id = selectedRecipeId;
        if (!id) return;
        syncRecipeSections();
        const change: Partial<GridRecipe> = {
            mode: radioValue("recipe-mode") as GridRecipe["mode"],
            left: recipeLeft.valueAsNumber,
            right: recipeRight.valueAsNumber,
            up: recipeUp.valueAsNumber,
            down: recipeDown.valueAsNumber,
            columnSpacing: recipeGapX.valueAsNumber,
            rowSpacing: recipeGapY.valueAsNumber,
            columnOffset: recipeColumnOffset.valueAsNumber,
            rowOffset: recipeRowOffset.valueAsNumber,
            columnMirrorHorizontal: recipeColumnMirrorHorizontal.checked,
            columnMirrorVertical: recipeColumnMirrorVertical.checked,
            rowMirrorHorizontal: recipeRowMirrorHorizontal.checked,
            rowMirrorVertical: recipeRowMirrorVertical.checked,
            rotationCentreX: recipeCentreX.valueAsNumber,
            rotationCentreY: recipeCentreY.valueAsNumber,
            rotationTurns: recipeTurns.filter(input => input.checked).map(input => Number(input.value)) as GridRecipe["rotationTurns"],
            mirrorHorizontal: recipeMirrorHorizontal.checked,
            mirrorVertical: recipeMirrorVertical.checked,
        };
        if (event.target === recipeGapX) change.columnSpacingAlternate = recipeGapX.valueAsNumber;
        if (event.target === recipeGapY) change.rowSpacingAlternate = recipeGapY.valueAsNumber;
        cb.onRecipeChange(id, change);
    }));
    function setRecipes(recipes: ReadonlyArray<GridRecipe>, activeId: string | null) {
        const currentId = activeId ?? recipes[0]?.id ?? null;
        if (recipes !== projectedRecipes || activeId !== projectedActiveRecipeId) {
            const focused = document.activeElement instanceof HTMLButtonElement
                && recipeList.contains(document.activeElement) ? document.activeElement : null;
            const focusedId = focused?.dataset.recipeId;
            const focusedIndex = projectedRecipes?.findIndex(recipe => recipe.id === focusedId) ?? -1;
            projectedRecipes = recipes;
            projectedActiveRecipeId = activeId;
            selectedRecipeId = currentId;
            recipeList.replaceChildren(...recipes.map((recipe, index) => {
                const row = document.createElement("li");
                row.className = "recipe-list-row";
                row.dataset.recipeId = recipe.id;
                const activate = document.createElement("button");
                activate.className = "btn btn--ghost recipe-list-activate";
                const name = document.createElement("span");
                name.textContent = `Selection ${index + 1}`;
                const detail = document.createElement("span");
                detail.className = "recipe-list-detail";
                detail.textContent = recipe.source.mask.length === 0
                    ? "Empty" : `${recipe.source.w}\u00a0×\u00a0${recipe.source.h}`;
                activate.append(name, detail);
                activate.title = "Select this saved selection";
                activate.dataset.recipeId = recipe.id;
                activate.dataset.recipeAction = "activate";
                activate.setAttribute("aria-pressed", String(recipe.id === currentId));
                activate.addEventListener("click", () => cb.onActivateRecipe(recipe.id));
                const remove = iconAction("×", `Delete selection ${index + 1}`,
                    recipes.length === 1 ? "At least one selection is required" : `Delete selection ${index + 1}`);
                remove.dataset.recipeId = recipe.id;
                remove.dataset.recipeAction = "delete";
                remove.disabled = recipes.length === 1;
                remove.addEventListener("click", () => cb.onDeleteRecipe(recipe.id));
                row.append(activate, remove);
                return row;
            }));
            if (focused) {
                const fallback = recipes.find(recipe => recipe.id === focusedId)
                    ?? recipes[Math.min(focusedIndex, recipes.length - 1)];
                const row = listRow(recipeList, "recipeId", fallback?.id);
                const target = row?.querySelector<HTMLButtonElement>(`[data-recipe-action='${focused.dataset.recipeAction}']`);
                (target?.disabled ? row?.querySelector<HTMLButtonElement>("[data-recipe-action='activate']") : target)?.focus();
            }
        }
        const active = currentId === null ? null : recipes.find(recipe => recipe.id === currentId) ?? null;
        recipeControls.hidden = active === null;
        if (!active) return;
        setRadio("recipe-mode", active.mode);
        recipeLeft.value = String(active.left);
        recipeRight.value = String(active.right);
        recipeUp.value = String(active.up);
        recipeDown.value = String(active.down);
        recipeGapX.value = String(active.columnSpacing);
        recipeGapY.value = String(active.rowSpacing);
        recipeColumnOffset.value = String(active.columnOffset);
        recipeRowOffset.value = String(active.rowOffset);
        recipeColumnMirrorHorizontal.checked = active.columnMirrorHorizontal;
        recipeColumnMirrorVertical.checked = active.columnMirrorVertical;
        recipeRowMirrorHorizontal.checked = active.rowMirrorHorizontal;
        recipeRowMirrorVertical.checked = active.rowMirrorVertical;
        recipeCentreX.value = String(active.rotationCentreX);
        recipeCentreY.value = String(active.rotationCentreY);
        recipeTurns.forEach(input => { input.checked = active.rotationTurns.includes(Number(input.value) as 90 | 180 | 270); });
        recipeMirrorHorizontal.checked = active.mirrorHorizontal;
        recipeMirrorVertical.checked = active.mirrorVertical;
        syncRecipeSections();
    }
    function setRecipeError(message: string | null) { setMessage(recipeError, message); }

    return { setSelectionState, setSelectionMode, setRecipes, setRecipeError };
}
