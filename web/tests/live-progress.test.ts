// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import {
    fingerprintInstructionPlan,
    loadLiveProgress,
    saveLiveProgress,
} from "../src/live-progress";

const units = [
    { label: "Row 1", yarn: "B" as const, text: "Row 1: 3 sc", workedCoords: [0, 1, 1, 1, 2, 1] },
    { label: "Row 2", yarn: "A" as const, text: "Row 2: 1 sc, 1 oc, 1 sc", workedCoords: [2, 2, 1, 2, 0, 2] },
];

beforeEach(() => localStorage.clear());

describe("Live instruction progress", () => {
    test("fingerprints the complete structured plan deterministically", () => {
        const first = fingerprintInstructionPlan(units);
        const same = fingerprintInstructionPlan(units.map(unit => ({
            ...unit,
            workedCoords: [...unit.workedCoords],
        })));
        const changedPath = fingerprintInstructionPlan([
            units[0],
            { ...units[1], workedCoords: [0, 2, 1, 2, 2, 2] },
        ]);

        expect(same).toBe(first);
        expect(changedPath).not.toBe(first);
    });

    test("restores only progress for the exact plan", () => {
        const fingerprint = fingerprintInstructionPlan(units);
        expect(saveLiveProgress(fingerprint, 1)).toBe(true);
        expect(loadLiveProgress(fingerprint, units.length)).toBe(1);
        expect(loadLiveProgress("another-plan", units.length)).toBe(0);
    });

    test("rejects malformed or out-of-range progress", () => {
        const fingerprint = fingerprintInstructionPlan(units);
        localStorage.setItem("mosaic-live-progress", JSON.stringify({
            version: 1,
            fingerprint,
            completedUnits: 3,
        }));

        expect(loadLiveProgress(fingerprint, units.length)).toBe(0);
        expect(localStorage.getItem("mosaic-live-progress")).toBeNull();
    });
});
