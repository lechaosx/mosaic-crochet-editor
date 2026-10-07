// @vitest-environment jsdom

import { contrastingProjectColors } from "../src/contrast-colors";
import { beforeEach, describe, expect, test } from "vitest";
import {
    DEFAULT_APP_PREFERENCES,
    loadAppPreferences,
    saveAppPreferences,
} from "../src/preferences";

beforeEach(() => localStorage.clear());

describe("app preferences", () => {
    test("uses stable defaults when no preferences are stored", () => {
        expect(loadAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);
    });

    test("stores display preferences with the fixed application palette", () => {
        const preferences = {
            guidanceOpacity: 0,
            dangerColor: "#ff0000",
            accentColor: "#00ffff",
            labelsVisible: false,
            lockInvalid: false,
        };

        expect(saveAppPreferences(preferences)).toBe(true);
        expect(loadAppPreferences()).toEqual({
            ...preferences,
            dangerColor: contrastingProjectColors("#000000", "#ffffff").danger,
            accentColor: contrastingProjectColors("#000000", "#ffffff").accent,
        });
        expect(localStorage.getItem("mosaic-recovery")).toBeNull();
    });

    test("stored legacy palette defaults cannot redefine the application palette", () => {
        localStorage.setItem("mosaic-preferences", JSON.stringify({
            version: 1,
            guidanceOpacity: 37,
            dangerColor: "#aa0000",
            accentColor: "#006699",
            labelsVisible: false,
            lockInvalid: false,
        }));

        expect(loadAppPreferences()).toEqual({
            guidanceOpacity: 37,
            dangerColor: contrastingProjectColors("#000000", "#ffffff").danger,
            accentColor: contrastingProjectColors("#000000", "#ffffff").accent,
            labelsVisible: false,
            lockInvalid: false,
        });
    });

    test("rejects malformed stored values as a whole", () => {
        localStorage.setItem("mosaic-preferences", JSON.stringify({
            version: 1,
            guidanceOpacity: 101,
            dangerColor: "red",
            accentColor: "#00ffff",
            labelsVisible: false,
            lockInvalid: false,
        }));

        expect(loadAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);
        expect(localStorage.getItem("mosaic-preferences")).toBeNull();
    });
});

test("default guidance colours contrast automatically with the default yarns", () => {
    const colors = contrastingProjectColors("#000000", "#ffffff");
    expect(DEFAULT_APP_PREFERENCES.dangerColor).toBe(colors.danger);
    expect(DEFAULT_APP_PREFERENCES.accentColor).toBe(colors.accent);
});
