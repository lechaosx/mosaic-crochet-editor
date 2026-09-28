import { describe, expect, test } from "vitest";
import { emptyGridRecipe, evaluateGridRecipe, gridRecipeFromFloat, gridRecipeError, gridRecipesEqual, restoreGridRecipes, withRecipeSource } from "../src/grid-recipes";

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

    test("normalizes legacy alternate gaps to the visible single-gap values", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 3, h: 1, pixels: new Uint8Array([1, 0, 1]),
        });
        const restored = restoreGridRecipes([{
            ...recipe,
            right: 2,
            columnSpacing: 0,
            columnSpacingAlternate: 1,
            columnOrientation: "alternate-mirrored",
            source: { ...recipe.source, mask: [1, 0, 1] },
        }])[0];

        expect(restored).toMatchObject({
            id: recipe.id,
            columnSpacing: 0,
            columnSpacingAlternate: 0,
        });
        expect(evaluateGridRecipe(restored)).toMatchObject({
            columnStep: { x: 1, y: 0 },
            columnStepAlternate: { x: 1, y: 0 },
        });
    });

    test("can ignore recipe conflicts outside a paintable chart", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 1, h: 2, pixels: new Uint8Array([1, 1]),
        });
        Object.assign(recipe, {
            mode: "rotation",
            rotationCentreX: 1.5,
            rotationCentreY: 0.5,
            rotationTurns: [180, 270],
            mirrorHorizontal: true,
        });

        expect(gridRecipeError(recipe, () => true)).toMatch(/overlap/i);
        expect(gridRecipeError(recipe, (x, y) => x >= 0 && x < 2 && y >= 0 && y < 3)).toBeNull();
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
        recipe.columnOrientation = "alternate-mirrored";
        expect(gridRecipeError(recipe)).toBeNull();
    });

    test("rotation mode selects quarter turns without also applying the retained grid", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 1, w: 1, h: 2, pixels: new Uint8Array([1, 1]),
        });
        Object.assign(recipe, {
            mode: "rotation",
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
            mode: "rotation",
            rotationCentreX: 4,
            rotationCentreY: 3,
            mirrorHorizontal: true,
            mirrorVertical: true,
        });

        expect(evaluateGridRecipe(recipe).cells.map(({ x, y, sourceIndex }) => ({ x, y, sourceIndex }))).toEqual([
            { x: 2, y: 2, sourceIndex: 0 },
            { x: 3, y: 2, sourceIndex: 1 },
            { x: 5, y: 2, sourceIndex: 1 },
            { x: 6, y: 2, sourceIndex: 0 },
            { x: 2, y: 4, sourceIndex: 0 },
            { x: 3, y: 4, sourceIndex: 1 },
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
            columnOrientation: "alternate-mirrored",
        });

        expect(evaluateGridRecipe(recipe).instances.map(instance => instance.map(cell => cell.x))).toEqual([
            [0, 1], [3, 4], [6, 7],
        ]);
    });

    test("validates retained grid and rotation settings in either mode", () => {
        const recipe = gridRecipeFromFloat({
            x: 2, y: 1, w: 1, h: 1, pixels: new Uint8Array([1]),
        });
        recipe.mode = "rotation";
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
