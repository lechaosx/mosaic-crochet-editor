import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("Instructions Overview focuses work units and returning preserves Design", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Instructions" }).click();
    await expect(page.getByRole("main", { name: "Instructions" })).toBeVisible();
    await expect(page.locator(".canvas-area")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();
    await expect(page.getByRole("img", { name: "Finished chart preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Row 1, Yarn B" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Row 2, Yarn A" }).click();
    await expect(page.getByRole("button", { name: "Row 2, Yarn A" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status", { name: "Preview focus" })).toContainText("Showing Row 2 path");

    await page.getByRole("tab", { name: "Text" }).click();
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
