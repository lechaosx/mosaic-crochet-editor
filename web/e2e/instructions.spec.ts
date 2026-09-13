import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("Instructions Text is a peer workspace and returning preserves Design", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Instructions" }).click();
    await expect(page.getByRole("main", { name: "Instructions Text" })).toBeVisible();
    await expect(page.locator(".canvas-area")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();
    await expect(page.getByText("oc", { exact: true })).toBeVisible();
    await expect(page.getByText("Chart-required overlay operation")).toBeVisible();

    const text = page.getByRole("textbox", { name: "Compressed instructions" });
    await expect(text).toHaveValue(/^Row 1:/);
    await expect(text).toHaveValue(/oc/);
    await expect(page.getByRole("button", { name: "Copy text" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Download text" })).toBeEnabled();

    await page.getByRole("button", { name: "Back to Design" }).click();
    await expect(page.locator(".canvas-area")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeVisible();
    const painted = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, painted.cx, painted.cy)).toEqual([0, 0, 0]);
});
