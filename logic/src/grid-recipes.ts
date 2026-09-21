import { Float, GridRecipe } from "./types";
import { evaluatePackedGrid, PackedGridEvaluation, TransformSourceCell } from "./transform-evaluator";

function recipeId(): string {
    return `recipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function gridRecipeFromFloat(float: Float): GridRecipe {
    return {
        id: recipeId(), enabled: true,
        source: { x: float.x, y: float.y, w: float.w, h: float.h,
            mask: Uint8Array.from(float.pixels, value => value === 0 ? 0 : 1) },
        left: 0, right: 0, up: 0, down: 0,
        columnSpacing: 0, rowSpacing: 0,
        columnOffset: 0, rowOffset: 0,
        columnOrientation: "same", rowOrientation: "same",
    };
}

export function recipeSourceCells(recipe: GridRecipe): TransformSourceCell[] {
    const { source } = recipe;
    const cells: TransformSourceCell[] = [];
    for (let y = 0; y < source.h; y++) {
        for (let x = 0; x < source.w; x++) {
            if (source.mask[y * source.w + x] !== 0) cells.push({ x: source.x + x, y: source.y + y });
        }
    }
    return cells;
}

export function gridRecipeError(recipe: GridRecipe): string | null {
    const { source } = recipe;
    if (typeof recipe.id !== "string" || recipe.id.length === 0) return "Recipe id is required.";
    if (!Number.isSafeInteger(source.x) || !Number.isSafeInteger(source.y)
        || !Number.isSafeInteger(source.w) || !Number.isSafeInteger(source.h)
        || source.w <= 0 || source.h <= 0 || source.mask.length !== source.w * source.h
        || !source.mask.some(value => value !== 0)) return "Recipe source must be a non-empty whole-cell selection.";
    if (recipe.left !== 0 || recipe.up !== 0) return "Basic recipes place additional instances right and down.";
    if (recipe.columnOffset !== 0 || recipe.rowOffset !== 0) return "Grid offsets are not available yet.";
    if (recipe.columnOrientation !== "same" || recipe.rowOrientation !== "same") {
        return "Mirrored grid instances are not available yet.";
    }
    try {
        const evaluated = evaluateGridRecipe(recipe);
        return evaluated.conflicts.length === 0 ? null : "Recipe instances overlap.";
    } catch (error) {
        return error instanceof Error ? error.message : "Recipe is invalid.";
    }
}

export function evaluateGridRecipe(recipe: GridRecipe): PackedGridEvaluation {
    return evaluatePackedGrid(recipeSourceCells(recipe), recipe);
}

export function withRecipeSource(recipe: GridRecipe, float: Float): GridRecipe {
    return {
        ...recipe,
        source: { x: float.x, y: float.y, w: float.w, h: float.h,
            mask: Uint8Array.from(float.pixels, value => value === 0 ? 0 : 1) },
    };
}

export function normalizeActiveRecipeId(
    recipes: ReadonlyArray<GridRecipe>, activeRecipeId: string | null, float: Float | null,
): string | null {
    if (activeRecipeId === null || float === null) return null;
    const recipe = recipes.find(candidate => candidate.id === activeRecipeId);
    if (!recipe) return null;
    const source = recipe.source;
    if (source.x !== float.x || source.y !== float.y || source.w !== float.w || source.h !== float.h) return null;
    if (float.pixels.length !== source.mask.length) return null;
    for (let i = 0; i < source.mask.length; i++) {
        if ((source.mask[i] !== 0) !== (float.pixels[i] !== 0)) return null;
    }
    return activeRecipeId;
}

export function storedGridRecipes(recipes: ReadonlyArray<GridRecipe>): unknown[] {
    return recipes.map(recipe => ({ ...recipe, source: { ...recipe.source, mask: Array.from(recipe.source.mask) } }));
}

export function restoreGridRecipes(value: unknown): GridRecipe[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    const recipes: GridRecipe[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const recipe = raw as Omit<GridRecipe, "source"> & { source?: Omit<GridRecipe["source"], "mask"> & { mask?: unknown } };
        const source = recipe.source;
        if (!source || !Array.isArray(source.mask) || ids.has(recipe.id)) continue;
        const mask = Uint8Array.from(source.mask.map(Number));
        if (mask.length !== source.mask.length || mask.some(value => value !== 0 && value !== 1)) continue;
        const restored: GridRecipe = { ...recipe, source: { ...source, mask } };
        if (gridRecipeError(restored) !== null) continue;
        ids.add(restored.id);
        recipes.push(restored);
    }
    return recipes;
}
