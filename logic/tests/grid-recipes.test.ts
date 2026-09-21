import { describe, expect, test } from "vitest";
import { evaluateGridRecipe, gridRecipeFromFloat, gridRecipeError } from "../src/grid-recipes";

describe("saved grid recipes", () => {
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
    });

    test("rejects collision-prone and future-only fields outside their inert defaults", () => {
        const recipe = gridRecipeFromFloat({
            x: 0, y: 0, w: 2, h: 1, pixels: new Uint8Array([1, 1]),
        });
        recipe.right = 1;
        recipe.columnSpacing = -1;
        expect(gridRecipeError(recipe)).toMatch(/spacing/i);
        recipe.columnSpacing = 0;
        recipe.columnOffset = 1;
        expect(gridRecipeError(recipe)).toMatch(/offset/i);
    });
});
