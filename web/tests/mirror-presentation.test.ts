import { expect, test } from "vitest";
import { mirrorTypePresentation } from "../src/mirror-presentation";
import type { SymKey } from "@mosaic/logic/types";

const kinds: SymKey[] = ["V", "H", "C", "D1", "D2"];
const closureMasks = [0, 1, 2, 7, 4, 7, 7, 7, 8, 31, 31, 31, 28, 31, 31, 31,
    16, 31, 31, 31, 28, 31, 31, 31, 28, 31, 31, 31, 28, 31, 31, 31];

for (let mask = 0; mask < 32; mask++) {
    test(`chosen types ${mask} expose their centred geometric implications without changing the choices`, () => {
        const chosen = kinds.filter((_, index) => mask & 1 << index);
        const original = [...chosen];
        const presented = mirrorTypePresentation(chosen);
        expect(presented.filter(type => type.chosen).map(type => type.key).sort()).toEqual([...chosen].sort());
        expect(presented.filter(type => type.chosen || type.implied).map(type => type.key).sort())
            .toEqual(kinds.filter((_, index) => closureMasks[mask] & 1 << index).sort());
        expect(presented.every(type => !type.chosen || !type.implied)).toBe(true);
        expect(chosen).toEqual(original);
    });
}

test("separate centres' explicit types do not imply a joint point symmetry", () => {
    for (const chosen of [["V"], ["H"]] as SymKey[][]) {
        expect(mirrorTypePresentation(chosen).find(type => type.key === "C"))
            .toMatchObject({ chosen: false, implied: false });
    }
});
