// Axis helper tests. `axesToFlat` emits a flat Float64Array (3 doubles per
// active axis: kind, a, b) that the Rust BFS consumes. Closure-free —
// composition between mirrors emerges from the BFS itself, so V+H emits
// 2 axes (not 3) and the orbit walker still produces a 4-cell orbit.

import { describe, test, expect } from "vitest";
import {
    axesToFlat, defaultAxes,
    pickAxesAt, distanceToAxis, setAxisPosition, snapHalf, snapInt,
    addAxis, removeAxis, toggleAxisActive, axisOffCanvas, axisIsProjectValid,
} from "../src/symmetry";
import type { Axis } from "../src/types";
import { SymKey } from "../src/types";

// Chained `addAxis` for terse setup: `axesWith(9, 9, "V", "H")` builds an
// axes list with one active V and one active H at canonical centres.
function axesWith(W: number, H: number, ...kinds: SymKey[]): Axis[] {
    return kinds.reduce<Axis[]>((acc, k) => addAxis(acc, k, W, H), defaultAxes(W, H));
}

describe("defaultAxes", () => {
    test("fresh session has zero axes", () => {
        expect(defaultAxes(9, 9)).toEqual([]);
    });
});

describe("addAxis", () => {
    test("V on 9×9 → one active V at canonical centre x=4", () => {
        const axes = addAxis([], "V", 9, 9);
        expect(axes).toHaveLength(1);
        const v = axes[0];
        expect(v.kind === "V" && v.active && v.x === 4).toBe(true);
    });
    test("each call produces a fresh id", () => {
        const a = addAxis([], "V", 9, 9);
        const b = addAxis(a, "V", 9, 9);
        expect(b).toHaveLength(2);
        expect(b[0].id).not.toBe(b[1].id);
    });
    test("C carries both x and y", () => {
        const c = addAxis([], "C", 9, 9)[0];
        expect(c.kind === "C" && c.x === 4 && c.y === 4).toBe(true);
    });
    test("D1 / D2 carry the c constant for the canonical line", () => {
        const d1 = addAxis([], "D1", 9, 7)[0];
        const d2 = addAxis([], "D2", 9, 7)[0];
        expect(d1.kind === "D1" && d1.c).toBe(1);   // (W-H)/2
        expect(d2.kind === "D2" && d2.c).toBe(7);   // (W+H-2)/2
    });
});

describe("removeAxis", () => {
    test("drops by id; absent id is a no-op", () => {
        const a = addAxis([], "V", 9, 9);
        const id = a[0].id;
        expect(removeAxis(a, id)).toEqual([]);
        expect(removeAxis(a, "nope")).toEqual(a);
    });
});

describe("toggleAxisActive", () => {
    test("flips a single axis's active by id", () => {
        const a = addAxis([], "V", 9, 9);
        const id = a[0].id;
        const off = toggleAxisActive(a, id);
        expect(off[0].active).toBe(false);
        const on = toggleAxisActive(off, id);
        expect(on[0].active).toBe(true);
    });
    test("only touches the matching axis", () => {
        const axes = axesWith(9, 9, "V", "H");
        const flipped = toggleAxisActive(axes, axes[0].id);
        expect(flipped[0].active).toBe(false);
        expect(flipped[1].active).toBe(true);
    });
});

describe("axesToFlat", () => {
    test("inactive axes → empty array", () => {
        const axes = addAxis([], "V", 9, 9);
        const off = toggleAxisActive(axes, axes[0].id);
        expect(Array.from(axesToFlat(off))).toEqual([]);
    });

    test("V active → 3 doubles: kind=0, a=(W-1)/2, b=0", () => {
        const flat = Array.from(axesToFlat(axesWith(9, 9, "V")));
        expect(flat).toEqual([0, 4, 0]);
    });

    test("V + H active → 6 doubles (closure-free; BFS composes C from the two reflections)", () => {
        const flat = Array.from(axesToFlat(axesWith(9, 9, "V", "H")));
        expect(flat).toEqual([0, 4, 0, 1, 4, 0]);
    });

    test("C active emits both x and y", () => {
        const flat = Array.from(axesToFlat(axesWith(9, 9, "C")));
        expect(flat).toEqual([2, 4, 4]);
    });

    test("D1 / D2 emit the c constant in slot a", () => {
        const d1Flat = Array.from(axesToFlat(axesWith(9, 9, "D1")));
        expect(d1Flat).toEqual([3, 0, 0]);   // (W-H)/2 = 0 on 9×9
        const d2Flat = Array.from(axesToFlat(axesWith(9, 9, "D2")));
        expect(d2Flat).toEqual([4, 8, 0]);   // (W+H-2)/2 = 8 on 9×9
    });

    test("all five active → 15 doubles", () => {
        expect(axesToFlat(axesWith(9, 9, "V", "H", "C", "D1", "D2")).length).toBe(15);
    });

    test("preserves each active axis's kind and position in input order", () => {
        const axes: Axis[] = [
            { kind: "H", id: "h", active: true, y: 1.5 },
            { kind: "V", id: "v", active: true, x: 2.5 },
            { kind: "D1", id: "d1", active: true, c: -2 },
            { kind: "D2", id: "d2", active: true, c: 7 },
        ];
        expect(Array.from(axesToFlat(axes))).toEqual([
            1, 1.5, 0,
            0, 2.5, 0,
            3, -2, 0,
            4, 7, 0,
        ]);
    });
});

