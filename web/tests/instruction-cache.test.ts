import { describe, expect, it } from "vitest";
import { cachedInstructionUnit, type CachedInstructionUnit, type InstructionUnitSignature } from "../src/instruction-cache";

function signature(contentKey: string, invalidWorkedCoords: readonly number[] = []): InstructionUnitSignature {
    return {
        label: "Row 1", yarn: "A", contentKey, invalidWorkedCoords,
        startDirection: [0, 0, 1, 0], reversedStartDirection: [1, 0, 0, 0],
    };
}

function hydrate(sig: InstructionUnitSignature): CachedInstructionUnit {
    return {
        ...sig,
        text: `${sig.label}: ${sig.contentKey}`,
        reversedText: `${sig.label}: reversed ${sig.contentKey}`,
        workedCoords: [0, 0, 1, 0],
        reversedWorkedCoords: [1, 0, 0, 0],
        invalid: sig.invalidWorkedCoords.length > 0,
    };
}

describe("instruction cache", () => {
    const previous = { shapeFingerprint: "rows-2", units: [hydrate(signature("a")), hydrate(signature("b"))] };

    it("misses on a cold generation", () => {
        expect(cachedInstructionUnit(null, "rows-2", 0, signature("a"))).toBeNull();
    });

    it("reuses an unchanged unit", () => {
        expect(cachedInstructionUnit(previous, "rows-2", 0, signature("a"))).toBe(previous.units[0]);
        expect(cachedInstructionUnit(previous, "rows-2", 1, signature("b"))).toBe(previous.units[1]);
    });

    it("misses only a locally changed stitch sequence", () => {
        expect(cachedInstructionUnit(previous, "rows-2", 0, signature("a"))).toBe(previous.units[0]);
        expect(cachedInstructionUnit(previous, "rows-2", 1, signature("changed"))).toBeNull();
    });

    it("misses every unit when traversal shape changes", () => {
        expect(cachedInstructionUnit(previous, "rounds-2", 0, signature("a"))).toBeNull();
        expect(cachedInstructionUnit(previous, "rounds-2", 1, signature("b"))).toBeNull();
    });

    it("updates invalid metadata without recompressing an unchanged overlay stitch", () => {
        const first = hydrate(signature("oc"));
        const next = cachedInstructionUnit({ shapeFingerprint: "rows-1", units: [first] }, "rows-1", 0, signature("oc", [3, 4]));
        expect(next).not.toBeNull();
        expect(next).not.toBe(first);
        expect(next!.text).toBe(first.text);
        expect(next!.invalid).toBe(true);
        expect(next!.invalidWorkedCoords).toEqual([3, 4]);
    });
});
