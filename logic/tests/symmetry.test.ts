// Axis helper tests. `axesToFlat` emits a flat Float64Array (3 doubles per
// active axis: kind, a, b) that the Rust BFS consumes. Closure-free —
// composition between mirrors emerges from the BFS itself, so V+H emits
// 2 axes (not 3) and the orbit walker still produces a 4-cell orbit.

import { describe, test, expect } from "vitest";
import {
    diagonalsAvailable, axesToFlat, pruneUnavailableDiagonals,
    defaultAxes, toggleAxisKind, activeKinds, closureKinds,
    pickAxisAt, distanceToAxis, setAxisPosition, snapHalf, snapInt,
} from "../src/symmetry";
import type { Axis } from "../src/types";
import { SymKey } from "../src/types";

describe("defaultAxes", () => {
    test("seeds 5 presets, all inactive", () => {
        const axes = defaultAxes(9, 9);
        expect(axes).toHaveLength(5);
        expect(axes.every(a => !a.active)).toBe(true);
        expect(axes.map(a => a.kind).sort()).toEqual(["C", "D1", "D2", "H", "V"]);
    });

    test("canonical positions land at canvas centre", () => {
        const axes = defaultAxes(9, 9);
        const V = axes.find(a => a.kind === "V")!;
        const H = axes.find(a => a.kind === "H")!;
        const C = axes.find(a => a.kind === "C")!;
        expect(V.kind === "V" && V.x).toBe(4);
        expect(H.kind === "H" && H.y).toBe(4);
        expect(C.kind === "C" && C.x === 4 && C.y === 4).toBe(true);
    });

    test("even canvas → half-integer V / H centre", () => {
        const axes = defaultAxes(8, 8);
        const V = axes.find(a => a.kind === "V")!;
        expect(V.kind === "V" && V.x).toBe(3.5);
    });
});

describe("axesToFlat", () => {
    test("inactive axes → empty array", () => {
        expect(axesToFlat(defaultAxes(9, 9)).length).toBe(0);
    });

    test("V active → 3 doubles: kind=0, a=(W-1)/2, b=0", () => {
        const axes = toggleAxisKind(defaultAxes(9, 9), "V");
        const flat = Array.from(axesToFlat(axes));
        expect(flat).toEqual([0, 4, 0]);
    });

    test("V + H active → 6 doubles (closure-free; BFS composes C from the two reflections)", () => {
        const axes = toggleAxisKind(toggleAxisKind(defaultAxes(9, 9), "V"), "H");
        const flat = Array.from(axesToFlat(axes));
        // kind-V at x=4, then kind-H at y=4 (canonical centres of a 9×9 canvas).
        expect(flat).toEqual([0, 4, 0, 1, 4, 0]);
    });

    test("C active emits both x and y", () => {
        const axes = toggleAxisKind(defaultAxes(9, 9), "C");
        const flat = Array.from(axesToFlat(axes));
        // kind-C, a=4 (cx), b=4 (cy)
        expect(flat).toEqual([2, 4, 4]);
    });

    test("D1 / D2 emit the c constant in slot a", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "D1");
        const d1Flat = Array.from(axesToFlat(axes));
        // (W-H)/2 = 0 on 9×9
        expect(d1Flat).toEqual([3, 0, 0]);
        axes = toggleAxisKind(defaultAxes(9, 9), "D2");
        const d2Flat = Array.from(axesToFlat(axes));
        // (W+H-2)/2 = 8 on 9×9
        expect(d2Flat).toEqual([4, 8, 0]);
    });

    test("all five active → 15 doubles", () => {
        let axes = defaultAxes(9, 9);
        for (const k of ["V", "H", "C", "D1", "D2"] as SymKey[]) axes = toggleAxisKind(axes, k);
        expect(axesToFlat(axes).length).toBe(15);
    });
});

describe("diagonalsAvailable", () => {
    test.each([
        [9, 9, true],
        [9, 7, true],
        [9, 8, false],
        [10, 7, false],
        [10, 10, true],
    ])("(W=%i, H=%i) → %s", (w, h, expected) => {
        expect(diagonalsAvailable(w, h)).toBe(expected);
    });
});

