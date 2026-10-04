import { Float, GridRecipe, SymKey } from "./types";
import { evaluateCenteredMirrors, evaluatePackedGrid, PackedGridEvaluation, TransformSourceCell } from "./transform-evaluator";

const noGrid = {
    left: 0, right: 0, up: 0, down: 0,
    columnSpacing: 0, rowSpacing: 0,
    columnSpacingAlternate: 0, rowSpacingAlternate: 0,
    columnOffset: 0, rowOffset: 0,
    columnMirrorHorizontal: false, columnMirrorVertical: false,
    rowMirrorHorizontal: false, rowMirrorVertical: false,
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
        columnMirrorHorizontal: false, columnMirrorVertical: false,
        rowMirrorHorizontal: false, rowMirrorVertical: false,
        rotationCentreX: float.x + (float.w - 1) / 2,
        rotationCentreY: float.y + (float.h - 1) / 2,
        rotationTurns: [],
        mirrorCentreX: float.x + (float.w - 1) / 2,
        mirrorCentreY: float.y + (float.h - 1) / 2,
        mirrorTypes: [],
    };
}

export function emptyGridRecipe(): GridRecipe {
    return {
        ...gridRecipeFromFloat({ x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array([1]) }),
        source: { x: 0, y: 0, w: 0, h: 0, mask: new Uint8Array() },
        rotationCentreX: 0,
        rotationCentreY: 0,
        mirrorCentreX: 0,
        mirrorCentreY: 0,
    };
}

