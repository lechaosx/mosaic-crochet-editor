import { describe, expect, it } from "vitest";
import { PlanDir, PlanType } from "@mosaic/wasm";
import { packInstructionCoordinates, planOutwardCoordinate } from "../src/instruction-coordinates";

describe("instruction coordinates", () => {
    it("projects native plan records from supporting to outward worked positions", () => {
        const plan = new Int16Array([
            PlanType.Invalid, PlanDir.Up, 4, 5,
            PlanType.Valid, PlanDir.Down, 4, 5,
            PlanType.Invalid, PlanDir.Left, 4, 5,
            PlanType.Invalid, PlanDir.Right, 4, 5,
        ]);
        expect([0, 4, 8, 12].map(offset => planOutwardCoordinate(plan, offset)))
            .toEqual([[4, 4], [4, 6], [3, 5], [5, 5]]);
    });
    it("indexes outward coordinates compactly, including the chart gutter", () => {
        const coords = new Int32Array([-1, 0, 0, 0, 1, 0, 1, 0, 1_048_576, 0]);
        const packed = packInstructionCoordinates(coords, 1_048_576);

        expect(packed.has(-1, 0)).toBe(true);
        expect(packed.has(0, 0)).toBe(true);
        expect(packed.has(1, 0)).toBe(true);
        expect(packed.has(1_048_576, 0)).toBe(true);
        expect(packed.has(2, 0)).toBe(false);
        expect(packed.values).toBeInstanceOf(Uint32Array);
        expect(packed.values.byteLength).toBeLessThanOrEqual(coords.byteLength / 2);
    });

    it("keeps a maximum-width row in one packed numeric word per stitch", () => {
        const width = 1_048_576;
        const coords = new Int32Array(width * 2);
        for (let x = 0; x < width; x++) {
            coords[x * 2] = x;
            coords[x * 2 + 1] = 0;
        }

        const packed = packInstructionCoordinates(coords, width);

        expect(packed.values).toHaveLength(width);
        expect(packed.values.byteLength).toBe(width * Uint32Array.BYTES_PER_ELEMENT);
        expect(packed.has(width - 1, 0)).toBe(true);
        expect(packed.has(width, 0)).toBe(false);
    });
});
