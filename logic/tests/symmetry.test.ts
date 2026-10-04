import { describe, test, expect } from "vitest";
import { axisOffCanvas, axisIsProjectValid, mirrorsToFlat, addMirror, pickMirrorCenter, snapHalf } from "../src/symmetry";
import type { Axis, MirrorCenter } from "../src/types";

test("chosen types compile to independent generators and a disabled centre emits none", () => {
    const centre: MirrorCenter = { id: "all", enabled: true, x: 4, y: 3, types: ["V", "H", "C", "D1", "D2"] };
    expect(Array.from(mirrorsToFlat([centre]))).toEqual([0, 4, 0, 1, 3, 0, 2, 4, 3, 3, 1, 0, 4, 7, 0]);
    expect(mirrorsToFlat([{ ...centre, enabled: false }])).toHaveLength(0);
    expect(mirrorsToFlat([{ ...centre, types: [] }])).toHaveLength(0);
});

test("adding centres retains identity and repeated types", () => {
    const pattern = { mode: "row" as const, canvasWidth: 9, canvasHeight: 7 };
    const first = addMirror([], "D1", pattern);
    const both = addMirror(first, "D1", pattern);
    expect(first).toHaveLength(1);
    expect(both).toHaveLength(2);
    expect(both[0]).toEqual(first[0]);
    expect(both[0].id).not.toBe(both[1].id);
    expect(both[0]).toMatchObject({ x: 4, y: 3, types: ["D1"], enabled: true });
});

test("center picking uses the nearest handle and the selected identity breaks overlaps", () => {
    const first: MirrorCenter = { id: "first", enabled: false, x: 4, y: 4, types: [] };
    const second = { ...first, id: "second", enabled: true };
    expect(pickMirrorCenter([first, second], 4.5, 4.5, 1, "second")).toBe(second);
    expect(pickMirrorCenter([first, second], 4.5, 1, 1, null)).toBeNull();
    expect(pickMirrorCenter([first], 4.5, 5.5, 1, null)).toBeNull();
});

test("precision coordinates snap to the nearest half-grid point", () => {
    expect(snapHalf(2.1)).toBe(2);
    expect(snapHalf(2.3)).toBe(2.5);
    expect(snapHalf(2.7)).toBe(2.5);
    expect(snapHalf(2.8)).toBe(3);
});

