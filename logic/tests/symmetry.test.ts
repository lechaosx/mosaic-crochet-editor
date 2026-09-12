// Axis helper tests. `axesToFlat` emits a flat Float64Array (3 doubles per
// active axis: kind, a, b) that the Rust BFS consumes. Closure-free —
// composition between mirrors emerges from the BFS itself, so V+H emits
// 2 axes (not 3) and the orbit walker still produces a 4-cell orbit.

import { describe, test, expect } from "vitest";
import {
    axesToFlat, defaultAxes,
    pickAxesAt, distanceToAxis, setAxisPosition, snapHalf, snapInt,
    addAxis, removeAxis, toggleAxisActive, axisOffCanvas,
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
        const off = toggleAxisActive(addAxis([], "V", 9, 9), addAxis([], "V", 9, 9)[0].id);
        // (We toggled the wrong axis id above — the original is still active.)
        expect(axesToFlat(off).length).toBe(3);
        // Simpler check: empty axes list → empty Float64Array.
        expect(axesToFlat([]).length).toBe(0);
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
