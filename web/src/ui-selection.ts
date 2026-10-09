import type { GridRecipe } from "@mosaic/logic/types";
import { el, radioValue, setRadio, setPressed, setMessage, iconAction, listRow, syncList } from "./dom";
import type { UICallbacks } from "./ui-types";
import { createMirrorChoices } from "./mirror-choices";
import { mountCoordinateEditor } from "./coordinate-editor";

export function mountSelection(
    cb: Pick<UICallbacks, "onSelectionCopy" | "onSelectionCut"
        | "onSelectionPaste" | "onCreateRecipe" | "onActivateRecipe"
        | "onDeleteRecipe" | "onRecipeChange" | "onRecipeCommit" | "onRecipeRevert" | "onApplyRecipe" | "recipeMirrorTypeError">,
    syncCanvasChromeInsets: () => void) {
    /* ── Selection card ──────────────────────────────────────────────── */
    const selectionStatus = el("status-selection");
    const selectionTitle = el("selection-card-title");
    const selectionClipboard = el("selection-card-clipboard");
    const selectionCopy = el<HTMLButtonElement>("selection-copy");
    const selectionCut = el<HTMLButtonElement>("selection-cut");
    const selectionPaste = el<HTMLButtonElement>("selection-paste");
    selectionCopy.addEventListener("click", cb.onSelectionCopy);
    selectionCut.addEventListener("click", cb.onSelectionCut);
    selectionPaste.addEventListener("click", cb.onSelectionPaste);


    function setSelectionState(selectedCount: number, clipboardCount: number) {
        const hasSelection = selectedCount > 0;
        const hasClip = clipboardCount > 0;
        const statusVisibilityChanged = selectionStatus.hidden === (hasSelection || hasClip);
        if (hasSelection) {
            selectionTitle.textContent = `${selectedCount} ${selectedCount === 1 ? "cell" : "cells"}`;
            selectionStatus.textContent = `${selectedCount} selected`;
        } else if (hasClip) {
            selectionTitle.textContent = "Clipboard";
            selectionStatus.textContent = `${clipboardCount} copied`;
        } else {
            selectionTitle.textContent = "Select cells on the chart";
            selectionStatus.textContent = "";
        }
        selectionStatus.hidden = !hasSelection && !hasClip;
        selectionClipboard.textContent = hasSelection && hasClip
            ? `${clipboardCount} ${clipboardCount === 1 ? "cell" : "cells"} copied`
            : "";
        selectionCopy.disabled = !hasSelection;
        selectionCut.disabled = !hasSelection;
        selectionCopy.title = hasSelection ? "Copy selected cells (Ctrl+C)" : "Select cells to copy";
        selectionCut.title = hasSelection ? "Cut selected cells (Ctrl+X)" : "Select cells to cut";
        selectionPaste.disabled = !hasClip;
        selectionPaste.title = hasClip ? "Paste copied cells (Ctrl+V)" : "Nothing copied";
        if (statusVisibilityChanged) syncCanvasChromeInsets();
    }

    const recipeList = el("recipe-list");
    const createButton = el<HTMLButtonElement>("recipe-create");
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
    const mirrorCentreX = el<HTMLInputElement>("recipe-mirror-centre-x");
    const mirrorCentreY = el<HTMLInputElement>("recipe-mirror-centre-y");

    const mirrorControls = el("recipe-mirror-controls");
    const recipeError = el("recipe-error");
    let selectedRecipeId: string | null = null;
    let projectedRecipes: ReadonlyArray<GridRecipe> | null = null;
    let projectedActiveRecipeId: string | null | undefined;
    el("recipe-create").addEventListener("click", cb.onCreateRecipe);
    el("recipe-apply").addEventListener("click", cb.onApplyRecipe);
    function syncRecipeSections() {
        const mode = radioValue("recipe-mode");
        recipeGridControls.hidden = mode !== "grid";
        recipeRotationControls.hidden = mode !== "circle";
        mirrorControls.hidden = mode !== "mirror";
        el<HTMLButtonElement>("recipe-apply").disabled = mode === "none";
    }
    const gridNumbers: [HTMLInputElement, keyof GridRecipe][] = [
        [recipeLeft, "left"], [recipeRight, "right"], [recipeUp, "up"], [recipeDown, "down"],
        [recipeGapX, "columnSpacing"], [recipeGapY, "rowSpacing"],
        [recipeColumnOffset, "columnOffset"], [recipeRowOffset, "rowOffset"],
    ];
    function update(change: Partial<GridRecipe>, preview = false) {
        return selectedRecipeId !== null && cb.onRecipeChange(selectedRecipeId, change, preview);
    }
    for (const [input, field] of gridNumbers) {
        const change = () => ({ [field]: input.valueAsNumber,
            ...(input === recipeGapX ? { columnSpacingAlternate: input.valueAsNumber } : {}),
            ...(input === recipeGapY ? { rowSpacingAlternate: input.valueAsNumber } : {}) });
        input.addEventListener("input", () => update(change(), true));
        input.addEventListener("change", () => { update(change(), true); cb.onRecipeCommit(); });
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") { event.preventDefault(); update(change(), true); cb.onRecipeCommit(); }
        });
    }
    const circlePosition = mountCoordinateEditor(el("recipe-centre-fields"), recipeCentreX, recipeCentreY,
        p => {
            update({ rotationCentreX: p.x, rotationCentreY: p.y }, true);
            recipeTurns.forEach(input => { input.disabled = Number(input.value) !== 180 && !Number.isInteger(p.x - p.y); });
        }, cb.onRecipeCommit, cb.onRecipeRevert);
    const mirrorPosition = mountCoordinateEditor(el("recipe-mirror-centre-fields"), mirrorCentreX, mirrorCentreY,
        p => update({ mirrorCentreX: p.x, mirrorCentreY: p.y }, true), cb.onRecipeCommit, cb.onRecipeRevert, updateMirrorChoices);
    const mirrorChoices = createMirrorChoices(type => {
        const recipe = projectedRecipes?.find(value => value.id === selectedRecipeId);
        if (recipe) update({ mirrorTypes: recipe.mirrorTypes.includes(type)
            ? recipe.mirrorTypes.filter(value => value !== type) : [...recipe.mirrorTypes, type] });
    }, "recipe-mirror");
    function updateMirrorChoices() {
        const recipe = projectedRecipes?.find(value => value.id === selectedRecipeId);
        if (!recipe) return;
        const draft = mirrorPosition.getPosition();
        const draftRecipe = { ...recipe, mode: "mirror" as const, mirrorCentreX: draft.x, mirrorCentreY: draft.y };
        const accepted = cb.recipeMirrorTypeError(draftRecipe) ? recipe : draftRecipe;
        mirrorChoices.update(recipe.mirrorTypes, type => cb.recipeMirrorTypeError({ ...draftRecipe, mirrorTypes: [type] })
            ?? cb.recipeMirrorTypeError({ ...accepted, mode: "mirror", mirrorTypes: [...recipe.mirrorTypes, type] }));
    }
    el("recipe-mirror-types").append(mirrorChoices.element);
    for (const [input, field] of [
        [recipeColumnMirrorHorizontal, "columnMirrorHorizontal"], [recipeColumnMirrorVertical, "columnMirrorVertical"],
        [recipeRowMirrorHorizontal, "rowMirrorHorizontal"], [recipeRowMirrorVertical, "rowMirrorVertical"],
    ] as const) input.addEventListener("change", () => update({ [field]: input.checked }));
    recipeTurns.forEach(input => input.addEventListener("change", () => update({
        rotationTurns: recipeTurns.filter(input => input.checked).map(input => Number(input.value)) as GridRecipe["rotationTurns"],
    })));
    document.querySelectorAll<HTMLInputElement>('[name="recipe-mode"]').forEach(input =>
        input.addEventListener("change", () => { update({ mode: input.value as GridRecipe["mode"] }); syncRecipeSections(); }));
    recipeControls.addEventListener("keydown", event => {
        if (event.key === "Escape" && document.activeElement instanceof HTMLInputElement
            && document.activeElement.type === "number") {
            event.preventDefault(); event.stopPropagation(); cb.onRecipeRevert();
        }
    });
    document.addEventListener("pointerdown", event => {
        if (!recipeControls.contains(event.target as Node)) cb.onRecipeCommit();
    }, true);
    window.addEventListener("blur", cb.onRecipeRevert);
    function setRecipes(recipes: ReadonlyArray<GridRecipe>, activeId: string | null) {
        const currentId = activeId ?? recipes.find(recipe => recipe.source.mask.length === 0)?.id ?? null;
        selectedRecipeId = currentId;
        if (recipes !== projectedRecipes || activeId !== projectedActiveRecipeId) {
            const focused = document.activeElement instanceof HTMLButtonElement && recipeList.contains(document.activeElement) ? document.activeElement : null;
            const focusedId = focused?.dataset.recipeId;
            const savedRecipes = recipes.filter(recipe => recipe.source.mask.length > 0);
            const focusedIndex = projectedRecipes?.filter(recipe => recipe.source.mask.length > 0).findIndex(recipe => recipe.id === focusedId) ?? -1;
            projectedRecipes = recipes;
            projectedActiveRecipeId = activeId;
            syncList<GridRecipe | null>(recipeList, [...savedRecipes, null], "recipeKey", recipe => recipe ? `saved:${recipe.id}` : "placeholder", recipe => {
                const row = document.createElement("li");
                row.className = "recipe-list-row";
                if (!recipe) { row.append(createButton); return row; }
                row.dataset.recipeId = recipe.id;
                const activate = document.createElement("button");
                activate.className = "btn btn--ghost recipe-list-activate";
                const name = document.createElement("span"); name.className = "recipe-list-name";
                const detail = document.createElement("span"); detail.className = "recipe-list-detail";
                activate.append(name, detail);
                activate.title = "Select this saved selection";
                activate.dataset.recipeId = recipe.id;
                activate.dataset.recipeAction = "activate";
                activate.addEventListener("click", () => cb.onActivateRecipe(recipe.id));
                const remove = iconAction("delete", "Delete selection");
                remove.dataset.recipeId = recipe.id;
                remove.dataset.recipeAction = "delete";
                remove.addEventListener("click", () => cb.onDeleteRecipe(recipe.id));
                row.append(activate, remove); return row;
            }, (row, recipe, index) => {
                if (!recipe) { setPressed(createButton, activeId === null || !recipes.find(recipe => recipe.id === activeId)?.source.mask.length); return; }
                const activate = row.querySelector<HTMLButtonElement>("[data-recipe-action='activate']")!;
                activate.querySelector(".recipe-list-name")!.textContent = `Selection ${index + 1}`;
                activate.lastElementChild!.textContent = `${recipe.source.w} × ${recipe.source.h}`;
                setPressed(activate, recipe.id === activeId);
                const remove = row.querySelector<HTMLButtonElement>("[data-recipe-action='delete']")!;
                remove.setAttribute("aria-label", `Delete selection ${index + 1}`);
                remove.title = `Delete selection ${index + 1}`;
            });
            if (focused && !focused.isConnected) {
                const fallback = savedRecipes[Math.max(0, Math.min(focusedIndex, savedRecipes.length - 1))];
                const row = listRow(recipeList, "recipeId", fallback?.id);
                (row?.querySelector<HTMLButtonElement>(`[data-recipe-action='${focused.dataset.recipeAction}']`) ?? createButton).focus();
            }
        }
        const active = currentId === null ? null : recipes.find(recipe => recipe.id === currentId) ?? null;
        recipeControls.hidden = active === null || active.source.mask.length === 0;
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
        circlePosition.setPosition(active.id, { x: active.rotationCentreX, y: active.rotationCentreY });
        recipeTurns.forEach(input => { input.checked = active.rotationTurns.includes(Number(input.value) as 90 | 180 | 270); });
        recipeTurns.forEach(input => { input.disabled = Number(input.value) !== 180
            && !Number.isInteger(active.rotationCentreX - active.rotationCentreY); });
        mirrorPosition.setPosition(active.id, { x: active.mirrorCentreX, y: active.mirrorCentreY });
        updateMirrorChoices();
        syncRecipeSections();
    }
    function setRecipeError(message: string | null) { setMessage(recipeError, message); }

    return { setSelectionState, setRecipes, setRecipeError };
}
