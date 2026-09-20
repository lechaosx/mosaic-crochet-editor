// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import {
    fingerprintPattern,
    fingerprintPatternShape,
    loadLiveProgress,
    saveLiveProgress,
} from "../src/live-progress";

const units = [
    { label: "Row 1", yarn: "B" as const, text: "Row 1: 3 sc", workedCoords: [0, 1, 1, 1, 2, 1] },
    { label: "Row 2", yarn: "A" as const, text: "Row 2: 1 sc, 1 oc, 1 sc", workedCoords: [2, 2, 1, 2, 0, 2] },
];

beforeEach(() => localStorage.clear());

describe("Live instruction progress", () => {
    test("fingerprints pattern content independently from its shape", () => {
        const pattern = { mode: "row" as const, canvasWidth: 3, canvasHeight: 2 };
        const first = fingerprintPattern(pattern, new Uint8Array([1, 1, 1, 2, 2, 2]));
        const same = fingerprintPattern({ ...pattern }, new Uint8Array([1, 1, 1, 2, 2, 2]));
        const changedPixels = fingerprintPattern(pattern, new Uint8Array([1, 2, 1, 2, 2, 2]));

        expect(same).toBe(first);
        expect(changedPixels).not.toBe(first);
        expect(fingerprintPatternShape(pattern)).toBe(fingerprintPatternShape({ ...pattern }));
    });

    test("restores progress after stitch changes with the same geometry", () => {
        const fingerprint = fingerprintPatternShape({ mode: "row", canvasWidth: 3, canvasHeight: 2 });
        expect(saveLiveProgress(fingerprint, 1)).toBe(true);
        expect(loadLiveProgress(fingerprint, units.length)).toBe(1);
        expect(loadLiveProgress(
            fingerprintPatternShape({ mode: "row", canvasWidth: 4, canvasHeight: 2 }),
            units.length,
        )).toBe(0);
        expect(localStorage.getItem("mosaic-live-progress")).toBeNull();
    });

    test("rejects malformed or out-of-range progress", () => {
        const fingerprint = fingerprintPatternShape({ mode: "row", canvasWidth: 3, canvasHeight: 2 });
        localStorage.setItem("mosaic-live-progress", JSON.stringify({
            version: 2,
            fingerprint,
            completedUnits: 3,
        }));

        expect(loadLiveProgress(fingerprint, units.length)).toBe(0);
        expect(localStorage.getItem("mosaic-live-progress")).toBeNull();
    });
});
