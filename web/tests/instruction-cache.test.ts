import { describe, expect, it } from "vitest";
import { buildInstructionUnits, shouldYieldInstructionGeneration, type CachedInstructionUnit, type InstructionUnitSignature } from "../src/instruction-cache";

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
    it("hydrates every unit on a cold generation", () => {
        let calls = 0;
        const units = buildInstructionUnits(null, "rows-2", [signature("a"), signature("b")], sig => {
            calls++;
            return hydrate(sig);
        });
        expect(calls).toBe(2);
        expect(units).toHaveLength(2);
    });

    it("does not hydrate unchanged units", () => {
        const first = buildInstructionUnits(null, "rows-2", [signature("a"), signature("b")], hydrate);
        let calls = 0;
        const next = buildInstructionUnits({ shapeFingerprint: "rows-2", units: first }, "rows-2", [signature("a"), signature("b")], sig => {
            calls++;
            return hydrate(sig);
        });
        expect(calls).toBe(0);
        expect(next[0]).toBe(first[0]);
        expect(next[1]).toBe(first[1]);
    });

    it("hydrates only a locally changed stitch sequence", () => {
        const first = buildInstructionUnits(null, "rows-2", [signature("a"), signature("b")], hydrate);
        let calls = 0;
        const next = buildInstructionUnits({ shapeFingerprint: "rows-2", units: first }, "rows-2", [signature("a"), signature("changed")], sig => {
            calls++;
            return hydrate(sig);
        });
        expect(calls).toBe(1);
        expect(next[0]).toBe(first[0]);
        expect(next[1]).not.toBe(first[1]);
    });

    it("invalidates every unit when traversal shape changes", () => {
        const first = buildInstructionUnits(null, "rows-2", [signature("a"), signature("b")], hydrate);
        let calls = 0;
        buildInstructionUnits({ shapeFingerprint: "rows-2", units: first }, "rounds-2", [signature("a"), signature("b")], sig => {
            calls++;
            return hydrate(sig);
        });
        expect(calls).toBe(2);
    });

    it("updates invalid metadata without recompressing an unchanged overlay stitch", () => {
        const first = buildInstructionUnits(null, "rows-1", [signature("oc")], hydrate);
        let calls = 0;
        const next = buildInstructionUnits({ shapeFingerprint: "rows-1", units: first }, "rows-1", [signature("oc", [3, 4])], sig => {
            calls++;
            return hydrate(sig);
        });
        expect(calls).toBe(0);
        expect(next[0]).not.toBe(first[0]);
        expect(next[0].invalid).toBe(true);
        expect(next[0].invalidWorkedCoords).toEqual([3, 4]);
    });

    it("batches warm cache scans while yielding changed units and long scans", () => {
        const warmYields = Array.from({ length: 80 }, (_, index) =>
            shouldYieldInstructionGeneration(index, false));
        const localYields = Array.from({ length: 80 }, (_, index) =>
            shouldYieldInstructionGeneration(index, index === 31));

        expect(warmYields.flatMap((yielded, index) => yielded ? [index] : [])).toEqual([63]);
        expect(localYields.flatMap((yielded, index) => yielded ? [index] : [])).toEqual([31, 63]);
    });
});
