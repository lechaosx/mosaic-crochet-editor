import { test, expect, Page } from "@playwright/test";
import { bootApp } from "./_helpers";

async function matrix(page: Page) {
    return page.evaluate(() => {
        const m = window.__test_matrix__!;
        return { a: m.a, b: m.b, e: m.e, f: m.f };
    });
}

async function historyLength(page: Page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length);
}

async function dragCanvas(page: Page, button: "left" | "middle" = "left") {
    const box = await page.locator("#canvas").boundingBox();
    if (!box) throw new Error("canvas bounds unavailable");
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 60, start.y + 35, { steps: 4 });
    await page.mouse.up({ button });
}

test("canvas view controls zoom, fit, rotate, and reset without editing", async ({ page }) => {
    await bootApp(page);
    const before = await matrix(page);
    const history = await historyLength(page);
    const controls = page.getByRole("group", { name: "Canvas view" });

    await expect(controls.getByRole("button", { name: "Fit view" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Zoom out" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Rotate view left" })).toBeVisible();
    await expect(controls.getByRole("button", { name: "Rotate view right" })).toBeVisible();

    await controls.getByRole("button", { name: "Zoom in" }).click();
    expect((await matrix(page)).a).toBeGreaterThan(before.a);
    await controls.getByRole("button", { name: "Fit view" }).click();
    expect((await matrix(page)).a).toBeCloseTo(before.a, 4);

    await controls.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(350);
    expect(Math.abs((await matrix(page)).b)).toBeGreaterThan(1);
    const reset = controls.locator("#view-rotation-reset");
    await expect(reset).toHaveAccessibleName("Reset view orientation from 45°");
    const arrow = reset.locator(".view-orientation-arrow");
    await expect(arrow).toHaveText("↑");
    await expect(arrow).toHaveCSS("transform", "matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)");
    await reset.click();
    await page.waitForTimeout(350);
    expect((await matrix(page)).b).toBeCloseTo(0, 4);
    await expect(reset).toHaveAccessibleName("Reset view orientation");

    await controls.getByRole("button", { name: "Rotate view left" }).click();
    await page.waitForTimeout(350);
    await expect(reset).toHaveAccessibleName("Reset view orientation from −45°");
    await expect(arrow).toHaveCSS("transform", "matrix(0.707107, -0.707107, 0.707107, 0.707107, 0, 0)");
    await reset.click();
    expect(await historyLength(page)).toBe(history);
});

test("Navigate button pans without changing the active authoring tool", async ({ page }) => {
    await bootApp(page);
    const before = await matrix(page);
    const history = await historyLength(page);
    const navigate = page.getByRole("button", { name: "Navigate" });

    await navigate.click();
    await expect(navigate).toHaveAttribute("aria-pressed", "true");
    await dragCanvas(page);

    const after = await matrix(page);
    expect(after.e).not.toBeCloseTo(before.e, 2);
    expect(after.f).not.toBeCloseTo(before.f, 2);
    await expect(page.getByRole("button", { name: "Pencil" })).toHaveAttribute("aria-pressed", "true");
    expect(await historyLength(page)).toBe(history);

    await page.getByRole("button", { name: "Fill" }).click();
    await expect(navigate).toHaveAttribute("aria-pressed", "false");
});

test("Space-drag is momentary Navigate and middle-drag still pans", async ({ page }) => {
    await bootApp(page);
    const navigate = page.getByRole("button", { name: "Navigate" });
    const history = await historyLength(page);
    const beforeSpace = await matrix(page);

    await page.getByRole("img", { name: "Editable pattern chart" }).focus();
    await page.keyboard.down("Space");
    await expect(navigate).toHaveAttribute("aria-pressed", "true");
    await dragCanvas(page);
    await page.keyboard.up("Space");
    await expect(navigate).toHaveAttribute("aria-pressed", "false");
    expect((await matrix(page)).e).not.toBeCloseTo(beforeSpace.e, 2);

    const beforeMiddle = await matrix(page);
    await dragCanvas(page, "middle");
    expect((await matrix(page)).e).not.toBeCloseTo(beforeMiddle.e, 2);
    expect(await historyLength(page)).toBe(history);
});
