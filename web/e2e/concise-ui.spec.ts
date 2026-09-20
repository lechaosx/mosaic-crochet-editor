import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell } from "./_helpers";

test("About and the idle canvas omit redundant guidance and status", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);

    const about = page.getByRole("dialog", { name: "Mosaic Crochet Editor" });
    await expect(about).toBeVisible();
    await expect(page.getByText("Begin with a blank chart", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("status", { name: "Browser recovery" })).toBeHidden();
    await expect(page.getByLabel("Canvas context")).toBeHidden();

    const cell = await cellCoord(page, 1, 1);
    await page.mouse.move(cell.cx, cell.cy);
    await expect(page.getByLabel("Canvas context")).toBeVisible();
    await expect(page.locator("#status-coordinates")).toHaveText("1, 1");
    await expect(page.getByLabel("Canvas context")).not.toContainText("Pencil");
    await expect(page.getByLabel("Canvas context")).not.toContainText("Yarn A");
    await expect(page.getByLabel("Canvas context")).not.toContainText("overlays");
});

test("settings keeps guidance in hover text instead of inline prose", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();

    await expect(page.getByText("Show ✕ overlays", { exact: false })).toHaveCount(0);
    await expect(page.getByText("New impossible marks", { exact: false })).toHaveCount(0);
    await expect(page.locator("label:has(#show-guidance)"))
        .toHaveAttribute("title", "Show overlays and invalid-placement marks");
    await expect(page.locator("label:has(#lock-invalid)"))
        .toHaveAttribute("title", "Block new marks on cells that cannot host an overlay");
});

test("contextual inspectors rely on controls and hover text", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: /selected/ }).click();
    await expect(page.getByText("Deselect places", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Nothing copied yet", { exact: false })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
    await expect(page.getByText("Select cells and configure", { exact: false })).toHaveCount(0);
    await expect(page.getByText("No axes yet", { exact: false })).toHaveCount(0);
});

test("Crochet presents controls and instructions as distinct groups without an introduction", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();

    await expect(page.getByRole("group", { name: "Crochet options" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instructions", level: 2 })).toBeVisible();
    await expect(page.getByText("Chart-derived work in crochet order.", { exact: false })).toHaveCount(0);
});

test("Crochet summarizes errors without prose or navigation", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 0);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("status", { name: "Crochet errors" })).toHaveText("2 errors");
    await expect(page.getByLabel("Instruction blockers")).toHaveCount(0);
    await expect(page.getByText(/unresolved|draft|resolve chart/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done with Row 1" })).toBeEnabled();
});