describe("axisOffCanvas", () => {
    test("V at canonical centre is alive", () => {
        const v: Axis = { kind: "V", id: "v", active: true, x: 4 };
        expect(axisOffCanvas(v, 9, 9)).toBe(false);
    });
    test("V just inside the right edge (x = W − 1.5) still has a useful mirror", () => {
        // a.x = 7.5 → cells 7↔8 mirror.
        const v: Axis = { kind: "V", id: "x", active: true, x: 7.5 };
        expect(axisOffCanvas(v, 9, 9)).toBe(false);
    });
    test("V on the rightmost cell (x = W − 1) is dead — only self-mirror", () => {
        const v: Axis = { kind: "V", id: "x", active: true, x: 8 };
        expect(axisOffCanvas(v, 9, 9)).toBe(true);
    });
    test("V at the right canvas edge (x = W − 0.5) is dead", () => {
        const v: Axis = { kind: "V", id: "x", active: true, x: 8.5 };
        expect(axisOffCanvas(v, 9, 9)).toBe(true);
    });
    test("V on the leftmost cell (x = 0) is dead", () => {
        const v: Axis = { kind: "V", id: "x", active: true, x: 0 };
        expect(axisOffCanvas(v, 9, 9)).toBe(true);
    });
    test("V just inside the left edge (x = 0.5) is alive — cells 0↔1 mirror", () => {
        const v: Axis = { kind: "V", id: "x", active: true, x: 0.5 };
        expect(axisOffCanvas(v, 9, 9)).toBe(false);
    });
    test("C with x at canvas-boundary cell is dead even if y is interior", () => {
        const c: Axis = { kind: "C", id: "x", active: true, x: 8, y: 4 };
        expect(axisOffCanvas(c, 9, 9)).toBe(true);
    });
    test("D1 at canonical c=0 (on 9×9) is alive", () => {
        const d1: Axis = { kind: "D1", id: "x", active: true, c: 0 };
        expect(axisOffCanvas(d1, 9, 9)).toBe(false);
    });
    test("D1 at c = W − 1 (only the corner cell on axis) is dead", () => {
        const d1: Axis = { kind: "D1", id: "x", active: true, c: 8 };
        expect(axisOffCanvas(d1, 9, 9)).toBe(true);
    });
    test("H bounds excludes both edge cells but keeps adjacent half-cells", () => {
        const h = (y: number): Axis => ({ kind: "H", id: "h", active: true, y });
        expect(axisOffCanvas(h(0), 9, 7)).toBe(true);
        expect(axisOffCanvas(h(0.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(h(5.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(h(6), 9, 7)).toBe(true);
    });
    test("C bounds checks both coordinates independently", () => {
        const c = (x: number, y: number): Axis => ({ kind: "C", id: "c", active: true, x, y });
        expect(axisOffCanvas(c(4, 3), 9, 7)).toBe(false);
        expect(axisOffCanvas(c(0, 3), 9, 7)).toBe(true);
        expect(axisOffCanvas(c(4, 0), 9, 7)).toBe(true);
        expect(axisOffCanvas(c(8, 3), 9, 7)).toBe(true);
        expect(axisOffCanvas(c(4, 6), 9, 7)).toBe(true);
    });
    test("D1 and D2 bounds retain guides with a two-cell orbit", () => {
        const d1 = (c: number): Axis => ({ kind: "D1", id: "d1", active: true, c });
        expect(axisOffCanvas(d1(-6), 9, 7)).toBe(true);
        expect(axisOffCanvas(d1(-5.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(d1(7.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(d1(8), 9, 7)).toBe(true);

        const d2 = (c: number): Axis => ({ kind: "D2", id: "d2", active: true, c });
        expect(axisOffCanvas(d2(0), 9, 7)).toBe(true);
        expect(axisOffCanvas(d2(0.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(d2(13.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(d2(14), 9, 7)).toBe(true);
    });
});

describe("axisIsProjectValid", () => {
    const pattern = { mode: "row" as const, canvasWidth: 9, canvasHeight: 7 };

    test("accepts useful grid-representable axes regardless of active state", () => {
        expect(axisIsProjectValid({ id: "v", kind: "V", active: false, x: 0.5 }, pattern)).toBe(true);
        expect(axisIsProjectValid({ id: "h", kind: "H", active: true, y: 0.5 }, pattern)).toBe(true);
        expect(axisIsProjectValid({ id: "c", kind: "C", active: false, x: 4.5, y: 3.5 }, pattern)).toBe(true);
        expect(axisIsProjectValid({ id: "d1", kind: "D1", active: true, c: -5 }, pattern)).toBe(true);
        expect(axisIsProjectValid({ id: "d2", kind: "D2", active: false, c: 13 }, pattern)).toBe(true);
    });

    test.each<Axis>([
        { id: "v", kind: "V", active: true, x: 0.25 },
        { id: "h", kind: "H", active: true, y: 1.25 },
        { id: "c", kind: "C", active: true, x: 4.5, y: 1.25 },
        { id: "d1", kind: "D1", active: true, c: 0.5 },
        { id: "d2", kind: "D2", active: true, c: 0.5 },
        { id: "v-edge", kind: "V", active: false, x: 0 },
        { id: "h-edge", kind: "H", active: false, y: 0 },
        { id: "c-edge", kind: "C", active: false, x: 0, y: 0.5 },
        { id: "d1-edge", kind: "D1", active: false, c: 8 },
        { id: "d2-edge", kind: "D2", active: false, c: 14 },
        { id: "v-huge", kind: "V", active: false, x: Number.MAX_SAFE_INTEGER },
        { id: "h-huge", kind: "H", active: false, y: Number.MAX_SAFE_INTEGER },
        { id: "c-huge", kind: "C", active: false, x: Number.MAX_SAFE_INTEGER, y: 0.5 },
        { id: "d1-huge", kind: "D1", active: false, c: Number.MAX_SAFE_INTEGER },
        { id: "d2-huge", kind: "D2", active: false, c: Number.MAX_SAFE_INTEGER },
    ])("rejects non-grid or unusable %s", axis => {
        expect(axisIsProjectValid(axis, pattern)).toBe(false);
    });
});
