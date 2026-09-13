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
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pattern" })).toBeHidden();
    expect(await page.locator("#toolbar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        window.dispatchEvent(new Event("resize"));
    });
    await expectTargetsAtLeast(page, 44);
    expect(await page.locator("#toolbar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("compact layouts keep 44px tools without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await bootApp(page);
    await expectTargetsAtLeast(page, 44);
    expect(await page.locator("#toolbar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("wide fine-pointer layouts use compact desktop targets", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);
    await expectTargetsAtLeast(page, 36);

    const pencilBox = await page.locator("#tool-pencil").boundingBox();
    expect(pencilBox!.width).toBeLessThan(44);
    expect(pencilBox!.height).toBeLessThan(44);
    expect(await page.locator("#toolbar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
