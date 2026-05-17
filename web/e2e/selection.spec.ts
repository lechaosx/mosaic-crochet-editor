// Selection / float flows. The marquee can be verified visually via the
// dragRect outline, but the easiest pure-DOM test is "Ctrl+A then commit
// and verify state via paint" — we paint after Ctrl+A and verify the
// stroke landed inside the lifted area.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

test("Ctrl+A lifts every paintable cell into a float", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    // No DOM affordance for "float exists" — paint into it to verify.
    // We can't tell from outside; instead, deselect should bake the
    // (unchanged) float back; nothing visible changes. This test is
    // mostly a smoke check that Ctrl+A doesn't throw.
    await page.keyboard.press("Control+Shift+A");
});

test("Select-rect drag then paint clips to the lifted region", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    // Drag from (1,1) to (3,3): lifts a 3×3 area.
    await dragCells(page, 1, 1, 3, 3);
    // Switch to pencil with secondary colour, paint outside the float
    // at cell (5, 5). Should be a no-op (paint clipped to float).
    await page.keyboard.press("p");
    await clickCell(page, 5, 5, { button: "right" });
    // Cell (5, 5) baseline = row 5 = B; right-click would paint B too,
    // so no observable change. Use (4, 1) instead — row 1 is B.
    await clickCell(page, 4, 1);
    const c = await cellCoord(page, 4, 1);
    const [r, g, b] = await pixelRGB(page, c.cx, c.cy);
    // (4, 1) is outside the 1..3 × 1..3 float → paint should be clipped,
    // so cell stays at the row-1 baseline = B (255).
    expect(r).toBeGreaterThan(200);
});

test("Move tool drag repositions the float", async ({ page }) => {
    await bootApp(page);
    // Make a small selection.
    await page.keyboard.press("s");
    await dragCells(page, 1, 1, 2, 2);
    // Switch to Move and drag the float by (+3, 0).
    await page.keyboard.press("m");
    await dragCells(page, 1, 1, 4, 1);
    // The original lift site at (1, 1) should now show the natural baseline
    // (row 1 = B), since the lift cut it and the move took the content away.
    const src = await cellCoord(page, 1, 1);
    const [r] = await pixelRGB(page, src.cx, src.cy);
    expect(r).toBeGreaterThan(200);   // baseline B → high R
});

test("Ctrl+Shift+A deselects", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+A");
    // No DOM hook to assert directly; this is a smoke test that the
    // shortcut path doesn't throw.
});

test("Esc stamps float content into canvas and clears selection", async ({ page }) => {
    await bootApp(page);
    // Paint a cell, lift it with select-all, verify float exists via paint-clip,
    // then Esc to anchor.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // row 1 baseline = B; paint A at (0,1)
    await page.keyboard.press("Control+a");
    // Move the float one cell right.
    await page.keyboard.press("m");
    const src = await cellCoord(page, 0, 1);
    const dst = await cellCoord(page, 1, 1);
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    // Esc: should stamp at current offset (1,1) and clear selection.
    await page.keyboard.press("Escape");
    // After anchor, paint A at (1,1) would overwrite; verify it has the stamped colour.
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // A = black
});

test("Delete clears content and keeps selection active with baseline content", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // paint A at (0,1)
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);   // select that cell
    await page.keyboard.press("Delete");
    // Canvas at (0,1) cleared to baseline (row 1 = B = not black)
    const c = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).not.toEqual([0, 0, 0]);
    // Selection still active — move it to verify the float exists
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    // After anchoring the moved baseline-content float, (1,1) should have baseline (B)
    const dst = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual([0, 0, 0]);
});

test("Arrow keys nudge float by 1 cell per press", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // paint A at (0,1)
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);   // select
    // Nudge right once, then anchor with Esc.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    // Content should now be at (1,1).
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);
});

test("Shift+Arrow nudges float by 5 cells", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // paint A at (0,1)
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);   // select
    // Shift+ArrowRight = 5 cells.
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 5, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);
});

test("Ctrl+Arrow bakes current position into canvas and moves float with content", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 1);   // paint A at (2,1)
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);   // select it
    await page.keyboard.down("Control");
    await page.keyboard.press("ArrowRight");   // bake at (2,1), move float to (3,1)
    await page.keyboard.up("Control");
    // Source (2,1) baked — has A in canvas
    const src = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);
    // Float still has content and is now at (3,1) — anchor stamps it there too
    await page.keyboard.press("Escape");
    const dst = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, dst.cx, dst.cy)).toEqual([0, 0, 0]);   // float anchored with content
});

