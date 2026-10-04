import { describe, expect, test } from "vitest";
import { evaluateGridRecipe, gridRecipeError, gridRecipeFromFloat, gridRecipesEqual, restoreGridRecipes, storedGridRecipes, withGridStep, withRecipeSource } from "../src/grid-recipes";
import type { GridRecipe } from "../src/types";
import { initialize_round_pattern, instruction_start_round } from "@mosaic/wasm";
import { paintOps } from "../src/paint";
import { Store, visiblePixels } from "../src/store";
import { anchorIntoCanvas, applyGridRecipe } from "../src/selection";
import { decodeMcw, encodeMcw } from "../src/mcw";
import { rowSession } from "./_helpers";

function source() {
    return gridRecipeFromFloat({ x: 3, y: 3, w: 1, h: 1, pixels: new Uint8Array([2]) });
}
function transformed(mode: string) {
    return { ...source(), mode, right: 2, rotationCentreX: 2, rotationCentreY: 2,
        rotationTurns: [90], mirrorCentreX: 2, mirrorCentreY: 2, mirrorTypes: ["V", "H"] } as unknown as GridRecipe;
}
const destinations = (recipe: GridRecipe) => evaluateGridRecipe(recipe).cells.map(({ x, y }) => [x, y]);

describe("exclusive selection transforms", () => {
    test.each(["rotationCentreX", "rotationCentreY", "mirrorCentreX", "mirrorCentreY"])(
        "centre field %s requires a numeric value", field => {
            for (const value of ["2", false, null]) {
                expect(gridRecipeError({ ...source(), [field]: value } as unknown as GridRecipe)).not.toBeNull();
            }
        });
    test("independent type and chosen-turn order do not change selection meaning", () => {
        const recipe = { ...transformed("mirror"), rotationTurns: [90, 270] } as GridRecipe;
        expect(gridRecipesEqual([recipe], [{ ...recipe, mirrorTypes: ["H", "V"], rotationTurns: [270, 90] }])).toBe(true);
        expect(gridRecipesEqual([recipe], [{ ...recipe, mirrorTypes: ["V"] }])).toBe(false);
        expect(gridRecipesEqual([recipe], [{ ...recipe, rotationTurns: [90] }])).toBe(false);
    });
    test("recipe and source record key order do not change selection meaning", () => {
        const recipe = transformed("mirror");
        const reordered = Object.fromEntries(Object.entries({ ...recipe,
            source: Object.fromEntries(Object.entries(recipe.source).reverse()) }).reverse()) as unknown as GridRecipe;
        expect(gridRecipesEqual([recipe], [reordered])).toBe(true);
    });
    test.each(["full", "half", "quarter"] as const)("%s extent clips mirrors and quarters while composed Save and instructions preserve the source", extent => {
        const W = extent === "quarter" ? 4 : 7, H = extent === "full" ? 7 : 4;
        const pattern = { mode: "round" as const, canvasWidth: W, canvasHeight: H,
            virtualWidth: 7, virtualHeight: 7, offsetX: 0, offsetY: 0, rounds: 3 };
        const natural = initialize_round_pattern(W, H, 7, 7, 0, 0, 3);
        const pixels = natural.map(value => value === 0 ? 0 : 1);
        const float = { x: 1, y: 1, w: 1, h: 1, pixels: new Uint8Array([2]) };
        for (const mode of ["none", "circle", "mirror"] as const) {
            const recipe = { ...gridRecipeFromFloat(float), mode, right: 9, rotationCentreX: 2, rotationCentreY: 2,
                rotationTurns: [90, 180, 270], mirrorCentreX: 2, mirrorCentreY: 2, mirrorTypes: ["V", "H"] } as GridRecipe;
            const store = new Store(rowSession(W, H, { pattern, pixels: pixels.slice(), float,
                recipes: [recipe], activeRecipeId: recipe.id }));
            expect(applyGridRecipe(store)).toBe(mode === "none" ? "unchanged" : "applied");
            expect(store.state.pixels[1 * W + 3]).toBe(mode === "none" ? 1 : 2);
            expect(store.state.pixels[3 * W + 1]).toBe(mode === "none" ? 1 : 2);
            expect(store.state.pixels[3 * W + 3]).toBe(0);
            if (mode !== "none") {
                const painted = paintOps.pencil({ visible: visiblePixels(store.state), pattern, x: 3, y: 1, color: 1,
                    invertVisited: null, transforms: new Float64Array(), shifted: null, repeat: evaluateGridRecipe(recipe) });
                expect(painted[W + 1]).toBe(1);
                expect(painted[3 * W + 1]).toBe(1);
                expect(painted[3 * W + 3]).toBe(0);
            }
            const composed = { ...store.state, ...anchorIntoCanvas(store.state) };
            const restored = decodeMcw(encodeMcw(composed));
            expect(restored.pattern).toEqual(pattern);
            expect(restored.pixels[W + 1]).toBe(2);
            expect(restored.pixels).toEqual(composed.pixels);
            expect(restored.recipes).toEqual([recipe]);
            const instructions = instruction_start_round(restored.pixels, W, H, 7, 7, 0, 0, 3);
            expect(instructions.total()).toBe(3);
            const unit = instructions.unit_at(0)!;
            expect(unit.text()).toMatch(/sc/);
            unit.free(); instructions.free();
            expect(store.state.float).toBe(float);
            expect(store.state.recipes).toEqual([recipe]);
        }
    });
    test("axis and diagonal placements include rotations with correct inverses", () => {
        const recipe = { ...transformed("mirror"), source: { x: 3, y: 4, w: 1, h: 1, mask: new Uint8Array([1]) }, mirrorTypes: ["V", "D1"] } as GridRecipe;
        const evaluated = evaluateGridRecipe(recipe);
        expect(evaluated.placements).toHaveLength(8);
        expect(destinations(recipe)).toEqual([[1, 0], [3, 0], [0, 1], [4, 1], [0, 3], [4, 3], [1, 4], [3, 4]]);
        for (const placement of evaluated.placements) {
            expect(placement.unmap(placement.map({ x: 3, y: 4 }))).toEqual({ x: 3, y: 4 });
            expect(placement.unmap(placement.map({ x: 3, y: 5 }))).toEqual({ x: 3, y: 5 });
        }
    });
    test("Grid handle uses the packed sparse/reflected step after the new cross offset", () => {
        const recipe = { ...gridRecipeFromFloat({ x: 1, y: 2, w: 3, h: 2,
            pixels: new Uint8Array([1, 0, 1, 0, 1, 0]) }), right: 2, down: 1,
            columnMirrorHorizontal: true, rowMirrorVertical: true };
        const offsetRecipe = { ...recipe, columnOffset: 2 };
        const packed = evaluateGridRecipe(offsetRecipe).columnStep.x;
        const changed = withGridStep(recipe, "column", { x: packed + 3, y: 2 });
        expect(changed).toMatchObject({ columnSpacing: 3, columnSpacingAlternate: 3, columnOffset: 2,
            right: 2, down: 1, columnMirrorHorizontal: true, rowMirrorVertical: true });
        expect(evaluateGridRecipe(changed).columnStep).toEqual({ x: packed + 3, y: 2 });
        expect(withGridStep(recipe, "row", { x: -2, y: -10 })).toMatchObject({ rowOffset: -2,
            rowSpacing: 0, rowSpacingAlternate: 0, columnMirrorHorizontal: true });
    });
    test("None retains only the source despite retained copies", () => {
        expect(destinations(transformed("none"))).toEqual([[3, 3]]);
    });
    test("Circle executes chosen turns without dormant Grid or Mirror copies", () => {
        expect(destinations(transformed("circle"))).toEqual([[1, 3], [3, 3]]);
    });
    test("Mirror composes generators and preserves inverse placement mapping", () => {
        const recipe = transformed("mirror");
        expect(destinations(recipe)).toEqual([[1, 1], [3, 1], [1, 3], [3, 3]]);
        const evaluation = evaluateGridRecipe(recipe);
        for (const placement of evaluation.placements) {
            expect(placement.unmap(placement.map({ x: 3, y: 3 }))).toEqual({ x: 3, y: 3 });
            expect(placement.unmap(placement.map({ x: 3, y: 4 }))).toEqual({ x: 3, y: 4 });
        }
    });
    test("dormant overlaps do not prevent None or Circle", () => {
        const recipe = { ...transformed("none"), source: { x: 2, y: 2, w: 2, h: 1, mask: new Uint8Array([1, 1]) },
            mirrorCentreX: 2.5, mirrorCentreY: 2, mirrorTypes: ["V"] } as GridRecipe;
        expect(gridRecipeError(recipe, () => true)).toBeNull();
        expect(gridRecipeError({ ...recipe, mode: "mirror" } as GridRecipe, () => true)).toMatch(/overlap/i);
    });
    test("local mirrors may have off-pattern centres and diagonal types", () => {
        const recipe = { ...transformed("mirror"), mirrorCentreX: -0.5, mirrorCentreY: -0.5, mirrorTypes: ["D1", "V"] } as GridRecipe;
        expect(gridRecipeError(recipe)).toBeNull();
        expect(destinations(recipe)).toContainEqual([-4, -4]);
    });
    test("independent centres and dormant settings survive storage and source translation", () => {
        const recipe = { ...transformed("none"), mirrorCentreX: 4.5, mirrorCentreY: 6.5 } as GridRecipe;
        expect(restoreGridRecipes(storedGridRecipes([recipe]))[0]).toEqual(recipe);
        expect(withRecipeSource(recipe, { x: 5, y: 2, w: 1, h: 1, pixels: new Uint8Array([2]) }, { x: 2, y: -1 }))
            .toMatchObject({ rotationCentreX: 4, rotationCentreY: 1, mirrorCentreX: 6.5, mirrorCentreY: 5.5 });
    });
    test.each([
        ["grid", [], false, false, "grid"],
        ["rotation", [90], false, false, "circle"],
        ["rotation", [90], true, true, "circle"],
        ["rotation", [], true, false, "mirror"],
        ["rotation", [], true, true, "mirror"],
        ["rotation", [], false, false, "circle"],
    ])("converts legacy %s %j %s %s into %s", (mode, turns, horizontal, vertical, expected) => {
        const recipe = source();
        const legacy = { ...recipe, mode, rotationCentreX: 2, rotationCentreY: 2,
            rotationTurns: turns, mirrorHorizontal: horizontal, mirrorVertical: vertical,
            source: { ...recipe.source, mask: [1] } } as Record<string, unknown>;
        delete legacy.mirrorCentreX; delete legacy.mirrorCentreY; delete legacy.mirrorTypes;
        expect(restoreGridRecipes([legacy])[0]).toMatchObject({ id: recipe.id, mode: expected,
            rotationCentreX: 2, rotationCentreY: 2, mirrorCentreX: 2, mirrorCentreY: 2,
            rotationTurns: turns, mirrorTypes: [...(horizontal ? ["V"] : []), ...(vertical ? ["H"] : [])],
            source: recipe.source });
    });
});
