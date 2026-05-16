// Comprehensive modifier-combination coverage. Each test pins one
// potentially-surprising interaction so regressions are caught early.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB, dragCells } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];   // colour A = black in default palette

// ── No-float guards ───────────────────────────────────────────────────────────

test("Arrow with no float does nothing", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);   // paint but no selection
    const c = await cellCoord(page, 1, 1);
    const before = await pixelRGB(page, c.cx, c.cy);
    await page.keyboard.press("ArrowRight");
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(before);
});

test("Ctrl+Arrow with no float does nothing", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    const c = await cellCoord(page, 1, 1);
    const before = await pixelRGB(page, c.cx, c.cy);
    await page.keyboard.press("Control+ArrowRight");
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(before);
});

test("Delete with no float does nothing", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    const c = await cellCoord(page, 1, 1);
    const before = await pixelRGB(page, c.cx, c.cy);
    await page.keyboard.press("Delete");
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(before);
});

// ── Ctrl+Delete and Alt+Delete are no-ops ─────────────────────────────────────

test("Ctrl+Delete does not delete the float (Ctrl block returns first)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);   // float now exists
    await page.keyboard.press("Control+Delete");
    // Float should still exist — anchor it and verify content survived
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(A);
});

test("Alt+Delete does not delete the float", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.down("Alt");
    await page.keyboard.press("Delete");
    await page.keyboard.up("Alt");
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(A);
});

test("Shift+Delete still deletes the float", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("Shift+Delete");
    // Float deleted — cell returns to natural baseline (row 1 = B = not black)
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).not.toEqual(A);
});

// ── Input focus guard ─────────────────────────────────────────────────────────

test("Arrow while an input is focused does not move the float", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);
    // Inject a temporary input and focus it — reliable across any toolbar state.
    await page.evaluate(() => {
        const inp = Object.assign(document.createElement("input"), {
            type: "text", id: "__test_guard_input",
        });
        Object.assign(inp.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
        document.body.appendChild(inp);
        inp.focus();
    });
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => document.getElementById("__test_guard_input")?.remove());
    // Anchor — float should still be at (2,1), not moved
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(A);
});

// ── Move tool drag modifier dominance ─────────────────────────────────────────

test("Alt+drag on Move = mask-only", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Alt");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    // Mask-only: source stamped, destination re-lifts baseline (not a duplicate)
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual(A);
    await page.keyboard.press("Escape");
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual(A);
});

test("Shift+Ctrl+drag is duplicate (Ctrl applies, Shift irrelevant for Move)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Shift");
    await page.keyboard.down("Control");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.keyboard.up("Shift");
    await page.keyboard.press("Escape");
    // Duplicate: both source and destination have A
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual(A);
    expect(await pixelRGB(page, dst.cx, dst.cy)).toEqual(A);
});

test("Alt+Ctrl+drag is mask-only (Alt dominates Ctrl)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Alt");
    await page.keyboard.down("Control");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.keyboard.up("Alt");
    // Alt dominates → mask-only, not duplicate: source has A, destination re-lifted to baseline
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual(A);
    await page.keyboard.press("Escape");
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual(A);
});

// ── Select/wand modifier dominance ───────────────────────────────────────────

test("Shift+Ctrl+wand-click adds (Shift dominates remove)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 0);   // paint A at (0,0) — row 0, col 0
    await page.keyboard.press("w");
    // First wand click — replace select the A region
    await clickCell(page, 0, 0);
    // Shift+Ctrl+wand on another region — Shift dominates → add, not remove
    await page.keyboard.press("p");
    await clickCell(page, 0, 2);   // paint A at (0,2) — different row
    await page.keyboard.press("w");
    await clickCell(page, 0, 2, { modifiers: ["Shift", "Control"] });
    // Both regions should now be selected (add mode kept first selection alive).
    // Verify by painting over the float — paint clips to selection.
    await page.keyboard.press("p");
    await clickCell(page, 0, 0, { button: "right" });   // right-click = secondary (B)
    // (0,0) should still paint (it's in the float)
    await page.keyboard.press("Escape");
    // After anchor, the paint operation should have changed (0,0)
    // (it was inside the float so the right-click paint to B went through)
    const c = await cellCoord(page, 0, 0);
    expect(await pixelRGB(page, c.cx, c.cy)).not.toEqual(A);
});

// ── Ctrl+Arrow edge: already-empty float ─────────────────────────────────────

test("Ctrl+Arrow bakes position into canvas on each new Ctrl press", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    // First Ctrl press: bake at (1,1), float moves to (2,1)
    await page.keyboard.down("Control");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Control");
    // Second Ctrl press: bake at (2,1), float moves to (3,1)
    await page.keyboard.down("Control");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Control");
    await page.keyboard.press("Escape");
    // Both (1,1) and (2,1) were baked; float anchored at (3,1)
    const c1 = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c1.cx, c1.cy)).toEqual(A);
    const c3 = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, c3.cx, c3.cy)).toEqual(A);
});

// ── Move tool: full modifier matrix ──────────────────────────────────────────
// Alt = mask-only. Ctrl = duplicate. Alt dominates Ctrl. Shift = irrelevant.

test("Alt+Shift+drag on Move = mask-only (Alt applies, Shift irrelevant)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    // Mask-only: content stamped at source, marquee re-lifts at destination
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual(A);   // stamped
    await page.keyboard.press("Escape");
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual(A); // not a duplicate
});

test("Alt+Shift+Ctrl+drag on Move = mask-only (Alt dominates Ctrl, Shift irrelevant)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await page.keyboard.down("Control");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    // Mask-only, not duplicate: source has A, destination does not
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual(A);
    await page.keyboard.press("Escape");
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual(A);
});

// ── Select rect drag: Alt consistently ignored ────────────────────────────────

test("Alt+Select drag = replace (Alt ignored)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    // Alt+drag should still create a selection (replace mode)
    await page.keyboard.down("Alt");
    await dragCells(page, 0, 0, 2, 2);
    await page.keyboard.up("Alt");
    // Verify selection exists by painting into it and checking clip
    await page.keyboard.press("p");
    await clickCell(page, 5, 5);   // outside — should be clipped (no-op)
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 5, 5);
    // Row 5 = B baseline; if paint was clipped, it stays baseline (not A)
    expect(await pixelRGB(page, c.cx, c.cy)).not.toEqual(A);
});

test("Alt+Ctrl+Select drag = remove (Alt ignored, Ctrl applies)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await dragCells(page, 0, 0, 4, 4);   // select 5×5 area
    // Alt+Ctrl+drag should remove cells from the selection
    await page.keyboard.down("Alt");
    await page.keyboard.down("Control");
    await dragCells(page, 0, 0, 1, 1);   // remove top-left 2×2
    await page.keyboard.up("Control");
    await page.keyboard.up("Alt");
    // Right-click (secondary = B) at (0,0) — should be clipped since removed.
    // After remove, (0,0) is stamped back to canvas as A (row-0 baseline).
    // If clipped: stays A. If not clipped (bug): becomes B.
    await page.keyboard.press("p");
    await clickCell(page, 0, 0, { button: "right" });
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 0, 0);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(A);   // paint was clipped → stayed A
});

test("Alt+Shift+Select drag = add (Alt ignored, Shift applies)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await dragCells(page, 0, 0, 1, 1);   // initial selection top-left
    // Alt+Shift+drag should add to selection
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await dragCells(page, 3, 3, 4, 4);   // add bottom-right
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    // Paint — both regions should be in float
    await page.keyboard.press("p");
    await clickCell(page, 4, 4);   // should paint (inside added region)
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 4, 4);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual(A);
});
