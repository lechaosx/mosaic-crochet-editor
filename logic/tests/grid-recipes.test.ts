import { initialize_round_pattern } from "@mosaic/wasm";
import { encodeMcw, decodeMcw } from "../src/mcw";
import { describe, expect, test } from "vitest";
import { emptyGridRecipe, evaluateGridRecipe, gridRecipeFromFloat, gridRecipeError, gridRecipesEqual, restoreGridRecipes, withRecipeSource, recipesForPattern, storedGridRecipes } from "../src/grid-recipes";

describe("saved grid recipes", () => {
    test("missing saved selections migrate to one editable empty slot", () => {
        const recipes = restoreGridRecipes(undefined);

        expect(recipes).toHaveLength(1);
        expect(recipes[0]).toMatchObject({
            mode: "grid",
            source: { x: 0, y: 0, w: 0, h: 0 },
        });
        expect(recipes[0].source.mask).toEqual(new Uint8Array());
        expect(gridRecipeError(recipes[0])).toBeNull();
        expect(evaluateGridRecipe(recipes[0])).toMatchObject({ cells: [], conflicts: [], instances: [] });
    });

    test("an explicitly empty saved selection round-trips without replacing its id", () => {
        const empty = emptyGridRecipe();
        const [restored] = restoreGridRecipes([{ ...empty, source: { ...empty.source, mask: [] } }]);

        expect(restored.id).toBe(empty.id);
        expect(restored.source.mask).toEqual(new Uint8Array());
    });

    test("compares generated empty slots by configuration but populated selections by id", () => {
        const empty = emptyGridRecipe();
        const otherEmpty = { ...emptyGridRecipe(), source: { ...empty.source } };
        expect(gridRecipesEqual([empty], [otherEmpty])).toBe(true);
        expect(gridRecipesEqual([empty], [{ ...otherEmpty, right: 1 }])).toBe(false);
        expect(gridRecipesEqual([empty], [otherEmpty, emptyGridRecipe()])).toBe(false);

        const populated = gridRecipeFromFloat({
            x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        expect(gridRecipesEqual([populated], [{ ...populated, id: "different" }])).toBe(false);
    });

    test("legacy disabled recipes are restored as live", () => {
        const recipe = gridRecipeFromFloat({
            x: 1, y: 1, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        const legacy = {
            ...recipe,
            enabled: false,
            source: { ...recipe.source, mask: Array.from(recipe.source.mask) },
        };

        expect(restoreGridRecipes([legacy])[0].enabled).toBe(true);
    });

    test("retains modern alternate gaps without changing the primary gap", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 3, h: 1, pixels: new Uint8Array([1, 0, 1]),
        });
        const restored = restoreGridRecipes([{
            ...recipe,
            right: 2,
            columnSpacing: 0,
            columnSpacingAlternate: 1,
            columnMirrorHorizontal: true,
            source: { ...recipe.source, mask: [1, 0, 1] },
        }])[0];

        expect(restored).toMatchObject({
            id: recipe.id,
            columnSpacing: 0,
            columnSpacingAlternate: 1,
        });
        expect(evaluateGridRecipe(restored)).toMatchObject({
            columnStep: { x: 1, y: 0 },
            columnStepAlternate: { x: 2, y: 0 },
        });
    });

    test("can ignore recipe conflicts outside a paintable chart", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 1, h: 3, pixels: new Uint8Array([1, 0, 1]),
        });
        Object.assign(recipe, {
            mode: "circle",
            rotationCentreX: 0,
            rotationCentreY: 1,
            rotationTurns: [90, 270],
        });

        expect(gridRecipeError(recipe, () => true)).toMatch(/overlap/i);
        expect(gridRecipeError(recipe, (x, y) => x >= 0 && x < 1 && y >= 0 && y < 3)).toBeNull();
    });

    test("uses a sparse active selection as an absolute packed source", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 3, w: 3, h: 1, pixels: new Uint8Array([1, 0, 1]),
        });
        recipe.right = 1;

        const evaluated = evaluateGridRecipe(recipe);
        expect(evaluated.cells).toEqual([
            { x: 2, y: 3, sourceIndex: 0 },
            { x: 3, y: 3, sourceIndex: 0 },
            { x: 4, y: 3, sourceIndex: 1 },
            { x: 5, y: 3, sourceIndex: 1 },
        ]);
        expect(evaluated.conflicts).toEqual([]);
        expect(recipe).toMatchObject({
            mode: "grid",
            columnSpacingAlternate: 0,
            rowSpacingAlternate: 0,
            rotationTurns: [],
            rotationCentreX: 3,
            rotationCentreY: 3,
        });
    });

    test("accepts directional angled mirrored grids and rejects invalid spacing", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        recipe.right = 1;
        recipe.columnSpacing = -1;
        expect(gridRecipeError(recipe)).toMatch(/spacing/i);
        recipe.columnSpacing = 0;
        recipe.columnOffset = 1;
        recipe.left = 1;
        recipe.up = 1;
        recipe.rowOffset = 2;
        recipe.columnMirrorHorizontal = true;
        expect(gridRecipeError(recipe)).toBeNull();
    });

    test("rotation mode selects quarter turns without also applying the retained grid", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 1, w: 1, h: 2, pixels: new Uint8Array([1, 1]),
        });
        Object.assign(recipe, {
            mode: "circle",
            rotationCentreX: 1,
            rotationCentreY: 1,
            rotationTurns: [90, 270],
            right: 4,
            down: 4,
        });

        const evaluated = evaluateGridRecipe(recipe);
        expect(evaluated.cells).toHaveLength(6);
        expect(evaluated.cells.every(cell => cell.x >= 0 && cell.x <= 2 && cell.y >= 0 && cell.y <= 2)).toBe(true);
        expect(gridRecipeError(recipe)).toBeNull();
    });

    test("whole-selection horizontal and vertical mirror copies share the transformation centre", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 2, w: 2, h: 1, pixels: new Uint8Array([1, 1]),
        });
        Object.assign(recipe, {
            mode: "mirror",
            mirrorCentreX: 4,
            mirrorCentreY: 3,
            mirrorTypes: ["V", "H"],
        });

        expect(evaluateGridRecipe(recipe).cells.map(({ x, y, sourceIndex }) => ({ x, y, sourceIndex }))).toEqual([
            { x: 2, y: 2, sourceIndex: 0 },
            { x: 3, y: 2, sourceIndex: 1 },
            { x: 5, y: 2, sourceIndex: 1 },
            { x: 6, y: 2, sourceIndex: 0 },
            { x: 2, y: 4, sourceIndex: 0 },
            { x: 3, y: 4, sourceIndex: 1 },
            { x: 5, y: 4, sourceIndex: 1 },
            { x: 6, y: 4, sourceIndex: 0 },
        ]);
    });

    test("mirrored grid copies use the one configured gap in every step", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 2, h: 1, pixels: new Uint8Array([1, 1]),
        });
        Object.assign(recipe, {
            right: 2,
            columnSpacing: 1,
            columnSpacingAlternate: 1,
            columnMirrorHorizontal: true,
        });

        expect(evaluateGridRecipe(recipe).instances.map(instance => instance.map(cell => cell.x))).toEqual([
            [0, 1], [3, 4], [6, 7],
        ]);
    });

    test("validates retained grid and rotation settings in either mode", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 1, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        recipe.mode = "circle";
        recipe.left = -1;
        expect(gridRecipeError(recipe)).toMatch(/counts/i);

        recipe.left = 0;
        recipe.mode = "grid";
        recipe.rotationCentreX = 0.25;
        expect(gridRecipeError(recipe)).toMatch(/centre/i);

        recipe.rotationCentreX = 2;
        recipe.rotationTurns = [45 as 90];
        expect(gridRecipeError(recipe)).toMatch(/quarter turns/i);
    });

    test.each([
        ["add left", { x: 1, y: 2, w: 3, h: 1, pixels: new Uint8Array([1, 1, 1]) }],
        ["add right", { x: 2, y: 2, w: 3, h: 1, pixels: new Uint8Array([1, 1, 1]) }],
        ["remove left", { x: 3, y: 2, w: 1, h: 1, pixels: new Uint8Array([1]) }],
        ["remove right", { x: 2, y: 2, w: 1, h: 1, pixels: new Uint8Array([1]) }],
    ])("preserves an absolute rotation centre after %s", (_operation, float) => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 2, w: 2, h: 1, pixels: new Uint8Array([1, 1]),
        });
        recipe.rotationCentreX = 4;
        recipe.rotationCentreY = 5;

        expect(withRecipeSource(recipe, float)).toMatchObject({
            rotationCentreX: 4,
            rotationCentreY: 5,
        });
    });

    test("translates a rotation centre only for an explicit source translation", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 2, w: 2, h: 1, pixels: new Uint8Array([1, 1]),
        });
        recipe.rotationCentreX = 4;
        recipe.rotationCentreY = 5;

        expect(withRecipeSource(recipe, {
            x: 6, y: 1, w: 2, h: 1, pixels: new Uint8Array([1, 1]),
        }, { x: 3, y: -1 })).toMatchObject({
            rotationCentreX: 7,
            rotationCentreY: 4,
        });
    });
});