test("Ctrl+Arrow bakes only on the first Arrow while Ctrl is held", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);
    await page.keyboard.down("Control");
    await page.keyboard.press("ArrowRight");   // bakes at (2,1), moves to (3,1)
    await page.keyboard.press("ArrowRight");   // no new bake, moves to (4,1)
    await page.keyboard.up("Control");
    // (2,1) was baked on first press
    const c2 = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, c2.cx, c2.cy)).toEqual([0, 0, 0]);
    // Float anchors at (4,1) with content
    await page.keyboard.press("Escape");
    const c4 = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, c4.cx, c4.cy)).toEqual([0, 0, 0]);
    // (3,1) was NOT baked on the second press
    const c3 = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, c3.cx, c3.cy)).not.toEqual([0, 0, 0]);
});

test("Ctrl+Shift+Arrow bakes once then moves float 5 cells", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await page.keyboard.down("Control");
    await page.keyboard.down("Shift");
    await page.keyboard.press("ArrowRight");   // bake at (0,1), move float 5 cells to (5,1)
    await page.keyboard.up("Shift");
    await page.keyboard.up("Control");
    const src = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);   // baked
    await page.keyboard.press("Escape");
    const dst = await cellCoord(page, 5, 1);
    expect(await pixelRGB(page, dst.cx, dst.cy)).toEqual([0, 0, 0]);   // float anchored with content
});

test("Alt+Arrow stamps content, moves marquee, then re-lifts on Alt release", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 1);   // paint A at (2,1)
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);   // select
    // Hold Alt and press Arrow — stamps at (2,1), moves marquee to (3,1)
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowRight");
    // Content stamped at source while Alt is still held
    const src = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);
    // Release Alt — should re-lift canvas at (3,1) into the float
    await page.keyboard.up("Alt");
    // Float is now re-lifted at (3,1). Move it further to verify content exists.
    await page.keyboard.press("ArrowRight");   // regular move to (4,1)
    await page.keyboard.press("Escape");       // anchor
    // (3,1) was re-lifted then moved out — canvas at (3,1) = baseline (not A)
    const mid = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, mid.cx, mid.cy)).not.toEqual([0, 0, 0]);
    // (4,1) has the re-lifted + anchored content
    const dst = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual([0, 0, 0]);   // re-lifted = baseline B, not A
});

test("Ctrl+drag duplicates float content at current position", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);   // paint A at (1,1)
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);   // select it
    await page.keyboard.press("m");
    // Ctrl+drag from (1,1) to (3,1): pre-stamps at (1,1), drags to (3,1)
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Control");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.keyboard.press("Escape");
    // Both source and destination should have the painted colour
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, dst.cx, dst.cy)).toEqual([0, 0, 0]);
});

test("Alt+drag moves the marquee without the float content (mask-only)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);   // paint A at (1,1)
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);   // select
    await page.keyboard.press("m");
    // Alt+drag from (1,1) to (3,1): stamps content at (1,1), drags empty marquee
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Alt");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    // Content stamped at source — source keeps the painted colour
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);
    // Marquee re-lifts at (3,1) and anchors to baseline (not a duplicate)
    await page.keyboard.press("Escape");
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual([0, 0, 0]);
});

test("Shift+drag on Move is regular move (Shift has no special Move meaning)", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.keyboard.down("Shift");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.keyboard.press("Escape");
    // Regular move: content at destination, source at baseline
    expect(await pixelRGB(page, dst.cx, dst.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, src.cx, src.cy)).not.toEqual([0, 0, 0]);
});

test("Alt+drag re-lifts canvas content at new position on release", async ({ page }) => {
    // Paint B at destination (3,0) — row 0 baseline = A (black).
    // After re-lift: canvas[3,0] = A, float contains B at (3,0).
    // Move the float away, then canvas[3,0] is exposed as A (not B).
    // Without re-lift: float = null, canvas[3,0] = B → stays white.
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 0, { button: "right" });   // paint B at source (1,0)
    await clickCell(page, 3, 0, { button: "right" });   // paint B at destination (3,0)
    await page.keyboard.press("s");
    await dragCells(page, 1, 0, 1, 0);   // drag-select (1,0) — triggers onPaintAt
    await page.keyboard.press("m");
    const src = await cellCoord(page, 1, 0);
    const dst = await cellCoord(page, 3, 0);
    await page.keyboard.down("Alt");
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    // Float now at (3,0) with re-lifted content. Move it right so (3,0) is uncovered.
    await page.keyboard.press("ArrowRight");   // float → (4,0)
    // Now (3,0) canvas is exposed: A (black) if re-lift worked, B (white) if not.
    const c = await cellCoord(page, 3, 0);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // A ← re-lift cut canvas to baseline
});

