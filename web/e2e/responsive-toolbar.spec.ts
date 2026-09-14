import { test, expect, Page } from "@playwright/test";
import { bootApp } from "./_helpers";

const TOOL_IDS = [
    "tool-pencil", "tool-fill", "tool-eraser", "tool-overlay",
    "tool-invert", "tool-select", "tool-wand", "tool-move",
];

async function expectTargetsAtLeast(page: Page, minimum: number) {
    for (const id of TOOL_IDS) {
        const tool = page.locator(`#${id}`);
        await expect(tool).toBeVisible();
        const box = await tool.boundingBox();
        expect(box!.width, id).toBeGreaterThanOrEqual(minimum);
        expect(box!.height, id).toBeGreaterThanOrEqual(minimum);
    }
}

test("phone toolbar keeps authoring tools full-size and moves secondary commands to More", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);

    await expectTargetsAtLeast(page, 44);
    await expect(page.locator(".dock-group-label").first()).toBeHidden();
    const viewButtons = page.getByRole("group", { name: "Canvas view" }).getByRole("button");
    for (let i = 0; i < await viewButtons.count(); i++) {
        const box = await viewButtons.nth(i).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator(".canvas-controls").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pattern" })).toBeHidden();
    expect(await page.locator("#document-bar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Load", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Pattern" }).click();
    await expect(page.locator("#inspector-host")).toBeVisible();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        window.dispatchEvent(new Event("resize"));
    });
    await expectTargetsAtLeast(page, 44);
    expect(await page.locator("#document-bar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("constrained layouts place the authoring dock below the canvas and use an inspector sheet", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await bootApp(page);
    await expectTargetsAtLeast(page, 44);
    const canvas = await page.locator(".canvas-area").boundingBox();
    const dock = await page.locator("#authoring-dock").boundingBox();
    expect(dock!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height - 1);

    await page.getByRole("button", { name: "Pattern" }).click();
    const inspector = await page.locator("#inspector-host").boundingBox();
    expect(inspector!.y).toBeGreaterThan(canvas!.y);
    expect(inspector!.width).toBe(768);
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    expect(await page.locator("#document-bar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("wide layouts use a document bar, left tool rail, and pinned inspector column", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);
    await expectTargetsAtLeast(page, 36);
    await expect(page.getByText("Colour", { exact: true })).toBeVisible();
    await expect(page.getByText("Overlay", { exact: true })).toBeVisible();
    await expect(page.getByText("Arrange", { exact: true })).toBeVisible();

    const pencilBox = await page.locator("#tool-pencil").boundingBox();
    expect(pencilBox!.width).toBeLessThan(44);
    expect(pencilBox!.height).toBeLessThan(44);
    const documentBar = await page.locator("#document-bar").boundingBox();
    const dock = await page.locator("#authoring-dock").boundingBox();
    const canvasBefore = await page.locator(".canvas-area").boundingBox();
    expect(dock!.y).toBeGreaterThanOrEqual(documentBar!.y + documentBar!.height - 1);
    expect(canvasBefore!.x).toBeGreaterThanOrEqual(dock!.x + dock!.width - 1);

    await page.getByRole("button", { name: "Pattern" }).click();
    const canvasAfter = await page.locator(".canvas-area").boundingBox();
    const inspector = await page.locator("#inspector-host").boundingBox();
    expect(inspector!.x).toBeGreaterThanOrEqual(canvasAfter!.x + canvasAfter!.width - 1);
    expect(canvasAfter!.width).toBeLessThan(canvasBefore!.width);
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    expect(await page.locator("#document-bar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("inspector controls keep their state while the same host recomposes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);

    await page.getByRole("button", { name: "Pattern" }).click();
    const originalWidth = await page.locator("#edit-width").inputValue();
    await page.locator("#edit-width").fill("20");
    await expect(page.locator("#inspector-title")).toHaveText("Pattern");

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator("#inspector-host")).toBeVisible();
    await expect(page.locator("#edit-width")).toHaveValue("20");
    const inspector = await page.locator("#inspector-host").boundingBox();
    expect(inspector!.width).toBe(768);

    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(page.locator("#inspector-host")).toBeHidden();
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.locator("#edit-width")).toHaveValue(originalWidth);
});
