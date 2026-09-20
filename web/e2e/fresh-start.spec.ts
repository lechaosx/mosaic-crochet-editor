import { test, expect } from "@playwright/test";

async function bootFresh(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
}

test("first load shows About and New creates a pattern in the Pattern inspector", async ({ page }) => {
    await bootFresh(page);

    const about = page.getByRole("dialog", { name: "Mosaic Crochet Editor" });
    await expect(about).toBeVisible();
    await expect(about.getByText("Latest release 20 September 2026")).toBeVisible();
    await expect(about.locator("#about-version")).toHaveCount(0);
    await expect(about.getByRole("heading", { name: "Release notes" })).toBeVisible();
    await expect(about.locator("#about-release-notes")).toContainText("May 2026");
    await expect(about.getByText(`© ${new Date().getFullYear()} Drahomír Dlabaja`)).toBeVisible();
    await expect(about.getByRole("button", { name: "New" })).toBeFocused();
    await expect(about.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(about.getByRole("button", { name: "Example" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBeNull();
    const currentReleaseHash = await about.locator("#about-release-notes").getAttribute("data-current-hash");
    expect(currentReleaseHash).toMatch(/^[a-f0-9]{64}$/);

    await about.getByRole("button", { name: "New" }).click();

    await expect(about).toBeHidden();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-about-release-notes")))
        .toBe(currentReleaseHash);
});

test("canceling the About file picker keeps the dialog available", async ({ page }) => {
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

    await page.getByRole("button", { name: "Open", exact: true }).click();

    await expect(page.getByRole("dialog", { name: "Mosaic Crochet Editor" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBeNull();
});

test("opening an mcw file from About enters the editor", async ({ page }) => {
    await bootFresh(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
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

    await expect(page.locator("#about-dialog")).toBeHidden();
    const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
    expect(recovery.document.state.canvasWidth).toBe(3);
});

test("closing About suppresses it until the latest release changes", async ({ page }) => {
    await bootFresh(page);
    await page.getByRole("button", { name: "Close About" }).click();
    await expect(page.locator("#about-dialog")).toBeHidden();

    await page.reload();
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    await expect(page.locator("#about-dialog")).toBeHidden();

    await page.evaluate(() => localStorage.setItem("mosaic-about-release-notes", "stale-hash"));
    await page.reload();
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    await expect(page.locator("#about-dialog")).toBeVisible();
});

test("About reopens from Settings and light-dismisses", async ({ page }) => {
    await bootFresh(page);
    await page.getByRole("button", { name: "Close About" }).click();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "About Mosaic Crochet Editor" }).click();
    await expect(page.locator("#about-dialog")).toBeVisible();

    await page.mouse.click(4, 4);
    await expect(page.locator("#about-dialog")).toBeHidden();
});

test("legacy browser recovery still shows About for unseen release notes", async ({ page }) => {
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

    await expect(page.locator("#about-dialog")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-pattern-v4"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).not.toBeNull();
});

test("example is editable and demonstrates overlay, mirror, repeat, and Crochet", async ({ page }) => {
    await bootFresh(page);
    await page.getByRole("button", { name: "Example" }).click();

    const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
    expect(recovery.workspace.axes.length).toBeGreaterThan(0);
    expect(recovery.workspace.repeat.enabled).toBe(true);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.locator("#instructions-units")).toContainText("oc");
});

test("About fits a compact viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await bootFresh(page);

    await expect(page.locator("#about-release-notes")).toHaveCSS("overflow-y", "auto");
    expect(await page.locator("#about-release-notes").evaluate(element =>
        element.scrollHeight > element.clientHeight,
    )).toBe(true);
    const releaseNotesBox = await page.locator("#about-release-notes").boundingBox();
    const copyrightBox = await page.getByText(
        `© ${new Date().getFullYear()} Drahomír Dlabaja`,
    ).boundingBox();
    const actionsBox = await page.locator("#about-actions").boundingBox();
    expect(releaseNotesBox).not.toBeNull();
    expect(copyrightBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(actionsBox!.y).toBeGreaterThan(copyrightBox!.y + copyrightBox!.height);

    for (const name of ["New", "Open", "Example"]) {
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
        expect(box!.y + box!.height).toBeLessThanOrEqual(480);
    }
});

test("About caps its height and keeps the Release notes title outside the scroll area", async ({ page }) => {
    await bootFresh(page);

    const card = page.locator(".about-card");
    const title = page.getByRole("heading", { name: "Release notes" });
    const entries = page.locator("#about-release-notes");
    const cardBox = await card.boundingBox();
    const titleBox = await title.boundingBox();
    const entriesBox = await entries.boundingBox();

    expect(cardBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(entriesBox).not.toBeNull();
    expect(cardBox!.height).toBeLessThanOrEqual(672);
    expect(cardBox!.height).toBeLessThan(await page.evaluate(() => innerHeight));
    expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(entriesBox!.y);
    await expect(entries.getByRole("heading", { name: "Release notes" })).toHaveCount(0);
});
