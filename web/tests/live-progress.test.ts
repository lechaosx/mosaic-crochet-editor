// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import {
    fingerprintPattern,
    fingerprintPatternShape,
    clearLiveProgress,
    hasLiveProgress,
    loadLiveProgress,
    saveLiveProgress,
    deleteLiveProgressExcept,
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
        expect(saveLiveProgress("p", fingerprint, 1)).toBe(true);
        expect(loadLiveProgress("p", fingerprint, units.length)).toBe(1);
        expect(loadLiveProgress("p", 
            fingerprintPatternShape({ mode: "row", canvasWidth: 4, canvasHeight: 2 }),
            units.length,
        )).toBe(0);
        expect(localStorage.getItem("mosaic-live-progress:p")).not.toBeNull();
        expect(loadLiveProgress("p", fingerprint, units.length)).toBe(1);
    });

    test("clears resumable progress explicitly", () => {
        const fingerprint = fingerprintPatternShape({ mode: "row", canvasWidth: 3, canvasHeight: 2 });
        expect(saveLiveProgress("p", fingerprint, 1)).toBe(true);
        expect(hasLiveProgress("p", fingerprint, units.length)).toBe(true);

        clearLiveProgress("p");

        expect(hasLiveProgress("p", fingerprint, units.length)).toBe(false);
        expect(localStorage.getItem("mosaic-live-progress:p")).toBeNull();
    });

    test("rejects malformed or out-of-range progress", () => {
        const fingerprint = fingerprintPatternShape({ mode: "row", canvasWidth: 3, canvasHeight: 2 });
        localStorage.setItem("mosaic-live-progress:p", JSON.stringify({
            version: 2,
            fingerprint,
            completedUnits: 3,
        }));

        expect(loadLiveProgress("p", fingerprint, units.length)).toBe(0);
        expect(localStorage.getItem("mosaic-live-progress:p")).toBeNull();
    });
});

test("smaller incompatible previews cannot discard valid progress", () => {
    const original = fingerprintPatternShape({ mode: "row", canvasWidth: 16, canvasHeight: 16 });
    saveLiveProgress("p", original, 12);
    const raw = localStorage.getItem("mosaic-live-progress:p");
    const preview = fingerprintPatternShape({ mode: "row", canvasWidth: 16, canvasHeight: 2 });
    expect(loadLiveProgress("p", preview, 2)).toBe(0);
    expect(hasLiveProgress("p", preview, 2)).toBe(false);
    expect(localStorage.getItem("mosaic-live-progress:p")).toBe(raw);
    expect(loadLiveProgress("p", original, 16)).toBe(12);
    saveLiveProgress("p", preview, 1);
    expect(loadLiveProgress("p", original, 16)).toBe(0);
    expect(loadLiveProgress("p", preview, 2)).toBe(1);
});

test("each project keeps its own progress", () => {
    const fingerprint = fingerprintPatternShape({ mode: "row", canvasWidth: 3, canvasHeight: 2 });
    saveLiveProgress("p", fingerprint, 1);
    saveLiveProgress("q", fingerprint, 2);
    clearLiveProgress("q");
    expect(loadLiveProgress("p", fingerprint, 2)).toBe(1);
    expect(loadLiveProgress("q", fingerprint, 2)).toBe(0);
});

test("deleting the progress of closed projects keeps open projects' progress and other records", () => {
    const fingerprint = fingerprintPatternShape({ mode: "row", canvasWidth: 3, canvasHeight: 2 });
    saveLiveProgress("open", fingerprint, 1);
    saveLiveProgress("closed", fingerprint, 2);
    localStorage.setItem("mosaic-preferences", "{}");
    deleteLiveProgressExcept(["open"]);
    expect(loadLiveProgress("open", fingerprint, 2)).toBe(1);
    expect(localStorage.getItem("mosaic-live-progress:closed")).toBeNull();
    expect(localStorage.getItem("mosaic-preferences")).toBe("{}");
});
