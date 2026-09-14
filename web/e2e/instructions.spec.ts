import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("Instructions Overview focuses work units and returning preserves Design", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Instructions" }).click();
    await expect(page.getByRole("main", { name: "Instructions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeFocused();
    await expect(page.locator(".canvas-area")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();
    await expect(page.getByRole("img", { name: "Finished chart preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Row 1, Yarn B" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Row 2, Yarn A" }).click();
    await expect(page.getByRole("button", { name: "Row 2, Yarn A" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status", { name: "Preview focus" })).toContainText("Showing Row 2 path");

    await page.getByRole("tab", { name: "Text" }).click();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Live" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Text" }).click();
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

test("Instructions tab navigation does not move selected Design content", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.keyboard.press("Control+a");

    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Text" }).click();
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("button", { name: "Back to Design" }).click();
    await page.keyboard.press("Escape");

    const original = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, original.cx, original.cy)).toEqual([0, 0, 0]);
});

test("Instructions links blockers and labels unresolved text as a draft", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);

    await page.getByRole("button", { name: "Instructions" }).click();
    await expect(page.getByText("Draft — 1 unresolved overlay position")).toBeVisible();
    const issue = page.getByRole("button", { name: "Focus unresolved overlay at 0, 0" });
    await expect(issue).toBeVisible();
    await issue.click();
    await expect(page.getByRole("status", { name: "Preview focus" })).toContainText("Showing issue at 0, 0");

    await page.getByRole("tab", { name: "Text" }).click();
    await expect(page.getByRole("textbox", { name: "Compressed instructions" }))
        .toHaveValue(/Unresolved overlay at \(0, 0\)/);
});

test("Live advances by whole rows and resumes the exact instruction plan", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Instructions" }).click();
    const liveTab = page.getByRole("tab", { name: "Live" });
    await expect(liveTab).toBeEnabled();
    await liveTab.click();
    await expect(page.getByRole("heading", { name: "Row 1" })).toBeVisible();
    await expect(page.getByText("Yarn B", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back one row" })).toBeDisabled();

    await page.getByRole("button", { name: "Done with Row 1" }).click();
    await expect(page.getByRole("heading", { name: "Row 2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back one row" })).toBeEnabled();

    await page.getByRole("button", { name: "Back to Design" }).click();
    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Live" }).click();
    await expect(page.getByRole("heading", { name: "Row 2" })).toBeVisible();

    await page.getByRole("button", { name: "Back to Design" }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Live" }).click();
    await expect(page.getByRole("heading", { name: "Row 1" })).toBeVisible();
});

test("Live is unavailable while instruction blockers remain", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);

    await page.getByRole("button", { name: "Instructions" }).click();
    await expect(page.getByRole("tab", { name: "Live" })).toBeDisabled();
    await expect(page.getByText("Resolve chart issues to use Live.")).toBeVisible();
});

test("Live reports when its progress cannot be saved locally", async ({ page }) => {
    await page.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === "mosaic-live-progress") {
                throw new DOMException("full", "QuotaExceededError");
            }
            return setItem.call(this, key, value);
        };
    });
    await bootApp(page);

    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Live" }).click();
    await page.getByRole("button", { name: "Done with Row 1" }).click();

    await expect(page.getByRole("alert"))
        .toHaveText("Progress could not be saved locally. Keep this tab open to retain your place.");
    await page.getByRole("button", { name: "Back to Design" }).click();
    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Live" }).click();
    await expect(page.getByRole("heading", { name: "Row 1" })).toBeVisible();
});

test("Live completes and reopens a Centre-out round as one boundary", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByLabel("Rounds").fill("1");
    await page.getByRole("button", { name: "Apply" }).click();

    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Live" }).click();
    const live = page.getByRole("tabpanel", { name: "Live" });
    await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
    await expect(live.getByText("Yarn A", { exact: true })).toBeVisible();
    const back = page.getByRole("button", { name: "Back one round" });
    await expect(back).toBeDisabled();

    await page.getByRole("button", { name: "Done with Round 1" }).click();
    await expect(page.getByRole("heading", { name: "Pattern complete" })).toBeFocused();
    await expect(live.getByRole("status")).toContainText("1 of 1 complete");
    await expect(back).toBeEnabled();
    await expect(page.getByRole("button", { name: /Done with/ })).toBeHidden();

    await back.click();
    await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
});

test("Text reports copy and download completion", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async () => undefined },
        });
    });
    await bootApp(page);
    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Text" }).click();
    const status = page.getByRole("status", { name: "Text actions" });

    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(status).toHaveText("Instructions copied.");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download text" }).click();
    await expect((await download).suggestedFilename()).toBe("pattern.txt");
    await expect(status).toHaveText("Downloaded pattern.txt.");
});

test("Text reports clipboard failure", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } },
        });
    });
    await bootApp(page);
    await page.getByRole("button", { name: "Instructions" }).click();
    await page.getByRole("tab", { name: "Text" }).click();

    await page.getByRole("button", { name: "Copy text" }).click();
    await expect(page.getByRole("status", { name: "Text actions" }))
        .toHaveText("Could not copy instructions.");
});
