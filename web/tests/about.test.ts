// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { copyrightNotice, LATEST_CHANGELOG_ID, markAboutSeen, shouldShowAbout } from "../src/about";

beforeEach(() => localStorage.clear());

describe("About changelog preference", () => {
    test("shows when no changelog entry has been seen", () => {
        expect(shouldShowAbout()).toBe(true);
    });

    test("stays hidden after the latest changelog entry is seen", () => {
        markAboutSeen();

        expect(localStorage.getItem("mosaic-about-changelog")).toBe(LATEST_CHANGELOG_ID);
        expect(localStorage.getItem("mosaic-about-version")).toBeNull();
        expect(shouldShowAbout()).toBe(false);
    });

    test("shows again when the newest changelog entry changes", () => {
        localStorage.setItem("mosaic-about-changelog", "2026-09-19-pattern-inspector");

        expect(shouldShowAbout()).toBe(true);
    });
});

test("copyright uses the supplied year", () => {
    expect(copyrightNotice(2031)).toBe("© 2031 Drahomír Dlabaja");
});
