// Float type shape tests.
import { describe, test, expect } from "vitest";
import { makeFloat } from "./_helpers";

describe("Float shape", () => {
    test("has x, y, w, h, pixels fields", () => {
        const f = makeFloat([{ x: 2, y: 3, v: 1 }]);
        expect(typeof f.x).toBe("number");
        expect(typeof f.y).toBe("number");
        expect(typeof f.w).toBe("number");
        expect(typeof f.h).toBe("number");
        expect(f.pixels).toBeInstanceOf(Uint8Array);
    });

    test("single cell: bounding box is 1×1 at that cell's coords", () => {
        const f = makeFloat([{ x: 5, y: 7, v: 2 }]);
        expect(f.x).toBe(5);
        expect(f.y).toBe(7);
        expect(f.w).toBe(1);
        expect(f.h).toBe(1);
        expect(f.pixels[0]).toBe(2);
    });

    test("multiple cells: bounding box spans min..max", () => {
        const f = makeFloat([
            { x: 1, y: 2, v: 1 },
            { x: 3, y: 4, v: 2 },
        ]);
        expect(f.x).toBe(1);
        expect(f.y).toBe(2);
        expect(f.w).toBe(3);   // 3 - 1 + 1
        expect(f.h).toBe(3);   // 4 - 2 + 1
        // Canvas cell (1,2) → local (0,0) → index 0
        expect(f.pixels[0]).toBe(1);
        // Canvas cell (3,4) → local (2,2) → index 2*3+2 = 8
        expect(f.pixels[8]).toBe(2);
    });

    test("absent cells within bounding box are 0", () => {
        // Two cells at (0,0) and (2,0) — gap at (1,0).
        const f = makeFloat([{ x: 0, y: 0, v: 1 }, { x: 2, y: 0, v: 1 }]);
        expect(f.w).toBe(3);
        expect(f.pixels[1]).toBe(0);   // (1,0) gap
    });
});
