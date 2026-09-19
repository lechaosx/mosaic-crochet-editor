import { test, expect } from "@playwright/test";

async function bootFresh(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
}

test("fresh load offers starts without creating recovery and canceled creation returns", async ({ page }) => {
    await bootFresh(page);

    const start = page.getByRole("region", { name: "Start a pattern" });
    await expect(start).toBeVisible();
    await expect(page.getByRole("button", { name: "Row pattern" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Centre-out pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open .mcw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try an example" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBeNull();

    await page.getByRole("button", { name: "Centre-out pattern" }).click();
    await expect(page.getByRole("radio", { name: "Centre-out" })).toBeChecked();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(start).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBeNull();
});

test("canceling the fresh-start file picker keeps the choices available", async ({ page }) => {
    await page.addInitScript(() => {
        const nativeClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
            if (this.type === "file") {
                this.dispatchEvent(new Event("cancel"));
                return;
            }
            nativeClick.call(this);
        };
    });
    await bootFresh(page);

    await page.getByRole("button", { name: "Open .mcw" }).click();

    await expect(page.getByRole("region", { name: "Start a pattern" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBeNull();
});

test("opening an mcw file from the fresh choices enters the editor", async ({ page }) => {
    await bootFresh(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open .mcw" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "small.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 1,
            state: { mode: "row", canvasWidth: 3, canvasHeight: 3 },
            pixels: [1, 1, 1, 2, 2, 2, 1, 1, 1],
            colorA: "#102030",
            colorB: "#f0e0d0",
        })),
    });

    await expect(page.locator("#start-surface")).toBeHidden();
    const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
    expect(recovery.document.state.canvasWidth).toBe(3);
});

test("applying an intentionally blank pattern restores directly on return", async ({ page }) => {
    await bootFresh(page);
    await page.getByRole("button", { name: "Row pattern" }).click();
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page.locator("#start-surface")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).not.toBeNull();

    await page.reload();
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    await expect(page.locator("#start-surface")).toBeHidden();
    await expect(page.getByRole("status", { name: "Browser recovery" }))
        .toHaveText("Recovered from this device");
});

test("legacy browser recovery bypasses the start choices", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem("mosaic-pattern-v4", JSON.stringify({
            version: 4,
            state: { mode: "row", canvasWidth: 9, canvasHeight: 9 },
            pixels: "AAAAAAAAAAAAAAA=",
            colorA: "#000000",
            colorB: "#ffffff",
            activeTool: "pencil",
            primaryColor: 1,
            axes: [],
            hlOpacity: 100,
            invalidIntensity: 65,
            float: null,
            labelsVisible: true,
            lockInvalid: true,
            canvasRotation: 0,
        }));
    });
    await bootFresh(page);

    await expect(page.locator("#start-surface")).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-pattern-v4"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).not.toBeNull();
});

test("example is editable and demonstrates overlay, mirror, repeat, and Crochet", async ({ page }) => {
    await bootFresh(page);
    await page.getByRole("button", { name: "Try an example" }).click();

    const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
    expect(recovery.workspace.axes.length).toBeGreaterThan(0);
    expect(recovery.workspace.repeat.enabled).toBe(true);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.locator("#instructions-units")).toContainText("oc");
});

test("fresh choices fit a compact viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await bootFresh(page);

    for (const name of ["Row pattern", "Centre-out pattern", "Open .mcw", "Try an example"]) {
        const button = page.getByRole("button", { name });
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
        expect(box!.y + box!.height).toBeLessThanOrEqual(480);
    }
});
