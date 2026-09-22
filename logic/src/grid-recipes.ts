import { Float, GridRecipe } from "./types";
import { evaluatePackedGrid, PackedGridEvaluation, TransformSourceCell } from "./transform-evaluator";

const noGrid = {
    left: 0, right: 0, up: 0, down: 0,
    columnSpacing: 0, rowSpacing: 0,
    columnSpacingAlternate: 0, rowSpacingAlternate: 0,
    columnOffset: 0, rowOffset: 0,
    columnOrientation: "same" as const, rowOrientation: "same" as const,
};

function recipeId(): string {
    return `recipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function gridRecipeFromFloat(float: Float): GridRecipe {
    return {
        id: recipeId(), enabled: true,
        source: { x: float.x, y: float.y, w: float.w, h: float.h,
            mask: Uint8Array.from(float.pixels, value => value === 0 ? 0 : 1) },
        mode: "grid",
        left: 0, right: 0, up: 0, down: 0,
        columnSpacing: 0, rowSpacing: 0,
        columnSpacingAlternate: 0, rowSpacingAlternate: 0,
        columnOffset: 0, rowOffset: 0,
        columnOrientation: "same", rowOrientation: "same",
        rotationCentreX: float.x + (float.w - 1) / 2,
        rotationCentreY: float.y + (float.h - 1) / 2,
        rotationTurns: [],
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
    if (typeof recipe.enabled !== "boolean") return "Recipe enabled state is required.";
    if (!Number.isSafeInteger(source.x) || !Number.isSafeInteger(source.y)
        || !Number.isSafeInteger(source.w) || !Number.isSafeInteger(source.h)
        || source.w <= 0 || source.h <= 0 || source.mask.length !== source.w * source.h
        || source.mask.some(value => value !== 0 && value !== 1)
        || !source.mask.some(value => value !== 0)) return "Recipe source must be a non-empty whole-cell selection.";
    if (recipe.mode !== "grid" && recipe.mode !== "rotation") return "Recipe mode is not supported.";
    if (!Number.isSafeInteger(recipe.rotationCentreX)
        && Math.abs(recipe.rotationCentreX % 1) !== 0.5) return "Rotation centre must be grid-compatible.";
    if (!Number.isSafeInteger(recipe.rotationCentreY)
        && Math.abs(recipe.rotationCentreY % 1) !== 0.5) return "Rotation centre must be grid-compatible.";
    if (!Array.isArray(recipe.rotationTurns)) return "Rotation supports only quarter turns.";
    try {
        const sourceCells = recipeSourceCells(recipe);
        const grid = evaluatePackedGrid(sourceCells, recipe);
        const rotation = evaluatePackedGrid(sourceCells, noGrid, {
            x: recipe.rotationCentreX,
            y: recipe.rotationCentreY,
            turns: recipe.rotationTurns,
        });
        return grid.conflicts.length === 0 && rotation.conflicts.length === 0
            ? null : "Recipe instances overlap.";
    } catch (error) {
        return error instanceof Error ? error.message : "Recipe is invalid.";
    }
}

export function evaluateGridRecipe(recipe: GridRecipe): PackedGridEvaluation {
    const source = recipeSourceCells(recipe);
    return recipe.mode === "rotation"
        ? evaluatePackedGrid(source, noGrid, {
            x: recipe.rotationCentreX,
            y: recipe.rotationCentreY,
            turns: recipe.rotationTurns,
        })
        : evaluatePackedGrid(source, recipe);
}

export function withRecipeSource(
    recipe: GridRecipe, float: Float, translation = { x: 0, y: 0 },
): GridRecipe {
    return {
        ...recipe,
        source: { x: float.x, y: float.y, w: float.w, h: float.h,
            mask: Uint8Array.from(float.pixels, value => value === 0 ? 0 : 1) },
        rotationCentreX: recipe.rotationCentreX + translation.x,
        rotationCentreY: recipe.rotationCentreY + translation.y,
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
        const recipe = raw as Partial<Omit<GridRecipe, "source">> & { source?: Partial<Omit<GridRecipe["source"], "mask">> & { mask?: unknown } };
        const source = recipe.source;
        if (!source || !Array.isArray(source.mask) || typeof recipe.id !== "string" || ids.has(recipe.id)) continue;
        const mask = Uint8Array.from(source.mask.map(Number));
        if (mask.length !== source.mask.length || mask.some(value => value !== 0 && value !== 1)) continue;
        const restored = {
            ...recipe,
            mode: recipe.mode ?? "grid",
            columnSpacingAlternate: recipe.columnSpacingAlternate ?? recipe.columnSpacing,
            rowSpacingAlternate: recipe.rowSpacingAlternate ?? recipe.rowSpacing,
            rotationCentreX: recipe.rotationCentreX ?? Number(source.x) + (Number(source.w) - 1) / 2,
            rotationCentreY: recipe.rotationCentreY ?? Number(source.y) + (Number(source.h) - 1) / 2,
            rotationTurns: recipe.rotationTurns ?? [],
            source: { ...source, mask },
        } as GridRecipe;
        if (gridRecipeError(restored) !== null) continue;
        ids.add(restored.id);
        recipes.push(restored);
    }
    return recipes;
}
