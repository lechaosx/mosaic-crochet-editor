import { expect, test } from "@playwright/test";
import { addGlobalMirror, bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

test("painting does not rewrite unchanged local mirror descriptions", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        const observations: string[] = [];
        (window as typeof window & { descriptions: string[] }).descriptions = observations;
        new MutationObserver(records => observations.push(...records.map(record => record.attributeName!)))
            .observe(document.getElementById("recipe-mirror-controls")!, {
                subtree: true, attributes: true, attributeFilter: ["aria-description", "title"],
            });
    });
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 3, 4);
    expect(await page.evaluate(() => (window as typeof window & { descriptions: string[] }).descriptions)).toEqual([]);
});

test("dimension changes leave unchanged global mirror metadata stable", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: /^Global Mirror:/ }).click();
    await addGlobalMirror(page, "Vertical");
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.evaluate(() => {
        const observations: string[] = [];
        (window as typeof window & { descriptions: string[] }).descriptions = observations;
        new MutationObserver(records => observations.push(...records.map(record => `${(record.target as Element).id}:${record.attributeName}`)))
            .observe(document.getElementById("sym-popover")!, {
                subtree: true, attributes: true,
                attributeFilter: ["aria-description", "aria-label", "title", "data-mirror-id", "hidden"],
            });
    });
    await page.locator("#edit-width").fill("10");
    expect(await page.evaluate(() => (window as typeof window & { descriptions: string[] }).descriptions)).toEqual([]);
});

test("a pattern at the maximum side length draws its cells", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    const maxWidth = Number(await page.locator("#edit-width").getAttribute("max"));
    await page.locator("#edit-width").fill(String(maxWidth));
    await page.locator("#edit-width").press("Tab");
    await page.locator("#edit-height").fill("2");
    await page.locator("#edit-height").press("Tab");
    await page.keyboard.press("Escape");
    const box = (await page.locator("#canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
    const centre = await page.evaluate(({ x, y }) => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const point = window.__test_matrix__!.inverse()
            .transformPoint({ x: (x - rect.left) * dpr, y: (y - rect.top) * dpr });
        return { x: Math.floor(point.x), y: Math.floor(point.y) };
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(centre.x).toBeGreaterThan(maxWidth / 4);
    const cell = await cellCoord(page, centre.x, Math.min(1, Math.max(0, centre.y)));
    expect([[0, 0, 0], [255, 255, 255]]).toContainEqual(await pixelRGB(page, cell.cx, cell.cy));
});
