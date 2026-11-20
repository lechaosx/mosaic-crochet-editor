// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { loadProjectIndex, saveProjectIndex } from "../src/project-store";

afterEach(() => localStorage.clear());

describe("project index", () => {
    test("reads back the open projects, their titles and the active one", () => {
        const open = [{ id: "a", title: "Example" }, { id: "b", title: "motif.mcw" }];
        expect(saveProjectIndex(open, "a")).toBe(true);
        expect(loadProjectIndex()).toEqual({ open, active: "a" });
    });

    test("reads back an index with no open project", () => {
        expect(saveProjectIndex([], null)).toBe(true);
        expect(loadProjectIndex()).toEqual({ open: [], active: null });
    });

    test("lists no projects when no index or an index of another version is stored", () => {
        expect(loadProjectIndex()).toBeNull();
        localStorage.setItem("mosaic-projects", JSON.stringify({ version: 1, open: ["a"], active: "a" }));
        expect(loadProjectIndex()).toBeNull();
    });

    test("lists no projects when an entry's id or title isn't a string", () => {
        for (const entry of [{ id: "a", title: 7 }, { id: "a" }, { id: 7, title: "x" }]) {
            localStorage.setItem("mosaic-projects", JSON.stringify({ version: 2, open: [entry], active: entry.id }));
            expect(loadProjectIndex()).toBeNull();
        }
    });
});
