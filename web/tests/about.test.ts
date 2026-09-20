// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { copyrightNotice, markAboutSeen, shouldShowAbout } from "../src/about";

const CURRENT_RELEASE_HASH = "current-hash";

beforeEach(() => localStorage.clear());

describe("About release-note preference", () => {
    test("shows when no release has been seen", () => {
        expect(shouldShowAbout(CURRENT_RELEASE_HASH)).toBe(true);
    });

    test("stays hidden after the latest release is seen", () => {
        markAboutSeen(CURRENT_RELEASE_HASH);

        expect(localStorage.getItem("mosaic-about-release-notes")).toBe(CURRENT_RELEASE_HASH);
        expect(localStorage.getItem("mosaic-about-version")).toBeNull();
        expect(shouldShowAbout(CURRENT_RELEASE_HASH)).toBe(false);
    });

    test("shows again when the newest release changes", () => {
        localStorage.setItem("mosaic-about-release-notes", "stale-hash");

        expect(shouldShowAbout(CURRENT_RELEASE_HASH)).toBe(true);
    });
});

test("copyright uses the supplied year", () => {
    expect(copyrightNotice(2031)).toBe("© 2031 Drahomír Dlabaja");
});
