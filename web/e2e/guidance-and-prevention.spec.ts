import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

test("guidance opacity changes chart markers without changing placement rules", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("o");
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");

    await page.getByRole("button", { name: "Settings" }).click();
    const target = await cellCoord(page, 2, 1);
    const shown = await pixelRGB(page, target.cx, target.cy);
    const guidance = page.getByRole("slider", { name: "Guidance opacity" });
    const prevention = page.getByRole("checkbox", { name: "Prevent impossible overlay placements" });
    await expect(guidance).toHaveValue("100");
    await expect(prevention).toBeChecked();
    await guidance.fill("0");
    await expect(guidance).toHaveValue("0");
    await expect(prevention).toBeChecked();
    const hidden = await pixelRGB(page, target.cx, target.cy);
    expect(hidden).not.toEqual(shown);
    await guidance.fill("100");
    await expect(guidance).toHaveValue("100");
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual(shown);
});

test("prevention blocks a new impossible mark but allows its correction", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const prevention = page.getByRole("checkbox", { name: "Prevent impossible overlay placements" });
    const preventionLabel = page.locator("label:has(#lock-invalid)");
    await expect(prevention).toBeChecked();
    await page.keyboard.press("Escape");
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);

    await clickCell(page, 1, 0, { button: "right" });
    await expect(page.locator("#status-feedback")).toContainText("Protected");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toBe(before);

    await page.getByRole("button", { name: "Settings" }).click();
    await preventionLabel.click();
    await expect(prevention).not.toBeChecked();
    await page.keyboard.press("Escape");
    await clickCell(page, 1, 0, { button: "right" });
    const wrong = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);
    expect(wrong).not.toBe(before);

    await page.getByRole("button", { name: "Settings" }).click();
    await preventionLabel.click();
    await expect(prevention).toBeChecked();
    await page.keyboard.press("Escape");
    await clickCell(page, 1, 0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toBe(before);
});