test("recovery and history migrate legacy orientations and validate all mirror flags", () => {
    const recipe = gridRecipeFromFloat({ x: 0, y: 0, w: 2, h: 1, pixels: new Uint8Array([1, 2]) });
    const legacy: Record<string, unknown> = { ...recipe, columnOrientation: "alternate-mirrored",
        rowOrientation: "alternate-mirrored", source: { ...recipe.source, mask: [1, 1] } };
    for (const field of ["columnMirrorHorizontal", "columnMirrorVertical", "rowMirrorHorizontal", "rowMirrorVertical"]) delete legacy[field];
    expect(restoreGridRecipes([legacy])[0]).toMatchObject({ columnMirrorHorizontal: true,
        columnMirrorVertical: false, rowMirrorHorizontal: false, rowMirrorVertical: true });
    expect(restoreGridRecipes([{ ...legacy, columnOrientation: "invalid" }])[0].source.w).toBe(0);
    const modern = { ...recipe, columnMirrorHorizontal: true, columnMirrorVertical: true,
        rowMirrorHorizontal: true, rowMirrorVertical: true, source: { ...recipe.source, mask: [1, 1] } };
    expect(restoreGridRecipes([modern])[0]).toMatchObject({ columnMirrorHorizontal: true,
        columnMirrorVertical: true, rowMirrorHorizontal: true, rowMirrorVertical: true });
    for (const field of ["columnMirrorHorizontal", "columnMirrorVertical", "rowMirrorHorizontal", "rowMirrorVertical"]) {
        expect(restoreGridRecipes([{ ...modern, [field]: "true" }])[0].source.w).toBe(0);
    }
});

