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

async function renderedBounds(page: Page) {
    return page.locator("#canvas").evaluate((canvas: HTMLCanvasElement) => {
        const { width, height } = canvas;
        const pixels = canvas.getContext("2d", { willReadFrequently: true })!
            .getImageData(0, 0, width, height).data;
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                if (pixels[i] === 22 && pixels[i + 1] === 22 && pixels[i + 2] === 24) continue;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
        return { minX, minY, maxX, maxY, width, height };
    });
}

test("Fit keeps row numbers inside constrained canvases", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);

    for (const viewport of [{ width: 360, height: 740 }, { width: 820, height: 1180 }]) {
        await page.setViewportSize(viewport);
        await page.getByRole("button", { name: "Fit view" }).click();
        const bounds = await renderedBounds(page);
        expect(bounds.minX, `${viewport.width}px left edge`).toBeGreaterThanOrEqual(4);
        expect(bounds.maxX, `${viewport.width}px right edge`).toBeLessThanOrEqual(bounds.width - 5);
        expect(bounds.minY, `${viewport.width}px top edge`).toBeGreaterThanOrEqual(4);
        expect(bounds.maxY, `${viewport.width}px bottom edge`).toBeLessThanOrEqual(bounds.height - 5);
    }
});

test("turning row numbers on reframes the phone canvas and updates cell size", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);
    const openSettings = async () => {
        await page.getByRole("button", { name: "More" }).click();
        await page.getByRole("menuitem", { name: "Settings" }).click();
    };
    await openSettings();
    await page.getByText("Show numbers", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Show numbers" })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Fit view" }).click();
    const withoutNumbers = await page.evaluate(() => ({
        scale: window.__test_matrix__!.a,
        offset: window.__test_matrix__!.e,
    }));

    await openSettings();
    await page.getByText("Show numbers", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Show numbers" })).toBeChecked();
    await page.keyboard.press("Escape");

    const withNumbers = await page.evaluate(() => ({
        scale: window.__test_matrix__!.a,
        offset: window.__test_matrix__!.e,
    }));
    expect(withNumbers.scale).toBeLessThan(withoutNumbers.scale);
    expect(withNumbers.offset).not.toBe(withoutNumbers.offset);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const fittedCellSize = `${Math.round(withNumbers.scale / dpr)} px`;
    await expect(page.locator("#view-zoom-value")).toHaveText(fittedCellSize);
    const bounds = await renderedBounds(page);
    expect(bounds.minX).toBeGreaterThanOrEqual(4);
});

test("Fit keeps rotated half-round numbers inside a phone canvas", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await bootApp(page);
    await page.locator("#btn-edit").click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Half", { exact: true }).click();
    await page.locator("#edit-apply").click();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Fit view" }).click();

    const bounds = await renderedBounds(page);
    expect(bounds.minX).toBeGreaterThanOrEqual(4);
    expect(bounds.maxX).toBeLessThanOrEqual(bounds.width - 5);
    expect(bounds.minY).toBeGreaterThanOrEqual(4);
    expect(bounds.maxY).toBeLessThanOrEqual(bounds.height - 5);
});

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
    expect(await page.locator(".canvas-area").evaluate(el => el.clientHeight)).toBeGreaterThan(0);
    expect(await page.locator(".canvas-controls").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("phone contextual and Settings controls keep 44px targets", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);
    await page.keyboard.press("Control+a");
    const selection = await page.locator("#status-selection").boundingBox();
    expect(selection!.height).toBeGreaterThanOrEqual(44);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    for (const target of [
        page.locator("#hl-opacity"),
        page.locator("#invalid-intensity"),
        page.locator("label:has(#labels-on)"),
        page.locator("label:has(#lock-invalid)"),
    ]) {
        const box = await target.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
    }
});

test("labelled controls grow instead of clipping at doubled text size", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await bootApp(page);
    await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        window.dispatchEvent(new Event("resize"));
    });

    for (const [name, control] of [
        ["Pattern", page.locator("#btn-edit")],
        ["Save", page.locator("#btn-save")],
        ["Fit", page.locator("#view-fit")],
    ] as const) {
        await expect(control).toBeVisible();
        expect(await control.evaluate(el => el.scrollHeight <= el.clientHeight), name).toBe(true);
    }
    expect(await page.locator("#swatch-a").evaluate(swatch => {
        const label = swatch.querySelector(".swatch-label")!.getBoundingClientRect();
        const check = swatch.querySelector(".swatch-check")!.getBoundingClientRect();
        return label.left >= check.right || label.top >= check.bottom;
    }), "Yarn A label and check").toBe(true);
});

test("short landscape keeps canvas and scrollable tools at doubled text size", async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await bootApp(page);
    expect(await page.locator("#authoring-dock").evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
    await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        window.dispatchEvent(new Event("resize"));
    });

    expect(await page.locator(".canvas-area").evaluate(el => el.clientHeight)).toBeGreaterThan(0);
    expect(await page.locator("#authoring-dock").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await page.locator("body").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const canvas = await page.locator(".canvas-area").boundingBox();
    const viewButtons = page.getByRole("group", { name: "Canvas view" }).getByRole("button");
    for (let i = 0; i < await viewButtons.count(); i++) {
        const box = await viewButtons.nth(i).boundingBox();
        expect(box!.y).toBeGreaterThanOrEqual(canvas!.y);
        expect(box!.y + box!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
    }
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
