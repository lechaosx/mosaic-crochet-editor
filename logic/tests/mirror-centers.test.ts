import { expect, test } from "vitest";
import * as symmetry from "../src/symmetry";
import { transformed_target_indices, initialize_round_pattern } from "@mosaic/wasm";
import { decodeMcw, encodeMcw } from "../src/mcw";
import { packPixels } from "../src/storage";
import type { Axis, MirrorCenter, PatternState } from "../src/types";

const axes: Axis[] = [
    { id: "v", kind: "V", active: true, x: 0.5 },
    { id: "h-off", kind: "H", active: false, y: 0.5 },
    { id: "point", kind: "C", active: true, x: 0.5, y: 1 },
    { id: "d1", kind: "D1", active: true, c: 0 },
    { id: "d1-repeat", kind: "D1", active: true, c: 1 },
    { id: "d1-off", kind: "D1", active: false, c: -1 },
    { id: "d2", kind: "D2", active: true, c: 2 },
];

test.each([[9, 7], [8, 7], [8, 6], [1, 7], [9, 1]])("global migration preserves every production orbit on %sx%s", (W, H) => {
    const pattern: PatternState = { mode: "row", canvasWidth: W, canvasHeight: H };
    const valid = axes.filter(axis => symmetry.axisIsProjectValid(axis, pattern));
    const centers = symmetry.migrateAxes(valid, pattern);
    expect(centers.map(center => [center.id, center.enabled, center.types])).toEqual(valid.map(axis => [axis.id, axis.active, [axis.kind]]));
    const before = symmetry.axesToFlat(valid), after = symmetry.mirrorsToFlat(centers);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        expect(Array.from(transformed_target_indices(W, H, x, y, after)).sort())
            .toEqual(Array.from(transformed_target_indices(W, H, x, y, before)).sort());
    }
    expect(after).toEqual(before);
});

test.each([3, 4])("supported v%s files migrate losslessly and round-trip center records", version => {
    const pattern: PatternState = { mode: "round", canvasWidth: 5, canvasHeight: 8, virtualWidth: 10, virtualHeight: 8, offsetX: 0, offsetY: 0, rounds: 3 };
    const pixels = initialize_round_pattern(5, 8, 10, 8, 0, 0, 3);
    const valid = axes.filter(axis => symmetry.axisIsProjectValid(axis, pattern));
    const recipe = { id: "saved-source", enabled: true, source: { x: 1, y: 1, w: 2, h: 2, mask: "CQ==" },
        left: 1, right: 1, up: 0, down: 0, columnSpacing: 1, rowSpacing: 1, columnOffset: 0, rowOffset: 0,
        columnOrientation: "same", rowOrientation: "alternate-mirrored", columnMirrorHorizontal: false,
        columnMirrorVertical: false, rowMirrorHorizontal: false, rowMirrorVertical: true };
    const loaded = decodeMcw(JSON.stringify({ version, state: pattern, pixels: packPixels(pixels), colorA: "#123456", colorB: "#abcdef", axes: valid, recipes: [recipe], dangerColorOverride: "#fedcba", accentColorOverride: "#654321" }));
    expect(loaded.mirrors).toEqual(symmetry.migrateAxes(valid, pattern));
    expect(loaded.pixels).toEqual(pixels);
    expect(loaded.pattern).toEqual(pattern);
    expect(loaded).toMatchObject({ colorA: "#123456", colorB: "#abcdef", dangerColorOverride: "#fedcba", accentColorOverride: "#654321" });
    expect(loaded.recipes).toHaveLength(1);
    expect(loaded.recipes[0]).toMatchObject({ id: recipe.id, rowMirrorVertical: true,
        source: { x: 1, y: 1, w: 2, h: 2, mask: new Uint8Array([1, 0, 0, 1]) } });
    expect(decodeMcw(encodeMcw(loaded))).toEqual(loaded);
    expect(JSON.parse(encodeMcw(loaded))).toMatchObject({ version: 6, mirrors: loaded.mirrors });
    expect(JSON.parse(encodeMcw(loaded))).not.toHaveProperty("axes");
});

test("diagonal parity differs from point symmetry and incompatible types retain the center", () => {
    const pattern: PatternState = { mode: "row", canvasWidth: 8, canvasHeight: 7 };
    const center: MirrorCenter = { id: "mixed", enabled: true, x: 3.5, y: 3, types: ["V", "H", "C"] };
    expect(symmetry.mirrorIsProjectValid(center, pattern)).toBe(true);
    expect(symmetry.mirrorIsProjectValid({ ...center, types: [...center.types, "D1"] }, pattern)).toBe(false);
    expect(symmetry.mirrorIsProjectValid({ ...center, y: 3.5, types: ["D1", "D2", "C"] }, pattern)).toBe(true);
    const snapped = symmetry.snapMirrorCenter({ ...center, types: ["V", "D1", "D2"] }, { x: 2.2, y: 1.6 }, pattern);
    expect(snapped).toMatchObject({ x: 2.5, y: 1.5 });
    expect(symmetry.mirrorIsProjectValid(snapped!, pattern)).toBe(true);
});

test("resize preserves surviving types and changes only free handle coordinates", () => {
    const pattern: PatternState = { mode: "row", canvasWidth: 5, canvasHeight: 1 };
    const mixed: MirrorCenter = { id: "both", enabled: false, x: 2, y: 4, types: ["V", "H", "C"] };
    const diagonal: MirrorCenter = { id: "diag", enabled: true, x: 4, y: 3, types: ["D1"] };
    expect(symmetry.mirrorsForPattern([mixed, diagonal], pattern)).toEqual([
        { ...mixed, y: 0, types: ["V"] },
        { ...diagonal, x: 1, y: 0 },
    ]);
});

test("dragging beyond the chart retains a valid center rather than deleting it", () => {
    const pattern: PatternState = { mode: "row", canvasWidth: 9, canvasHeight: 9 };
    const center: MirrorCenter = { id: "v", enabled: true, x: 4, y: 4, types: ["V"] };
    expect(symmetry.snapMirrorCenter(center, { x: -50, y: 50 }, pattern)).toEqual({ ...center, x: 0.5, y: 8 });
});

test.each(["D1", "D2"] as const)("narrow diagonal %s snaps away from its boundary without chart-sized work", type => {
    const pattern: PatternState = { mode: "row", canvasWidth: 1, canvasHeight: 7 };
    const center: MirrorCenter = { id: "narrow", enabled: true, x: 0, y: 3, types: [type] };
    expect(symmetry.snapMirrorCenter(center, { x: 0, y: 0 }, pattern)).toEqual({ ...center, y: 1 });
    expect(symmetry.snapMirrorCenter(center, { x: 0, y: 6 }, pattern)).toEqual({ ...center, y: 5 });
});

test("an empty center remains usable on a one-cell chart", () => {
    const pattern: PatternState = { mode: "row", canvasWidth: 1, canvasHeight: 1 };
    const mirrors = symmetry.addMirror([], null, pattern);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({ x: 0, y: 0, enabled: true, types: [] });
    expect(symmetry.mirrorIsProjectValid(mirrors[0], pattern)).toBe(true);
    expect(symmetry.mirrorsToFlat(mirrors)).toHaveLength(0);
});
