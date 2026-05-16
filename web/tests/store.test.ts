// Store + visiblePixels tests. The Store class invariants we care about:
// `commit` runs mutate → recompute → history → render → persist → observers
// in that order, with per-call opt-outs; `visiblePixels` stamps the float
// onto pixels with off-canvas / hole / pixels=0 drops.

import { describe, test, expect } from "vitest";
import { Store, visiblePixels } from "../src/store";
import type { SessionState } from "../src/store";
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
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        const out = visiblePixels(s);
        expect(out[0]).toBe(2);
    });

    test("with offset: stamps at (source + offset)", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 1),
        });
        const out = visiblePixels(s);
        expect(out[0 * 3 + 0]).toBe(1);   // source position unchanged in `pixels` (this fn doesn't touch base)
        expect(out[1 * 3 + 1]).toBe(2);   // stamped at (0+1, 0+1)
    });

    test("off-canvas destinations drop", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 10, 10),
        });
        const out = visiblePixels(s);
        expect(out[0]).toBe(1);   // canvas unchanged everywhere
        expect(out[8]).toBe(1);
    });

    test("pixels=0 cells in the float skip stamping (cut-content marquee)", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            // mask=1 but pixels=0 — won't stamp; canvas stays as is.
            float: { mask: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0]), pixels: new Uint8Array(9), dx: 0, dy: 0 },
        });
        const out = visiblePixels(s);
        expect(out[0]).toBe(1);
    });
});

describe("Store commit chain", () => {
    function newStore(): Store {
        return new Store(rowSession(3, 3));
    }

    test("commit runs mutate then recomputes plan by default", () => {
        const s = newStore();
        const planBefore = s.plan;
        s.commit(state => { state.pixels = filledPixels(3, 3, 1); });
        // plan is recomputed (new Int16Array reference)
        expect(s.plan).not.toBe(planBefore);
    });

    test("recompute=false skips plan rebuild", () => {
        const s = newStore();
        const planBefore = s.plan;
        s.commit(state => { state.hlOpacity = 50; }, { recompute: false });
        expect(s.plan).toBe(planBefore);
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

    test("replace swaps state, recomputes plan, fires renderer", () => {
        const s = newStore();
        let renders = 0;
        s.setRenderer(() => { renders++; });
        const next: SessionState = { ...s.state, hlOpacity: 50 };
        s.replace(next);
        expect(s.state.hlOpacity).toBe(50);
        expect(renders).toBe(1);
    });
});
