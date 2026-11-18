import { test, expect, type Page } from "@playwright/test";
import { bootApp } from "./_helpers";

function recordLabels(page: Page) {
    return page.addInitScript(() => {
        const labels: string[] = [];
        (window as typeof window & { __test_labels__: string[] }).__test_labels__ = labels;
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
            if (/^\d+$/.test(text)) labels.push(text);
            if (maxWidth === undefined) return fillText.call(this, text, x, y);
            return fillText.call(this, text, x, y, maxWidth);
        };
    });
}

test("row labels number the bottom row 1", async ({ page }) => {
    await recordLabels(page);
    await bootApp(page);

    const labels = await page.evaluate(() => [
        ...new Set((window as typeof window & { __test_labels__: string[] }).__test_labels__),
    ]);
    expect(labels).toEqual(["9", "8", "7", "6", "5", "4", "3", "2", "1"]);
});

// Each chart labels a cell: a row's first cell, or the top-left corner cell of a full round.
const zoomedCharts = {
    rows: {
        setUp: async (page: Page) => {
            await page.locator("#edit-width").fill("2");
            await page.locator("#edit-width").press("Tab");
            await page.locator("#edit-height").fill("40");
            await page.locator("#edit-height").press("Tab");
        },
        labelledCells: Array.from({ length: 40 }, (_, y) => ({ x: 0, y, label: String(40 - y) })),
    },
    rounds: {
        setUp: async (page: Page) => {
            await page.getByText("Centre-out", { exact: true }).click();
            await page.getByLabel("Rounds").fill("20");
            await page.getByLabel("Rounds").press("Tab");
        },
        labelledCells: Array.from({ length: 20 }, (_, i) => ({ x: i, y: i, label: String(20 - i) })),
    },
};
for (const [chart, { setUp, labelledCells }] of Object.entries(zoomedCharts)) {
    for (const turns of [1, 3]) {
        test(`zoomed ${chart} keep the labels of every cell on screen after ${turns} quarter turns`, async ({ page }) => {
            await recordLabels(page);
            await bootApp(page);
            await page.getByRole("button", { name: "Pattern", exact: true }).click();
            await setUp(page);
            await page.keyboard.press("Escape");
            for (let turn = 0; turn < turns; turn++) await page.getByRole("button", { name: "Rotate view right" }).click();
            await page.waitForTimeout(300);
            const box = (await page.locator("#canvas").boundingBox())!;
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            for (let notch = 0; notch < 10; notch++) await page.mouse.wheel(0, -120);

            await page.evaluate(() => { (window as typeof window & { __test_labels__: string[] }).__test_labels__.length = 0; });
            const toggleNumbers = () => page.locator("#labels-on").evaluate((numbers: HTMLInputElement) => numbers.click());
            await toggleNumbers();
            await toggleNumbers();

            const drawn = await page.evaluate(() => (window as typeof window & { __test_labels__: string[] }).__test_labels__);
            // Cells at least one cell inside the canvas, so their labels lie on it.
            const onScreen = await page.evaluate(cells => {
                const m = window.__test_matrix__!, canvas = document.getElementById("canvas") as HTMLCanvasElement;
                const cell = Math.hypot(m.a, m.b);
                return cells.filter(({ x, y }) => {
                    const p = m.transformPoint({ x: x + 0.5, y: y + 0.5 });
                    return p.x >= cell && p.y >= cell && p.x <= canvas.width - cell && p.y <= canvas.height - cell;
                }).map(({ label }) => label);
            }, labelledCells);
            expect(onScreen.length).toBeGreaterThan(0);
            expect(onScreen.length).toBeLessThan(labelledCells.length);
            expect(drawn).toEqual(expect.arrayContaining(onScreen));
        });
    }
}
