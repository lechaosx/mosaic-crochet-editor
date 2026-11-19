// Store + visiblePixels tests. The Store class invariants we care about:
// `commit` runs mutate → recompute → history → render → persist → observers
// in that order, with per-call opt-outs; `visiblePixels` stamps the float
// onto pixels with off-canvas / hole / pixels=0 drops.

import { describe, test, expect } from "vitest";
import { Store, visiblePixels, outOfBounds, forEachCell } from "../src/store";
import type { SessionState } from "../src/store";
import type { PatternState } from "../src/types";
import { initialize_round_pattern } from "@mosaic/wasm";
import fc from "fast-check";
import { filledPixels, makeFloat, rowSession } from "./_helpers";

describe("visiblePixels", () => {
    test("no float: returns the pixels buffer unchanged", () => {
        const s = rowSession(3, 3);
        const out = visiblePixels(s);
        // visiblePixels copies internally only when a float exists; with no
        // float the contract is "==="? Actually it returns `s.pixels`.
        expect(out).toBe(s.pixels);
    });

    test("with float at dx=dy=0: stamps mask cells onto canvas", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        const out = visiblePixels(s);
        expect(out[0]).toBe(2);
    });

    test("with offset: stamps at canvas position (absolute coords)", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        const out = visiblePixels(s);
        expect(out[0 * 3 + 0]).toBe(1);   // (0,0) untouched
        expect(out[1 * 3 + 1]).toBe(2);   // stamped at (1,1)
    });

    test("off-canvas destinations drop", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 10, y: 10, v: 2 }]),
        });
        const out = visiblePixels(s);
        expect(out[0]).toBe(1);   // canvas unchanged everywhere
        expect(out[8]).toBe(1);
    });

    test("pixels=0 cells in the float skip stamping (cut-content marquee)", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            // Float at (0,0) with pixels=0 (absent) — won't stamp; canvas stays as is.
            float: { x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array([0]) },
        });
        const out = visiblePixels(s);
        expect(out[0]).toBe(1);
    });
});

describe("Store commit chain", () => {
    function newStore(): Store {
        return new Store(rowSession(3, 3));
    }

    test("commit runs mutate then updates the plan by default", () => {
        const s = newStore();
        const version = s.planVersion;
        s.commit(state => { state.pixels = filledPixels(3, 3, 1); });
        expect(s.planVersion).not.toBe(version);
        expect(s.plan).toEqual(new Store(rowSession(3, 3, { pixels: filledPixels(3, 3, 1) })).plan);
    });

    test("the plan counts glyph cells and warnings, a round corner once", () => {
        const pattern: PatternState = { mode: "round", canvasWidth: 9, canvasHeight: 9,
            virtualWidth: 9, virtualHeight: 9, offsetX: 0, offsetY: 0, rounds: 3 };
        const pixels = initialize_round_pattern(9, 9, 9, 9, 0, 0, 3);
        for (const [x, y] of [[1, 1], [1, 4]]) pixels[y * 9 + x] = pixels[y * 9 + x] === 1 ? 2 : 1;
        const s = new Store(rowSession(9, 9, { pattern, pixels }));
        // (1, 1) is a corner whose warning has two outward cells; (1, 4) is a valid overlay.
        expect([s.plan.marked, s.plan.invalid]).toEqual([2, 1]);
    });

    test("recompute=false skips plan rebuild", () => {
        const s = newStore();
        const version = s.planVersion;
        s.commit(state => { state.rotation = 45; }, { recompute: false });
        expect(s.planChangeSince(version)).toBeNull();
    });

    test("history flag triggers historyFn", () => {
        const s = newStore();
        let fired = 0;
        s.setHistoryFn(() => { fired++; });
        s.commit(state => { state.pixels = filledPixels(3, 3, 1); });
        expect(fired).toBe(0);
        s.commit(state => { state.pixels = filledPixels(3, 3, 2); }, { history: true });
        expect(fired).toBe(1);
    });

    test("render flag invokes renderer (default true)", () => {
        const s = newStore();
        let renders = 0;
        s.setRenderer(() => { renders++; });
        s.commit(() => {});
        expect(renders).toBe(1);
        s.commit(() => {}, { render: false });
        expect(renders).toBe(1);
    });

    test("observers fire on every commit", () => {
        const s = newStore();
        let fired = 0;
        s.addObserver(() => { fired++; });
        s.commit(() => {});
        s.commit(() => {});
        expect(fired).toBe(2);
    });

    test("persist=false suppresses persistFn", () => {
        const s = newStore();
        let persists = 0;
        s.setPersistFn(() => { persists++; });
        s.commit(() => {}, { persist: false });
        expect(persists).toBe(0);
        s.commit(() => {});
        expect(persists).toBe(1);
    });

    test("replace swaps state, recomputes plan, fires renderer", () => {
        const s = newStore();
        let renders = 0;
        s.setRenderer(() => { renders++; });
        const next: SessionState = { ...s.state, rotation: 45 };
        s.replace(next);
        expect(s.state.rotation).toBe(45);
        expect(renders).toBe(1);
    });

    test("replace with history=true triggers historyFn", () => {
        const s = newStore();
        let fired = 0;
        s.setHistoryFn(() => { fired++; });
        s.replace({ ...s.state });
        expect(fired).toBe(0);
        s.replace({ ...s.state }, { history: true });
        expect(fired).toBe(1);
    });

    test("replace with persist=true triggers persistFn", () => {
        const s = newStore();
        let persists = 0;
        s.setPersistFn(() => { persists++; });
        s.replace({ ...s.state });
        expect(persists).toBe(0);
        s.replace({ ...s.state }, { persist: true });
        expect(persists).toBe(1);
    });
});

