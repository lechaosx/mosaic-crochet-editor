import { test, expect, type Page } from "@playwright/test";
import { bootApp, chartPixel, clickCell } from "./_helpers";

const DANGER = [211, 47, 47], A = [0, 0, 0], B = [255, 255, 255];

// [r, g, b] of the chart pixel showing pattern point (x, y).
async function patternRGB(page: Page, x: number, y: number) {
    const point = await page.evaluate(point => window.__test_matrix__!.transformPoint(point).toJSON(), { x, y });
    return (await chartPixel(page, Math.round(point.x), Math.round(point.y))).slice(0, 3);
}

test("✕ and ! mark their outward cells in the contrasting yarn and Danger", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    // Yarn B at (4, 8) overlays the Yarn B cell (4, 7); Yarn A at (0, 1) over
    // Yarn B at (0, 2) overlays the Yarn A cell (0, 0) without support.
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 4, 8);
    await clickCell(page, 0, 2);
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 0, 1);

    expect(await patternRGB(page, 4.5, 7.5)).toEqual(A);
    expect(await patternRGB(page, 4.3, 7.3)).toEqual(A);
    expect(await patternRGB(page, 4.5, 7.15)).toEqual(B);
    expect(await patternRGB(page, 3.5, 7.5)).toEqual(B);

    expect(await patternRGB(page, 0.5, 0.5)).toEqual(DANGER);
    expect(await patternRGB(page, 0.5, 0.78)).toEqual(DANGER);
    expect(await patternRGB(page, 0.5, 0.05)).toEqual(A);
    expect(await patternRGB(page, 1.5, 0.5)).toEqual(A);

    // Half a turn: ✕ turns with the chart; ! stays upright on screen.
    for (let turn = 0; turn < 4; turn++) await page.getByRole("button", { name: "Rotate view right" }).click();
    await expect.poll(() => patternRGB(page, 0.5, 0.22)).toEqual(DANGER);
    expect(await patternRGB(page, 0.5, 0.95)).toEqual(A);
    expect(await patternRGB(page, 4.7, 7.7)).toEqual(A);
    expect(await patternRGB(page, 4.5, 7.85)).toEqual(B);
});

test("an edit redraws the glyph its inward neighbour carries", async ({ page }) => {
    await bootApp(page);
    // Yarn B at (4, 6) over Yarn B at (4, 7) is a valid overlay: ✕ on (4, 5).
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 4, 6);
    expect(await patternRGB(page, 4.3, 5.3)).toEqual(A);

    // Yarn A at (4, 7) takes that support away two rows below the glyph: ! on (4, 5).
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 4, 7);
    expect(await patternRGB(page, 4.5, 5.5)).toEqual(DANGER);
    expect(await patternRGB(page, 4.3, 5.3)).toEqual(B);
    expect(await patternRGB(page, 4.3, 6.3)).toEqual(A);
});

test("display-only changes repaint the chart", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 4, 8);
    expect(await patternRGB(page, 4.5, 7.5)).toEqual(A);

    // Each input is set alone: automatic Danger otherwise follows the yarns.
    const setColour = (id: string, value: string) => page.locator(`#${id}`).evaluate((input: HTMLInputElement, value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await setColour("danger-color", "#ff00ff");
    await setColour("color-a", "#123456");
    await page.keyboard.press("Escape");
    expect(await patternRGB(page, 0.5, 0.5)).toEqual([0x12, 0x34, 0x56]);
    expect(await patternRGB(page, 4.5, 7.5)).toEqual([0x12, 0x34, 0x56]);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("slider", { name: "Guidance opacity" }).fill("0");
    await page.keyboard.press("Escape");
    expect(await patternRGB(page, 4.5, 7.5)).toEqual(B);
});

test("without WebGL2 the chart area explains why the chart is missing", async ({ page }) => {
    await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
            return type === "webgl2" ? null : getContext.call(this, type as "2d", ...rest as []);
        } as typeof getContext;
    });
    await bootApp(page);
    await expect(page.getByRole("alert").filter({ hasText: "WebGL 2" })).toBeVisible();
});

test("a chart beyond the device's texture limit shows the message instead", async ({ page }) => {
    await page.addInitScript(() => {
        const getParameter = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (this: WebGL2RenderingContext, name: number) {
            return name === this.MAX_TEXTURE_SIZE ? 4 : getParameter.call(this, name);
        };
    });
    await bootApp(page);
    await expect(page.getByRole("alert").filter({ hasText: "WebGL 2" })).toBeVisible();
});

test("a browser that can't build the chart's shaders shows the message instead", async ({ page }) => {
    await page.addInitScript(() => {
        const getProgramParameter = WebGL2RenderingContext.prototype.getProgramParameter;
        WebGL2RenderingContext.prototype.getProgramParameter = function (this: WebGL2RenderingContext, program: WebGLProgram, name: number) {
            return name === this.LINK_STATUS ? false : getProgramParameter.call(this, program, name);
        };
    });
    await bootApp(page);
    await expect(page.getByRole("alert").filter({ hasText: "WebGL 2" })).toBeVisible();
});

test("the chart returns when the browser restores its graphics context", async ({ page }) => {
    await bootApp(page);
    // The extension is unavailable from a lost context, so keep hold of it.
    await page.evaluate(() => {
        const control = (document.getElementById("chart-gl") as HTMLCanvasElement)
            .getContext("webgl2")!.getExtension("WEBGL_lose_context")!;
        (window as typeof window & { contextControl: WEBGL_lose_context }).contextControl = control;
        control.loseContext();
    });
    const message = page.getByRole("alert").filter({ hasText: "WebGL 2" });
    await expect(message).toBeVisible();
    await page.evaluate(() => (window as typeof window & { contextControl: WEBGL_lose_context }).contextControl.restoreContext());
    await expect(message).toBeHidden();
    await expect.poll(() => patternRGB(page, 0.5, 1.5)).toEqual(B);
});
