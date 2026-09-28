// @vitest-environment jsdom

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
            accentColor: "#d653a3",
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
            dangerColor: "#ff0000",
            accentColor: "#d653a3",
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
