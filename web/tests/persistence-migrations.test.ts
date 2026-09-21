// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import { packFloat, packPixels } from "@mosaic/logic/storage";
import { addAxis } from "@mosaic/logic/symmetry";
import { loadFromLocalStorage } from "../src/storage-io";
import { loadAppPreferences } from "../src/preferences";
import { historyPeek } from "../src/history";
import { makeFloat, rowSession } from "./_helpers";

beforeEach(() => { localStorage.clear(); });

describe("browser persistence migrations", () => {
    test("migrates recovery v4 into the versioned recovery envelope", () => {
        const valid = { id: "valid", kind: "V" as const, active: false, x: 1 };
        const stale = { id: "stale", kind: "H" as const, active: true, y: 0 };
        const session = rowSession(3, 3, {
            axes: [valid, stale],
            liveMirrors: false,
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        localStorage.setItem("mosaic-pattern-v4", JSON.stringify({
            version: 4,
            state: session.pattern,
            pixels: packPixels(session.pixels),
            colorA: session.colorA,
            colorB: session.colorB,
            activeTool: session.activeTool,
            primaryColor: session.primaryColor,
            axes: session.axes,
            liveTransforms: session.liveMirrors,
            hlOpacity: 42,
            invalidIntensity: 17,
            float: packFloat(session.float!),
            labelsVisible: false,
            lockInvalid: true,
            canvasRotation: session.rotation,
        }));

        const restored = loadFromLocalStorage();
        expect(restored).toMatchObject({
            pattern: session.pattern,
            axes: [valid],
            recipes: [],
            liveMirrors: false,
        });
        expect(restored!.float).toEqual(session.float);

        const migrated = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        expect(migrated.version).toBe(6);
        expect(migrated.document).toMatchObject({ state: session.pattern, colorA: session.colorA, colorB: session.colorB });
        expect(migrated.workspace).toMatchObject({
            axes: session.axes,
            liveTransforms: false,
            rotation: session.rotation,
        });
        expect(migrated.preferences).toBeUndefined();
        expect(loadAppPreferences()).toMatchObject({
            guidanceOpacity: 42,
            labelsVisible: false,
            lockInvalid: true,
        });
        expect(localStorage.getItem("mosaic-pattern-v4")).toBeNull();
    });

    test("migrates the unversioned history v4 blob into bounded v5 snapshots", () => {
        const session = rowSession(3, 3, { axes: addAxis([], "H", 3, 3) });
        localStorage.setItem("mosaic-history-v4", JSON.stringify({
            snapshots: [{
                state: session.pattern,
                pixels: packPixels(session.pixels),
                float: null,
                axes: session.axes,
                colorA: session.colorA,
                colorB: session.colorB,
            }],
            index: 0,
        }));

        expect(historyPeek()).toMatchObject({
            pattern: session.pattern,
            axes: session.axes,
        });

        const migrated = JSON.parse(localStorage.getItem("mosaic-history")!);
        expect(migrated.version).toBe(5);
        expect(migrated.snapshots[0]).toEqual({
            document: {
                state: session.pattern,
                pixels: packPixels(session.pixels),
                colorA: session.colorA,
                colorB: session.colorB,
            },
            selection: null,
            transforms: { axes: session.axes },
        });
        expect(localStorage.getItem("mosaic-history-v4")).toBeNull();
    });

    test("does not interpret a future recovery or history schema", () => {
        localStorage.setItem("mosaic-recovery", JSON.stringify({ version: 999 }));
        localStorage.setItem("mosaic-history", JSON.stringify({ version: 999 }));

        expect(loadFromLocalStorage()).toBeNull();
        expect(historyPeek()).toBeNull();
    });

    test("keeps legacy recovery when writing the migrated envelope fails", () => {
        const session = rowSession(3, 3);
        const legacy = JSON.stringify({
            version: 4,
            state: session.pattern,
            pixels: packPixels(session.pixels),
            colorA: session.colorA,
            colorB: session.colorB,
            activeTool: session.activeTool,
            primaryColor: session.primaryColor,
            axes: session.axes,
            liveTransforms: session.liveMirrors,
            hlOpacity: 100,
            invalidIntensity: 65,
            float: null,
            labelsVisible: true,
            lockInvalid: true,
            canvasRotation: session.rotation,
        });
        localStorage.setItem("mosaic-pattern-v4", legacy);
        const originalSetItem = Storage.prototype.setItem;
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
            if (key === "mosaic-recovery") throw new DOMException("full", "QuotaExceededError");
            return originalSetItem.call(this, key, value);
        });

        try {
            expect(loadFromLocalStorage()).not.toBeNull();
            expect(localStorage.getItem("mosaic-pattern-v4")).toBe(legacy);
        } finally {
            setItem.mockRestore();
        }
    });
});
