// Symmetry helper tests — pure functions, easy to table-drive.
import { describe, test, expect } from "vitest";
import {
    computeClosure, diagonalsAvailable, getSymmetryMask, pruneUnavailableDiagonals,
} from "../src/symmetry";
import { SymKey } from "../src/types";

function setOf(...keys: SymKey[]): Set<SymKey> { return new Set(keys); }

describe("computeClosure", () => {
    test("empty input → empty closure", () => {
        expect(computeClosure(setOf(), true).size).toBe(0);
    });

    test("V + H imply C", () => {
        const r = computeClosure(setOf("V", "H"), true);
        expect(r.has("C")).toBe(true);
    });

    test("V + C imply H", () => {
        expect(computeClosure(setOf("V", "C"), true).has("H")).toBe(true);
    });

    test("D1 + D2 imply C", () => {
        expect(computeClosure(setOf("D1", "D2"), true).has("C")).toBe(true);
    });

    test("diagonals disabled: V + D1 does NOT propagate", () => {
        const r = computeClosure(setOf("V", "D1"), false);
        expect(r.has("D2")).toBe(false);
    });

    test("diagonals enabled: V + D1 implies D2", () => {
        const r = computeClosure(setOf("V", "D1"), true);
        expect(r.has("D2")).toBe(true);
    });

    test("transitive: V + D1 with diagonals → D2 → V (already there) → H via D1+D2 closure check", () => {
        // V + D1 → D2. D1 + D2 → C. V + C → H. So closure is all five.
        const r = computeClosure(setOf("V", "D1"), true);
        for (const k of ["V", "H", "C", "D1", "D2"] as SymKey[]) {
            expect(r.has(k)).toBe(true);
        }
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

describe("getSymmetryMask", () => {
    test("encodes the closed set as a bitfield", () => {
        // V=1, H=2, C=4, D1=8, D2=16
        expect(getSymmetryMask(setOf("V"), 9, 9)).toBe(1);
        expect(getSymmetryMask(setOf("V", "H"), 9, 9)).toBe(1 | 2 | 4);   // C implied
    });

    test("diagonal bits respect (W-H) parity", () => {
        // (9-8)=1 odd → diagonals unavailable. D1 alone in active → still
        // becomes D1 in the mask (the gating is in the *caller* who decides
        // what to put in `active`; getSymmetryMask just encodes closure).
        const mask = getSymmetryMask(setOf("D1"), 9, 8);
        expect(mask & 8).toBe(8);
    });
});

describe("pruneUnavailableDiagonals", () => {
    test("keeps diagonals when (W-H) is even", () => {
        const r = pruneUnavailableDiagonals(setOf("V", "D1"), 9, 9);
        expect(r.has("D1")).toBe(true);
    });

    test("drops D1 and D2 when (W-H) is odd", () => {
        const r = pruneUnavailableDiagonals(setOf("V", "D1", "D2"), 9, 8);
        expect(r.has("D1")).toBe(false);
        expect(r.has("D2")).toBe(false);
        expect(r.has("V")).toBe(true);
    });
});
