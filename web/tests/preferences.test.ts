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

    test("round-trips independently from project recovery", () => {
        const preferences = {
            guidanceOpacity: 0,
            dangerColor: "#ff0000",
            accentColor: "#00ffff",
            labelsVisible: false,
            lockInvalid: false,
        };

        expect(saveAppPreferences(preferences)).toBe(true);
        expect(loadAppPreferences()).toEqual(preferences);
        expect(localStorage.getItem("mosaic-recovery")).toBeNull();
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