describe("outOfBounds", () => {
    test("returns false for interior cell", () => {
        expect(outOfBounds(1, 1, 3, 3)).toBe(false);
    });
    test("returns true when x < 0", () => {
        expect(outOfBounds(-1, 1, 3, 3)).toBe(true);
    });
    test("returns true when x >= W", () => {
        expect(outOfBounds(3, 1, 3, 3)).toBe(true);
    });
    test("returns true when y < 0", () => {
        expect(outOfBounds(1, -1, 3, 3)).toBe(true);
    });
    test("returns true when y >= H", () => {
        expect(outOfBounds(1, 3, 3, 3)).toBe(true);
    });
});

describe("forEachCell", () => {
    test("visits every cell in a W×H grid exactly once", () => {
        const W = 3, H = 4;
        const visited = new Set<string>();
        forEachCell(W, H, (x, y) => { visited.add(`${x},${y}`); });
        expect(visited.size).toBe(W * H);
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++)
                expect(visited.has(`${x},${y}`)).toBe(true);
    });
});

describe("Store plan changes", () => {
    type Step =
        | { kind: "paint"; x: number; y: number; yarn: 1 | 2 }
        | { kind: "lift"; x: number; y: number; w: number; h: number; yarn: 1 | 2 }
        | { kind: "move"; dx: number; dy: number }
        | { kind: "drop" }
        | { kind: "keep" }
        | { kind: "pattern" };
    const step: fc.Arbitrary<Step> = fc.oneof(
        fc.record({ kind: fc.constant("paint" as const), x: fc.nat(), y: fc.nat(), yarn: fc.constantFrom<1 | 2>(1, 2) }),
        fc.record({ kind: fc.constant("lift" as const), x: fc.nat(), y: fc.nat(),
            w: fc.integer({ min: 1, max: 3 }), h: fc.integer({ min: 1, max: 3 }), yarn: fc.constantFrom<1 | 2>(1, 2) }),
        fc.record({ kind: fc.constant("move" as const), dx: fc.integer({ min: -2, max: 2 }), dy: fc.integer({ min: -2, max: 2 }) }),
        fc.constant({ kind: "drop" as const }),
        fc.constant({ kind: "keep" as const }),
        fc.constant({ kind: "pattern" as const }),
    );

    function apply(state: SessionState, next: Step): void {
        const { canvasWidth: W, canvasHeight: H } = state.pattern;
        switch (next.kind) {
            case "paint": {
                const pixels = state.pixels.slice();
                pixels[(next.y % H) * W + next.x % W] = next.yarn;
                state.pixels = pixels;
                break;
            }
            case "lift":
                state.float = { x: next.x % W, y: next.y % H, w: next.w, h: next.h,
                    pixels: new Uint8Array(next.w * next.h).fill(next.yarn) };
                break;
            case "move":
                if (state.float) state.float = { ...state.float, x: state.float.x + next.dx, y: state.float.y + next.dy };
                break;
            case "drop":
                state.float = null;
                break;
            case "keep":
                state.rotation += 90;
                break;
            case "pattern":
                state.pattern = { ...state.pattern };
                break;
        }
    }

    test("each commit's change region holds every changed visible pixel and plan cell", () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 7 }), fc.integer({ min: 1, max: 7 }), fc.array(step, { minLength: 1, maxLength: 12 }),
            (W, H, steps) => {
                const s = new Store(rowSession(W, H));
                for (const next of steps) {
                    const version = s.planVersion;
                    const visible = visiblePixels(s.state).slice(), cells = s.plan.cells.slice();
                    s.commit(state => apply(state, next));
                    expect(s.plan).toEqual(new Store({ ...s.state }).plan);
                    const change = s.planChangeSince(version);
                    if (next.kind === "pattern") expect(change).toBe("all");
                    if (change === "all") continue;
                    const after = visiblePixels(s.state);
                    forEachCell(W, H, (x, y) => {
                        const i = y * W + x;
                        if (after[i] === visible[i] && s.plan.cells[i] === cells[i]) return;
                        expect(change).not.toBeNull();
                        expect(x >= change!.x && x < change!.x + change!.width
                            && y >= change!.y && y < change!.y + change!.height).toBe(true);
                    });
                }
            },
        ), { numRuns: 300 });
    });

    test("a commit that keeps the visible pixels keeps the plan version", () => {
        const s = new Store(rowSession(3, 3));
        const version = s.planVersion;
        s.commit(state => { state.rotation = 90; state.pixels = state.pixels.slice(); });
        expect(s.planVersion).toBe(version);
        expect(s.planChangeSince(version)).toBeNull();
    });

    test("a reader more than one change behind, or of another store, rebuilds", () => {
        const s = new Store(rowSession(3, 3));
        const version = s.planVersion;
        s.commit(state => { state.pixels = filledPixels(3, 3, 1); });
        expect(s.planChangeSince(version)).not.toBe("all");
        s.commit(state => { state.pixels = filledPixels(3, 3, 2); });
        expect(s.planChangeSince(version)).toBe("all");
        expect(s.planChangeSince(new Store(rowSession(3, 3)).planVersion)).toBe("all");
        expect(s.planChangeSince(null)).toBe("all");
    });

    test("replace rebuilds the plan", () => {
        const s = new Store(rowSession(3, 3));
        const version = s.planVersion;
        s.replace({ ...s.state, pixels: filledPixels(3, 3, 1) });
        expect(s.planChangeSince(version)).toBe("all");
    });
});