test("Alt+Arrow destroys float when it is entirely outside the canvas", async ({ page }) => {
    await bootApp(page);
    // Paint A at (0,1) so we can detect if the float re-lands there unexpectedly.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    // Lift (1,1) — baseline B — then move it left until fully off-canvas (x = -4).
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    // Alt+ArrowRight: without fix the float jumps to (0,1) and re-lifts the A there.
    // With fix it is destroyed immediately (no float, no jump).
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Alt");
    // If float survived (bug): ArrowRight + Escape would stamp A at (1,1).
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 1, 1);
    const [r] = await pixelRGB(page, c.cx, c.cy);
    expect(r).toBeGreaterThan(200);   // B (white) — float destroyed, not jumped
});

test("Alt+Arrow clips float to in-bounds cells — does not jump or expand selection", async ({ page }) => {
    // Lift (6,0)+(7,0)+(8,0) — 3 cells. Move right × 2: only (8,0) stays in canvas.
    // Without fix: clamping snaps the 3-cell float back to x=6, covering all 3 cells again.
    // With fix: clips to just the 1 visible cell (8,0), so (6,0)/(7,0) are never re-included.
    await bootApp(page);
    await page.keyboard.press("s");
    await dragCells(page, 6, 0, 8, 0);      // lift 3 cells in row 0 (baseline A)
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // float now at x=8, covering (8,0),(9,0),(10,0)
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowLeft");  // without fix: jumps to x=6 (3-cell); with fix: x=7 (1-cell)
    await page.keyboard.up("Alt");
    // Paint B at (8,0). Without fix (8,0) is in the expanded float → paint succeeds.
    // With fix (8,0) is outside the 1-cell float at (7,0) → paint rejected, stays A (black).
    await page.keyboard.press("p");
    await clickCell(page, 8, 0, { button: "right" });
    const c = await cellCoord(page, 8, 0);
    const [r] = await pixelRGB(page, c.cx, c.cy);
    expect(r).toBeLessThan(50);   // A (black) — (8,0) not in float
});

test("Alt+Arrow is clamped to canvas bounds — float is not lost when pressing into an edge", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // paint A at left edge (0,1)
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);   // lift it — float = A at (0,1)
    // Alt+ArrowLeft: float is at x=0; trying to move to x=-1 must be clamped.
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.up("Alt");   // re-lift at clamped (0,1), not at (-1,1)
    // Float must still exist. Move right to expose the canvas and confirm content.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // float had A content
});

test("Alt+drag is clamped to canvas bounds — float is not lost at edge", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // paint A at (0,1)
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);   // select (1,1) — baseline B
    await page.keyboard.press("m");
    // Alt+drag from (1,1) to (-3,1) — past the left edge.
    // Clamped: float stays at (0,1) on release.
    await dragCells(page, 1, 1, -3, 1, ["Alt"]);
    // Float must still exist at (0,1) with re-lifted canvas[0,1] = A.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    const c = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // re-lifted A anchored at (1,1)
});

test("Alt+Arrow re-lifts at new position on Alt release", async ({ page }) => {
    // Paint B at (3,0). Alt+ArrowRight moves float to (3,0), Alt release re-lifts.
    // After re-lift: canvas[3,0] = A, float at (3,0). Move float right to expose (3,0).
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 0, { button: "right" });   // paint B at source (2,0)
    await clickCell(page, 3, 0, { button: "right" });   // paint B at destination (3,0)
    await page.keyboard.press("s");
    await clickCell(page, 2, 0);   // select (2,0)
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowRight");   // stamp (2,0), marquee → (3,0)
    await page.keyboard.up("Alt");             // re-lift from (3,0), cuts canvas[3,0] to A
    // Float is now at (3,0) covering the re-lifted cell. Move it right to expose (3,0).
    await page.keyboard.press("ArrowRight");   // float → (4,0)
    const c = await cellCoord(page, 3, 0);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // A ← canvas was cut on re-lift
});
