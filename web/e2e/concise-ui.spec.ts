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

test("Pattern owns all colour editing while Settings keeps non-colour preferences", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();

    await expect(page.getByLabel("Yarn A colour")).toHaveValue("#000000");
    await expect(page.getByLabel("Yarn B colour")).toHaveValue("#ffffff");
    await expect(page.getByRole("button", { name: "Swap yarn colours" })).toBeVisible();
    await expect(page.locator("#edit-yarn")).toHaveCount(0);
    const danger = page.getByLabel("Danger colour");
    const accent = page.getByLabel("Accent colour");
    for (const picker of [danger, accent]) {
        expect(await picker.evaluate(element => {
            const style = getComputedStyle(element);
            return style.opacity !== "0" && style.pointerEvents !== "none";
        })).toBe(true);
    }
    await danger.fill("#123456");
    await accent.fill("#abcdef");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-preferences")!)))
        .toMatchObject({ dangerColor: "#123456", accentColor: "#abcdef" });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.locator("#hl-popover");

    await expect(page.locator("#show-guidance")).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "Guidance opacity" })).toHaveAttribute("min", "0");
    await expect(settings.getByLabel("Danger colour")).toHaveCount(0);
    await expect(settings.getByLabel("Accent colour")).toHaveCount(0);
    await expect(page.locator("label:has(#lock-invalid)"))
        .toHaveAttribute("title", "Block new marks on cells that cannot host an overlay");
});

test("app preferences survive reload and are not part of undo or recovery snapshots", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const opacity = page.getByRole("slider", { name: "Guidance opacity" });
    await opacity.fill("37");
    await page.keyboard.press("Escape");

    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await page.evaluate(() => {
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return { preferences: recovery.preferences, stored: localStorage.getItem("mosaic-preferences") };
    })).toEqual({
        preferences: undefined,
        stored: JSON.stringify({
            version: 1,
            guidanceOpacity: 37,
            dangerColor: "#ff7474",
            accentColor: "#d653a3",
            labelsVisible: true,
            lockInvalid: true,
        }),
    });

    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("slider", { name: "Guidance opacity" })).toHaveValue("37");
});

test("status is passive and Selection actions live in the authoring dock", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");

    const status = page.getByLabel("Canvas context");
    await expect(status.getByRole("button")).toHaveCount(0);
    const selection = page.getByRole("button", { name: /Selection actions/ });
    await expect(selection).toContainText("81");
    await selection.click();
    await expect(page.getByRole("group", { name: "Move outcome" })).toBeVisible();
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

test("Crochet omits redundant panel and list headings", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();

    await expect(page.getByRole("group", { name: "Crochet options" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Crochet" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Instructions" })).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
});