describe("distanceToAxis", () => {
    test("V at x=4 → distance to (4.5, 3) is 0 (on the line)", () => {
        const v: Axis = { kind: "V", id: "x", active: true, x: 4 };
        expect(distanceToAxis(v, 4.5, 3)).toBe(0);
    });
    test("V at x=4 → distance to (5.5, 3) is 1", () => {
        const v: Axis = { kind: "V", id: "x", active: true, x: 4 };
        expect(distanceToAxis(v, 5.5, 3)).toBe(1);
    });
    test("H at y=4 → distance to (3, 4.5) is 0", () => {
        const h: Axis = { kind: "H", id: "x", active: true, y: 4 };
        expect(distanceToAxis(h, 3, 4.5)).toBe(0);
    });
    test("D1 at c=0 → distance to (3, 3) is 0 (point on y=x)", () => {
        const d1: Axis = { kind: "D1", id: "x", active: true, c: 0 };
        expect(distanceToAxis(d1, 3, 3)).toBe(0);
    });
    test("D1 distance accounts for its offset and diagonal scale", () => {
        const d1: Axis = { kind: "D1", id: "x", active: true, c: 2 };
        expect(distanceToAxis(d1, 5, 1)).toBeCloseTo(Math.SQRT2);
    });
    test("D2 distance accounts for both coordinates, its offset, and diagonal scale", () => {
        const d2: Axis = { kind: "D2", id: "x", active: true, c: 4 };
        expect(distanceToAxis(d2, 8, 2)).toBeCloseTo(5 / Math.SQRT2);
    });
    test("C at (4,4) → distance to (4.5, 4.5) is 0 (centre point)", () => {
        const c: Axis = { kind: "C", id: "x", active: true, x: 4, y: 4 };
        expect(distanceToAxis(c, 4.5, 4.5)).toBe(0);
    });
});

describe("pickAxesAt", () => {
    test("picks one axis per kind at an intersection", () => {
        // V at canonical centre x=4 and H at y=4 both pass through (4.5, 4.5).
        const axes = axesWith(9, 9, "V", "H");
        const hits = pickAxesAt(axes, 4.5, 4.5, 0.4);
        expect(hits.map(a => a.kind).sort()).toEqual(["H", "V"]);
    });
    test("two parallel V axes at the same x return only the closer one", () => {
        const axes = [
            addAxis([], "V", 9, 9)[0],
            addAxis(addAxis([], "V", 9, 9), "V", 9, 9)[1],
        ];
        // Both at canonical x=4. They're equidistant from (4.5, 4); pickAxesAt
        // returns at most one V (the first encountered with min distance).
        const hits = pickAxesAt(axes, 4.5, 4, 0.4);
        expect(hits.filter(a => a.kind === "V")).toHaveLength(1);
    });
    test("returns [] when nothing is in range", () => {
        const axes = axesWith(9, 9, "V");
        expect(pickAxesAt(axes, 0.5, 0.5, 0.4)).toEqual([]);
    });
    test("ignores inactive axes and excludes a guide exactly at the tolerance", () => {
        const inactive: Axis = { kind: "V", id: "inactive", active: false, x: 0 };
        const active: Axis = { kind: "V", id: "active", active: true, x: 0 };
        expect(pickAxesAt([inactive], 0.5, 2, 1)).toEqual([]);
        expect(pickAxesAt([active], 1.5, 2, 1)).toEqual([]);
    });
    test("chooses the nearest parallel guide and keeps the first on an exact tie", () => {
        const far: Axis = { kind: "V", id: "far", active: true, x: 2 };
        const near: Axis = { kind: "V", id: "near", active: true, x: 4 };
        expect(pickAxesAt([far, near], 4.25, 2, 2).map(a => a.id)).toEqual(["near"]);

        const tie: Axis = { kind: "V", id: "tie", active: true, x: 4 };
        expect(pickAxesAt([near, tie], 4.5, 2, 1).map(a => a.id)).toEqual(["near"]);
    });
});

