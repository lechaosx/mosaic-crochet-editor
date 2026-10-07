import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, chooseToolVariant } from "./_helpers";

const workspace = (page: import("@playwright/test").Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace);

test("No selection preserves saved sources and the next gesture makes another source", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "No selection", exact: true }).click();
    await expect(page.locator("#recipe-controls")).toBeHidden();
    expect((await workspace(page)).activeRecipeId).toBeNull();
    await clickCell(page, 3, 1);
    expect((await workspace(page)).recipes.map((r: { source: { x: number } }) => r.source.x)).toEqual([1, 3]);
});

test("mirror coordinate drafts preview as typed and commit one paired edit", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#add-mirror").click();
    const x = page.getByRole("spinbutton", { name: "Mirror centre x", exact: true });
    const y = page.getByRole("spinbutton", { name: "Mirror centre y", exact: true });
    await x.fill("3"); await x.press("End"); await x.pressSequentially(".5");
    await expect(x).toHaveValue("3.5");
    await y.fill("2.5"); await y.press("Enter");
    expect((await workspace(page)).mirrors[0]).toMatchObject({ x: 3.5, y: 2.5 });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await workspace(page)).mirrors[0]).toMatchObject({ x: 4, y: 4 });
    await expect(page.getByRole("button", { name: "Apply centre position", exact: true })).toHaveCount(0);
});

test("selection mirrors use axis buttons and unavailable quarter turns are disabled", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 3, 3);
    await page.locator("label").filter({ has: page.locator("#recipe-mode-circle") }).click();
    await page.locator("#recipe-centre-x").fill("2.5");
    await page.locator("#recipe-centre-y").fill("2");
    await page.locator("#recipe-centre-y").press("Enter");
    await expect(page.locator("#recipe-turn-90")).toBeDisabled();
    await expect(page.locator("#recipe-turn-180")).toBeEnabled();
    await expect(page.locator("#recipe-turn-270")).toBeDisabled();
    await page.locator("label").filter({ has: page.locator("#recipe-mode-mirror") }).click();
    await expect(page.locator("#recipe-mirror-controls").getByRole("button", { name: "Vertical", exact: true })).toBeVisible();
});

test("selection clearing uses No selection and Escape while preserving saved sources", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByRole("button", { name: "Deselect", exact: true })).toHaveCount(0);
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("Escape");
    expect((await workspace(page)).activeRecipeId).toBeNull();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 3, 1);
    expect((await workspace(page)).recipes.map((r: { source: { x: number } }) => r.source.x)).toEqual([1, 3]);
});

test("blocked overlapping Paste preserves the source without no-fit feedback", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await dragCells(page, 3, 3, 4, 3);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: "No selection", exact: true }).click();
    await clickCell(page, 3, 3);
    await page.locator("label:has(#recipe-mode-mirror)").click();
    await page.locator("#recipe-mirror-centre-x").fill("3.5");
    await page.locator("#recipe-mirror-centre-x").press("Enter");
    await page.locator("#recipe-mirror-v").click();
    const before = await workspace(page);
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("Control+v");
    expect(await workspace(page)).toEqual(before);
    await expect(page.locator("#status-feedback")).toBeHidden();
});

for (const action of ["Cut", "Subtract"] as const) test(`${action} clears the active source and the next selection keeps it saved`, async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    if (action === "Cut") await page.getByRole("button", { name: "Cut", exact: true }).click();
    else {
        await chooseToolVariant(page, "Rectangle", "Subtract");
        await clickCell(page, 1, 1);
    }
    await expect(page.locator("#recipe-create")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#recipe-controls")).toBeHidden();
    expect((await workspace(page)).activeRecipeId).toBeNull();
    if (action === "Subtract") {
        const { chooseToolVariant } = await import("./_helpers");
        await chooseToolVariant(page, "Rectangle", "Replace");
    }
    await clickCell(page, 3, 1);
    expect((await workspace(page)).recipes.map((r: { source: { x: number } }) => r.source.x)).toEqual([1, 3]);
});