describe("pruneUnavailableDiagonals", () => {
    test("keeps diagonals active when (W-H) is even", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "D1");
        const pruned = pruneUnavailableDiagonals(axes, 9, 9);
        expect(pruned.find(a => a.kind === "D1")!.active).toBe(true);
    });

    test("deactivates D1 and D2 when (W-H) is odd; keeps V/H/C state", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        axes = toggleAxisKind(axes, "D1");
        axes = toggleAxisKind(axes, "D2");
        const pruned = pruneUnavailableDiagonals(axes, 9, 8);
        expect(pruned.find(a => a.kind === "D1")!.active).toBe(false);
        expect(pruned.find(a => a.kind === "D2")!.active).toBe(false);
        expect(pruned.find(a => a.kind === "V")!.active).toBe(true);
        // Preset stays in the list — deactivation preserves the slot.
        expect(pruned).toHaveLength(5);
    });
});

describe("activeKinds", () => {
    test("returns Set of kinds whose axis.active is true", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        axes = toggleAxisKind(axes, "D1");
        const kinds = activeKinds(axes);
        expect(kinds.has("V")).toBe(true);
        expect(kinds.has("D1")).toBe(true);
        expect(kinds.has("H")).toBe(false);
    });
});

describe("closureKinds (UI-only)", () => {
    test("V + H imply C (so UI dim-renders C)", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        axes = toggleAxisKind(axes, "H");
        const closure = closureKinds(axes, 9, 9);
        expect(closure.has("C")).toBe(true);
    });

    test("diagonals disabled: V + D1 does NOT propagate to D2", () => {
        let axes = defaultAxes(9, 8);
        axes = toggleAxisKind(axes, "V");
        axes = toggleAxisKind(axes, "D1");
        expect(closureKinds(axes, 9, 8).has("D2")).toBe(false);
    });

    test("transitive: V + D1 (diagonals on) → all five", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        axes = toggleAxisKind(axes, "D1");
        const closure = closureKinds(axes, 9, 9);
        for (const k of ["V", "H", "C", "D1", "D2"] as SymKey[]) {
            expect(closure.has(k)).toBe(true);
        }
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

describe("pickAxisAt", () => {
    test("clicks on V guide line return the V axis", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        // V guide is at render x = 4.5. Click at (4.6, 3) is within tolerance.
        const hit = pickAxisAt(axes, 4.6, 3, 0.4);
        expect(hit?.kind).toBe("V");
    });
    test("clicks far from any guide return null", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        expect(pickAxisAt(axes, 0.5, 0.5, 0.4)).toBeNull();
    });
    test("inactive axes are not pickable even when nearby", () => {
        const axes = defaultAxes(9, 9);   // all inactive
        expect(pickAxisAt(axes, 4.5, 4.5, 0.4)).toBeNull();
    });
});

describe("setAxisPosition", () => {
    test("updates V axis x while keeping kind / id / active", () => {
        let axes = defaultAxes(9, 9);
        axes = toggleAxisKind(axes, "V");
        const id = axes.find(a => a.kind === "V")!.id;
        const updated = setAxisPosition(axes, id, { x: 2 });
        const v = updated.find(a => a.kind === "V")!;
        expect(v.kind === "V" && v.x === 2).toBe(true);
        expect(v.active).toBe(true);
    });
    test("updates D1 c", () => {
        let axes = defaultAxes(9, 9);
        const id = axes.find(a => a.kind === "D1")!.id;
        const updated = setAxisPosition(axes, id, { c: 2 });
        const d1 = updated.find(a => a.kind === "D1")!;
        expect(d1.kind === "D1" && d1.c === 2).toBe(true);
    });
    test("updates C both x and y", () => {
        let axes = defaultAxes(9, 9);
        const id = axes.find(a => a.kind === "C")!.id;
        const updated = setAxisPosition(axes, id, { x: 2, y: 3 });
        const c = updated.find(a => a.kind === "C")!;
        expect(c.kind === "C" && c.x === 2 && c.y === 3).toBe(true);
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

describe("toggleAxisKind", () => {
    test("flips one preset's active without touching others", () => {
        const axes = toggleAxisKind(defaultAxes(9, 9), "V");
        expect(axes.find(a => a.kind === "V")!.active).toBe(true);
        expect(axes.find(a => a.kind === "H")!.active).toBe(false);
        expect(axes).toHaveLength(5);
    });

    test("kind not present in list → no-op (defensive — shouldn't happen post-migration)", () => {
        const axes = toggleAxisKind([], "V");
        expect(axes).toEqual([]);
    });
});