describe("setAxisPosition", () => {
    test("updates V axis x while keeping kind / id / active", () => {
        const axes = axesWith(9, 9, "V");
        const id = axes[0].id;
        const updated = setAxisPosition(axes, id, { x: 2 });
        const v = updated[0];
        expect(v.kind === "V" && v.x === 2 && v.active).toBe(true);
    });
    test("updates D1 c", () => {
        const axes = axesWith(9, 9, "D1");
        const id = axes[0].id;
        const updated = setAxisPosition(axes, id, { c: 2 });
        const d1 = updated[0];
        expect(d1.kind === "D1" && d1.c === 2).toBe(true);
    });
    test("updates C both x and y", () => {
        const axes = axesWith(9, 9, "C");
        const id = axes[0].id;
        const updated = setAxisPosition(axes, id, { x: 2, y: 3 });
        const c = updated[0];
        expect(c.kind === "C" && c.x === 2 && c.y === 3).toBe(true);
    });
    test("updates H and D2 positions", () => {
        const h: Axis = { kind: "H", id: "h", active: true, y: 1 };
        const d2: Axis = { kind: "D2", id: "d2", active: true, c: 2 };
        expect(setAxisPosition([h], "h", { y: 3 })).toEqual([
            { kind: "H", id: "h", active: true, y: 3 },
        ]);
        expect(setAxisPosition([d2], "d2", { c: 6 })).toEqual([
            { kind: "D2", id: "d2", active: true, c: 6 },
        ]);
    });
    test("leaves non-matching axes and omitted coordinates unchanged", () => {
        const first: Axis = { kind: "V", id: "first", active: true, x: 1 };
        const second: Axis = { kind: "V", id: "second", active: true, x: 4 };
        const centre: Axis = { kind: "C", id: "centre", active: true, x: 2, y: 3 };

        const moved = setAxisPosition([first, second], "first", { x: 2 });
        expect(moved).toEqual([{ ...first, x: 2 }, second]);
        expect(setAxisPosition([first], "first", {})).toEqual([first]);
        expect(setAxisPosition([centre], "centre", { x: 5 })).toEqual([{ ...centre, x: 5 }]);
        expect(setAxisPosition([centre], "centre", { y: 6 })).toEqual([{ ...centre, y: 6 }]);
    });
});

describe("axisOffCanvas", () => {
    test("V at canonical centre is alive", () => {
        const v = addAxis([], "V", 9, 9)[0];
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
    test("H delete boundary excludes both edge cells but keeps adjacent half-cells", () => {
        const h = (y: number): Axis => ({ kind: "H", id: "h", active: true, y });
        expect(axisOffCanvas(h(0), 9, 7)).toBe(true);
        expect(axisOffCanvas(h(0.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(h(5.5), 9, 7)).toBe(false);
        expect(axisOffCanvas(h(6), 9, 7)).toBe(true);
    });
    test("C delete boundary checks both coordinates independently", () => {
        const c = (x: number, y: number): Axis => ({ kind: "C", id: "c", active: true, x, y });
        expect(axisOffCanvas(c(4, 3), 9, 7)).toBe(false);
        expect(axisOffCanvas(c(0, 3), 9, 7)).toBe(true);
        expect(axisOffCanvas(c(4, 0), 9, 7)).toBe(true);
        expect(axisOffCanvas(c(8, 3), 9, 7)).toBe(true);
        expect(axisOffCanvas(c(4, 6), 9, 7)).toBe(true);
    });
    test("D1 and D2 delete boundaries retain guides with a two-cell orbit", () => {
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

describe("snapHalf / snapInt", () => {
    test("snapHalf snaps to nearest 0.5", () => {
        expect(snapHalf(2.1)).toBe(2);
        expect(snapHalf(2.3)).toBe(2.5);
        expect(snapHalf(2.7)).toBe(2.5);
        expect(snapHalf(2.8)).toBe(3);
    });
    test("snapInt snaps to nearest integer", () => {
        expect(snapInt(2.4)).toBe(2);
        expect(snapInt(2.5)).toBe(3);
        expect(snapInt(2.6)).toBe(3);
    });
});