test("geometry pruning clips sources to actual cells and removes vanished sources", () => {
    const source = gridRecipeFromFloat({ x: 1, y: 0, w: 3, h: 2, pixels: new Uint8Array(6).fill(1) });
    const removed = gridRecipeFromFloat({ x: 4, y: 0, w: 1, h: 1, pixels: new Uint8Array([1]) });
    const result = recipesForPattern([source, removed], { mode: "row", canvasWidth: 3, canvasHeight: 2 }, new Uint8Array([1, 1, 0, 1, 1, 1]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(source.id);
    expect(result[0].source).toEqual({ x: 1, y: 0, w: 2, h: 2, mask: new Uint8Array([1, 0, 1, 1]) });
    expect(recipesForPattern([removed], { mode: "row", canvasWidth: 3, canvasHeight: 2 }, new Uint8Array(6).fill(1))[0].source.mask).toHaveLength(0);
});

test("large saved selections survive pruning", () => {
    const recipe = gridRecipeFromFloat({ x: 0, y: 0, w: 500, h: 500, pixels: new Uint8Array(250000).fill(1) });
    expect(recipesForPattern([recipe], { mode: "row", canvasWidth: 500, canvasHeight: 500 }, new Uint8Array(250000).fill(1))[0].source.mask).toHaveLength(250000);
});
test("source pruning follows bottom-anchored row preservation", () => {
    const recipe = gridRecipeFromFloat({ x: 1, y: 3, w: 1, h: 1, pixels: new Uint8Array([1]) });
    expect(recipesForPattern([recipe], { mode: "row", canvasWidth: 3, canvasHeight: 3 }, new Uint8Array(9).fill(1), { mode: "row", canvasWidth: 3, canvasHeight: 5 })[0].source).toMatchObject({ x: 1, y: 1, w: 1, h: 1 });
});
test("source pruning follows round preservation into a half extent", () => {
    const recipe = gridRecipeFromFloat({ x: 0, y: 5, w: 1, h: 1, pixels: new Uint8Array([1]) });
    const old = { mode: "round" as const, canvasWidth: 6, canvasHeight: 6, virtualWidth: 6, virtualHeight: 6, offsetX: 0, offsetY: 0, rounds: 2 };
    const next = { ...old, canvasHeight: 4, offsetY: 2 };
    expect(recipesForPattern([recipe], next, new Uint8Array(24).fill(1), old)[0].source).toMatchObject({ x: 0, y: 3, w: 1, h: 1 });
});

test("round resize keeps editable source while disabling newly overlapping copies", () => {
    const old = { mode: "round" as const, canvasWidth: 8, canvasHeight: 8, virtualWidth: 8, virtualHeight: 8, offsetX: 0, offsetY: 0, rounds: 2 };
    const next = { ...old, canvasWidth: 6, virtualWidth: 6 };
    const oldPixels = initialize_round_pattern(8, 8, 8, 8, 0, 0, 2);
    const pixels = initialize_round_pattern(6, 8, 6, 8, 0, 0, 2);
    const recipe = { ...gridRecipeFromFloat({ x: 0, y: 0, w: 7, h: 3,
        pixels: Uint8Array.from({ length: 21 }, (_, index) => Math.floor(index / 7) === 2 && index % 7 >= 2 && index % 7 <= 5 ? 0 : 1) }),
        mode: "circle" as const, rotationTurns: [180] as (90 | 180 | 270)[], rotationCentreX: 2, rotationCentreY: 2 };
    expect(gridRecipeError(recipe, (x, y) => x >= 0 && x < 8 && y >= 0 && y < 8 && oldPixels[y * 8 + x] !== 0)).toBeNull();
    const recipes = recipesForPattern([recipe], next, pixels, old);
    expect(gridRecipeError(recipes[0], (x, y) => x >= 0 && x < 6 && y >= 0 && y < 8 && pixels[y * 6 + x] !== 0)).toBeNull();
    expect(recipes[0]).toMatchObject({ id: recipe.id, mode: "none", rotationTurns: [180], rotationCentreX: 2, rotationCentreY: 2,
        source: { x: 0, y: 0, w: 5, h: 3 } });
    expect(evaluateGridRecipe(recipes[0]).conflicts).toEqual([]);
    expect(restoreGridRecipes(JSON.parse(JSON.stringify(storedGridRecipes(recipes))), false)).toEqual(recipes);
    const document = { pattern: next, pixels, recipes, mirrors: [], colorA: "#000000", colorB: "#ffffff" };
    expect(decodeMcw(encodeMcw(document)).recipes).toEqual(recipes);
});

test("row clipping translates transform centres with the geometry rather than the source bounds", () => {
    const recipe = { ...gridRecipeFromFloat({ x: 1, y: 0, w: 1, h: 3, pixels: new Uint8Array([1, 1, 1]) }),
        mode: "circle" as const, rotationTurns: [180] as (90 | 180 | 270)[], rotationCentreX: 1, rotationCentreY: 3 };
    const [updated] = recipesForPattern([recipe], { mode: "row", canvasWidth: 3, canvasHeight: 5 }, new Uint8Array(15).fill(1), { mode: "row", canvasWidth: 3, canvasHeight: 7 });
    expect(updated).toMatchObject({ mode: "circle", rotationCentreX: 1, rotationCentreY: 1, source: { x: 1, y: 0, w: 1, h: 1 } });
    expect(evaluateGridRecipe(updated).cells.map(({ x, y }) => [x, y])).toContainEqual([1, 2]);
});

test("nonuniform round preservation deactivates copies while retaining their settings", () => {
    const old = { mode: "round" as const, canvasWidth: 8, canvasHeight: 8, virtualWidth: 8, virtualHeight: 8, offsetX: 0, offsetY: 0, rounds: 2 };
    const next = { ...old, canvasWidth: 6, virtualWidth: 6 };
    const recipe = { ...gridRecipeFromFloat({ x: 0, y: 0, w: 8, h: 1, pixels: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 1]) }),
        mode: "circle" as const, rotationTurns: [180] as (90 | 180 | 270)[], rotationCentreX: 3.5, rotationCentreY: 3.5 };
    const [updated] = recipesForPattern([recipe], next, initialize_round_pattern(6, 8, 6, 8, 0, 0, 2), old);
    expect(updated).toMatchObject({ mode: "none", rotationTurns: [180], rotationCentreX: 3.5, rotationCentreY: 3.5 });
    expect(updated.source.mask).toEqual(new Uint8Array([1, 0, 0, 0, 0, 1]));
});

test("round preservation translates centres for distant source cells", () => {
    const old = { mode: "round" as const, canvasWidth: 20, canvasHeight: 20, virtualWidth: 20, virtualHeight: 20, offsetX: 0, offsetY: 0, rounds: 2 };
    const next = { ...old, canvasWidth: 22, virtualWidth: 22 };
    const recipe = gridRecipeFromFloat({ x: 19, y: 19, w: 1, h: 1, pixels: new Uint8Array([1]) });
    expect(recipesForPattern([recipe], next, initialize_round_pattern(22, 20, 22, 20, 0, 0, 2), old)[0]).toMatchObject({
        mode: "grid", source: { x: 21, y: 19, w: 1, h: 1 }, rotationCentreX: 21, rotationCentreY: 19, mirrorCentreX: 21, mirrorCentreY: 19,
    });
});
