import { describe, expect, test } from "vitest";
import {
    MAX_REPEAT_POSITIONS,
    defaultRepeatGrid,
    repeatGridError,
    transformsToFlat,
} from "../src/repeat";

describe("repeat grid", () => {
    test("defaults to a disabled one-cell grid with one copy per side", () => {
        expect(defaultRepeatGrid()).toEqual({
            enabled: false,
            tileWidth: 1,
            tileHeight: 1,
            copiesX: 1,
            copiesY: 1,
        });
    });

    test("validates integer geometry and the combined position ceiling", () => {
        expect(repeatGridError(defaultRepeatGrid())).toBeNull();
        expect(repeatGridError({
            ...defaultRepeatGrid(), tileWidth: 0,
        })).toMatch(/whole positive/);
        expect(repeatGridError({
            ...defaultRepeatGrid(), copiesX: -1,
        })).toMatch(/zero or positive/);
        expect(repeatGridError({
            ...defaultRepeatGrid(), copiesX: 32, copiesY: 32,
        })).toContain(MAX_REPEAT_POSITIONS.toLocaleString("en-US"));
    });

    test("encodes active symmetry first and repeat axes after it", () => {
        const flat = transformsToFlat(
            [{ kind: "V", id: "v", active: true, x: 2 }],
            { enabled: true, tileWidth: 4, tileHeight: 3, copiesX: 1, copiesY: 2 },
        );

        expect([...flat]).toEqual([
            0, 2, 0,
            5, 4, 1,
            6, 3, 2,
        ]);
    });

    test("does not encode a disabled repeat grid", () => {
        expect([...transformsToFlat([], defaultRepeatGrid())]).toEqual([]);
    });
});