export function recipeHasSource(recipe: GridRecipe): boolean {
    return recipe.source.mask.length > 0;
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

export function gridRecipeError(
    recipe: GridRecipe,
    paintable?: (x: number, y: number) => boolean,
): string | null {
    const { source } = recipe;
    if (typeof recipe.id !== "string" || recipe.id.length === 0) return "Recipe id is required.";
    if (typeof recipe.enabled !== "boolean") return "Recipe enabled state is required.";
    const emptySource = source.w === 0 && source.h === 0 && source.mask.length === 0;
    if (!Number.isSafeInteger(source.x) || !Number.isSafeInteger(source.y)
        || !Number.isSafeInteger(source.w) || !Number.isSafeInteger(source.h)
        || (!emptySource && (source.w <= 0 || source.h <= 0)) || source.mask.length !== source.w * source.h
        || source.mask.some(value => value !== 0 && value !== 1)
        || (!emptySource && !source.mask.some(value => value !== 0))) return "Recipe source must be an empty slot or a whole-cell selection.";
    if (!["none", "grid", "circle", "mirror"].includes(recipe.mode)) return "Selection mode is not supported.";
    if ([recipe.rotationCentreX, recipe.rotationCentreY, recipe.mirrorCentreX, recipe.mirrorCentreY]
        .some(value => typeof value !== "number" || !Number.isSafeInteger(value * 2))) return "Selection centre must use whole or half-cell coordinates.";
    if (!Array.isArray(recipe.rotationTurns) || recipe.rotationTurns.some(turn => ![90, 180, 270].includes(turn))) return "Circle supports only quarter turns.";
    if (!Array.isArray(recipe.mirrorTypes) || recipe.mirrorTypes.some(type => !["V", "H", "C", "D1", "D2"].includes(type))
        || new Set(recipe.mirrorTypes).size !== recipe.mirrorTypes.length) return "Mirror types are invalid.";
    if ([recipe.left, recipe.right, recipe.up, recipe.down].some(value => !Number.isSafeInteger(value) || value < 0)) return "Grid counts must be whole numbers that are zero or positive.";
    if ([recipe.columnSpacing, recipe.rowSpacing, recipe.columnSpacingAlternate, recipe.rowSpacingAlternate]
        .some(value => !Number.isSafeInteger(value) || value < 0)) return "Grid spacing must be whole numbers that are zero or positive.";
    if ([recipe.columnOffset, recipe.rowOffset].some(value => !Number.isSafeInteger(value))) return "Grid offsets must be whole numbers.";
    if ([recipe.columnMirrorHorizontal, recipe.columnMirrorVertical, recipe.rowMirrorHorizontal, recipe.rowMirrorVertical]
        .some(value => typeof value !== "boolean")) return "Grid mirror state must be boolean.";
    try {
        if (recipe.mode === "circle" && recipe.rotationTurns.some(turn => turn !== 180)
            && !Number.isInteger(recipe.rotationCentreX - recipe.rotationCentreY)) return "Quarter turns need matching whole-cell or half-cell centre coordinates.";
        if (recipe.mode === "mirror" && recipe.mirrorTypes.some(type => type === "D1" || type === "D2")
            && !Number.isInteger(recipe.mirrorCentreX - recipe.mirrorCentreY)) return "Diagonal mirrors need matching whole-cell or half-cell centre coordinates.";
        const evaluated = evaluateGridRecipe(emptySource ? { ...recipe,
            source: { x: source.x, y: source.y, w: 1, h: 1, mask: new Uint8Array([1]) } } : recipe);
        return !paintable || !evaluated.conflicts.some(cell => paintable(cell.x, cell.y))
            ? null : "Selection instances overlap.";
    } catch (error) {
        return error instanceof Error ? error.message : "Recipe is invalid.";
    }
}

export function evaluateGridRecipe(recipe: GridRecipe): PackedGridEvaluation {
    const source = recipeSourceCells(recipe);
    if (source.length === 0) return {
        source: [], placements: [],
        columnStep: { x: 0, y: 0 }, columnStepAlternate: { x: 0, y: 0 },
        rowStep: { x: 0, y: 0 }, rowStepAlternate: { x: 0, y: 0 },
        cells: [], conflicts: [], instances: [],
    };
    if (recipe.mode === "mirror") return evaluateCenteredMirrors(source, recipe.mirrorCentreX, recipe.mirrorCentreY,
        new Uint8Array(recipe.mirrorTypes.map(type => ({ V: 0, H: 1, C: 2, D1: 3, D2: 4 })[type])));
    return recipe.mode === "circle"
        ? evaluatePackedGrid(source, noGrid, {
            x: recipe.rotationCentreX,
            y: recipe.rotationCentreY,
            turns: recipe.rotationTurns,
        })
        : evaluatePackedGrid(source, recipe.mode === "none" ? noGrid : recipe);
}

export function withRecipeSource(
    recipe: GridRecipe, float: Float, translation = { x: 0, y: 0 },
): GridRecipe {
    const wasEmpty = !recipeHasSource(recipe);
    return {
        ...recipe,
        source: { x: float.x, y: float.y, w: float.w, h: float.h,
            mask: Uint8Array.from(float.pixels, value => value === 0 ? 0 : 1) },
        rotationCentreX: wasEmpty ? float.x + (float.w - 1) / 2 : recipe.rotationCentreX + translation.x,
        rotationCentreY: wasEmpty ? float.y + (float.h - 1) / 2 : recipe.rotationCentreY + translation.y,
        mirrorCentreX: wasEmpty ? float.x + (float.w - 1) / 2 : recipe.mirrorCentreX + translation.x,
        mirrorCentreY: wasEmpty ? float.y + (float.h - 1) / 2 : recipe.mirrorCentreY + translation.y,
    };
}

export function normalizeActiveRecipeId(
    recipes: ReadonlyArray<GridRecipe>, activeRecipeId: string | null, float: Float | null,
): string | null {
    const recipe = recipes.find(candidate => candidate.id === activeRecipeId) ?? recipes[0];
    if (!recipe) return null;
    if (float === null) return recipe.id;
    if (!recipeHasSource(recipe)) return recipe.id;
    const source = recipe.source;
    if (source.x !== float.x || source.y !== float.y || source.w !== float.w || source.h !== float.h) return null;
    if (float.pixels.length !== source.mask.length) return null;
    for (let i = 0; i < source.mask.length; i++) {
        if ((source.mask[i] !== 0) !== (float.pixels[i] !== 0)) return null;
    }
    return recipe.id;
}

export function storedGridRecipes(recipes: ReadonlyArray<GridRecipe>): unknown[] {
    return recipes.map(recipe => ({ ...recipe, enabled: true, source: { ...recipe.source, mask: Array.from(recipe.source.mask) } }));
}

export function gridRecipesEqual(a: ReadonlyArray<GridRecipe>, b: ReadonlyArray<GridRecipe>): boolean {
    const fields = ["enabled", "mode", "left", "right", "up", "down", "columnSpacing", "rowSpacing",
        "columnSpacingAlternate", "rowSpacingAlternate", "columnOffset", "rowOffset",
        "columnMirrorHorizontal", "columnMirrorVertical", "rowMirrorHorizontal", "rowMirrorVertical",
        "rotationCentreX", "rotationCentreY", "mirrorCentreX", "mirrorCentreY"] as const;
    return a.length === b.length && a.every((recipe, index) => {
        const other = b[index];
        const bothEmpty = recipe.source.mask.length === 0 && other.source.mask.length === 0;
        return (bothEmpty || recipe.id === other.id)
            && fields.every(field => recipe[field] === other[field])
            && [...recipe.mirrorTypes].sort().join(",") === [...other.mirrorTypes].sort().join(",")
            && [...recipe.rotationTurns].sort().join(",") === [...other.rotationTurns].sort().join(",")
            && recipe.source.x === other.source.x && recipe.source.y === other.source.y
            && recipe.source.w === other.source.w && recipe.source.h === other.source.h
            && recipe.source.mask.length === other.source.mask.length
            && recipe.source.mask.every((value, maskIndex) => value === other.source.mask[maskIndex]);
    });
}

export function restoreGridRecipes(value: unknown, legacy = true): GridRecipe[] {
    if (!Array.isArray(value)) return [emptyGridRecipe()];
    const ids = new Set<string>();
    const recipes: GridRecipe[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const recipe = raw as { columnOrientation?: unknown; rowOrientation?: unknown; mode?: string;
            mirrorHorizontal?: boolean; mirrorVertical?: boolean } & Partial<Omit<GridRecipe, "source" | "mode">> & { source?: Partial<Omit<GridRecipe["source"], "mask">> & { mask?: unknown } };
        const source = recipe.source;
        if (!source || !Array.isArray(source.mask) || typeof recipe.id !== "string" || ids.has(recipe.id)
            || typeof recipe.enabled !== "boolean") continue;
        if ([recipe.rotationCentreX, recipe.rotationCentreY, recipe.mirrorCentreX, recipe.mirrorCentreY]
            .some(value => value !== undefined && typeof value !== "number")
            || (recipe.rotationTurns !== undefined && !Array.isArray(recipe.rotationTurns))
            || (recipe.mirrorTypes !== undefined && !Array.isArray(recipe.mirrorTypes))) continue;
        if (!legacy && (typeof recipe.mode !== "string" || recipe.mode === "rotation" || recipe.mirrorTypes === undefined
            || recipe.mirrorCentreX === undefined || recipe.mirrorCentreY === undefined
            || recipe.rotationCentreX === undefined || recipe.rotationCentreY === undefined
            || recipe.rotationTurns === undefined || recipe.columnSpacingAlternate === undefined
            || recipe.rowSpacingAlternate === undefined || mirrorLegacyFields(raw))) continue;
        if (source.mask.some(value => value !== 0 && value !== 1)) continue;
        const mask = Uint8Array.from(source.mask as number[]);
        const { columnOrientation, rowOrientation, mirrorHorizontal, mirrorVertical, ...current } = recipe;
        if ((mirrorHorizontal !== undefined && typeof mirrorHorizontal !== "boolean")
            || (mirrorVertical !== undefined && typeof mirrorVertical !== "boolean")) continue;
        const legacyOrientation = [recipe.columnMirrorHorizontal, recipe.columnMirrorVertical,
            recipe.rowMirrorHorizontal, recipe.rowMirrorVertical].every(value => value === undefined);
        if (legacyOrientation && [columnOrientation, rowOrientation]
            .some(value => value !== "same" && value !== "alternate-mirrored")) continue;
        const restored = {
            ...current,
            columnMirrorHorizontal: legacyOrientation ? columnOrientation === "alternate-mirrored" : recipe.columnMirrorHorizontal,
            columnMirrorVertical: legacyOrientation ? false : recipe.columnMirrorVertical,
            rowMirrorHorizontal: legacyOrientation ? false : recipe.rowMirrorHorizontal,
            rowMirrorVertical: legacyOrientation ? rowOrientation === "alternate-mirrored" : recipe.rowMirrorVertical,
            enabled: true,
            mode: recipe.mode === "rotation" ? recipe.rotationTurns?.length || (!mirrorHorizontal && !mirrorVertical)
                ? "circle" : "mirror" : recipe.mode ?? "grid",
            columnSpacingAlternate: recipe.mirrorTypes === undefined ? recipe.columnSpacing : recipe.columnSpacingAlternate,
            rowSpacingAlternate: recipe.mirrorTypes === undefined ? recipe.rowSpacing : recipe.rowSpacingAlternate,
            rotationCentreX: recipe.rotationCentreX ?? Number(source.x) + (Number(source.w) - 1) / 2,
            rotationCentreY: recipe.rotationCentreY ?? Number(source.y) + (Number(source.h) - 1) / 2,
            rotationTurns: recipe.rotationTurns ?? [],
            mirrorCentreX: recipe.mirrorCentreX ?? recipe.rotationCentreX ?? Number(source.x) + (Number(source.w) - 1) / 2,
            mirrorCentreY: recipe.mirrorCentreY ?? recipe.rotationCentreY ?? Number(source.y) + (Number(source.h) - 1) / 2,
            mirrorTypes: recipe.mirrorTypes ?? [...(mirrorHorizontal ? ["V"] : []), ...(mirrorVertical ? ["H"] : [])] as SymKey[],
            source: { ...source, mask },
        } as GridRecipe;
        if (gridRecipeError(restored) !== null) continue;
        ids.add(restored.id);
        recipes.push(restored);
    }
    return recipes.length > 0 || (!legacy && value.length > 0) ? recipes : [emptyGridRecipe()];
}

function mirrorLegacyFields(value: object): boolean {
    return "mirrorHorizontal" in value || "mirrorVertical" in value || "columnOrientation" in value || "rowOrientation" in value;
}

export function legacySelectionBehaviorChanged(value: unknown): boolean {
    return Array.isArray(value) && value.some(raw => {
        if (typeof raw !== "object" || raw === null) return false;
        const recipe = raw as Record<string, unknown>;
        return recipe.mode === "rotation" && recipe.mirrorTypes === undefined
            && ((Array.isArray(recipe.rotationTurns) && recipe.rotationTurns.length > 0
                && (recipe.mirrorHorizontal === true || recipe.mirrorVertical === true))
                || (recipe.mirrorHorizontal === true && recipe.mirrorVertical === true));
    });
}

export function withGridStep(recipe: GridRecipe, axis: "column" | "row", step: { x: number; y: number }): GridRecipe {
    const candidate = axis === "column"
        ? { ...recipe, columnOffset: Math.round(step.y), columnSpacing: 0, columnSpacingAlternate: 0 }
        : { ...recipe, rowOffset: Math.round(step.x), rowSpacing: 0, rowSpacingAlternate: 0 };
    const evaluated = evaluateGridRecipe(candidate);
    const spacing = Math.max(0, Math.round(axis === "column" ? step.x - evaluated.columnStep.x : step.y - evaluated.rowStep.y));
    return axis === "column" ? { ...candidate, columnSpacing: spacing, columnSpacingAlternate: spacing }
        : { ...candidate, rowSpacing: spacing, rowSpacingAlternate: spacing };
}
