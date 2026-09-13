import { test, expect } from "@playwright/test";
import { bootApp } from "./_helpers";

test("row labels exclude the foundation and number the first worked row 1", async ({ page }) => {
    await page.addInitScript(() => {
        const labels: string[] = [];
        (window as typeof window & { __test_labels__: string[] }).__test_labels__ = labels;
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
            if (/^\d+$/.test(text)) labels.push(text);
            if (maxWidth === undefined) return fillText.call(this, text, x, y);
            return fillText.call(this, text, x, y, maxWidth);
        };
    });
    await bootApp(page);

    const labels = await page.evaluate(() => [
        ...new Set((window as typeof window & { __test_labels__: string[] }).__test_labels__),
    ]);
    expect(labels).toEqual(["8", "7", "6", "5", "4", "3", "2", "1"]);
});
