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
    const danger = page.getByLabel("Project danger colour");
    const accent = page.getByLabel("Project accent colour");
    for (const picker of [danger, accent]) {
        expect(await picker.evaluate(element => {
            const style = getComputedStyle(element);
            return style.opacity !== "0" && style.pointerEvents !== "none";
        })).toBe(true);
    }
    await danger.fill("#123456");
    await accent.fill("#abcdef");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document))
        .toMatchObject({ dangerColorOverride: "#123456", accentColorOverride: "#abcdef" });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.locator("#hl-popover");

    await expect(page.locator("#show-guidance")).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "Guidance opacity" })).toHaveAttribute("min", "0");
    await expect(settings.getByLabel("Project danger colour")).toHaveCount(0);
    await expect(settings.getByLabel("Project accent colour")).toHaveCount(0);
    await expect(page.locator("label:has(#lock-invalid)"))
        .toHaveAttribute("title", "Block new marks on cells that cannot host an overlay");
});

test("Pattern colour overrides use app defaults and contrast suggestions stay outside undo", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mosaic-preferences", JSON.stringify({
        version: 1,
        guidanceOpacity: 100,
        dangerColor: "#aa0000",
        accentColor: "#006699",
        labelsVisible: true,
        lockInvalid: true,
    })));
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();

    const danger = page.getByLabel("Project danger colour");
    const accent = page.getByLabel("Project accent colour");
    await expect(danger).toHaveValue("#aa0000");
    await expect(accent).toHaveValue("#006699");

    await danger.fill("#123456");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.dangerColorOverride,
    )).toBe("#123456");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-preferences")!).dangerColor))
        .toBe("#aa0000");

    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(danger).toHaveValue("#123456");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.dangerColorOverride,
    )).toBe("#123456");

    await page.getByRole("button", { name: "Use default danger colour" }).click();
    await expect(danger).toHaveValue("#aa0000");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.dangerColorOverride,
    )).toBeNull();

    const historyBefore = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    );
    await page.getByRole("button", { name: "Find contrasting colors" }).click();
    await expect(danger).toHaveValue("#d32f2f");
    await expect(accent).toHaveValue("#00838f");
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    )).toBe(historyBefore);

    await page.getByRole("button", { name: "Use current contrast colors for new patterns" }).click();
    expect(await page.evaluate(() => {
        const preferences = JSON.parse(localStorage.getItem("mosaic-preferences")!);
        const document = JSON.parse(localStorage.getItem("mosaic-recovery")!).document;
        return {
            danger: preferences.dangerColor,
            accent: preferences.accentColor,
            dangerOverride: document.dangerColorOverride,
            accentOverride: document.accentColorOverride,
        };
    })).toEqual({
        danger: "#d32f2f",
        accent: "#00838f",
        dangerOverride: null,
        accentOverride: null,
    });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "About Mosaic Crochet Editor" }).click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(page.getByLabel("Project danger colour")).toHaveValue("#d32f2f");
    await expect(page.getByLabel("Project accent colour")).toHaveValue("#00838f");
});

test("opening project contrast overrides keeps app defaults and Crochet progress", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await page.locator("#btn-export").click();
    const project = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document);
    const defaults = await page.evaluate(() => localStorage.getItem("mosaic-preferences"));

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "contrast-overrides.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 3,
            ...project,
            axes: [],
            recipes: [],
            dangerColorOverride: "#123456",
            accentColorOverride: "#abcdef",
        })),
    });

    expect(await page.evaluate(() => localStorage.getItem("mosaic-preferences"))).toBe(defaults);
    await expect(page.locator("#btn-export")).toContainText("Continue Crocheting");
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.getByLabel("Project danger colour")).toHaveValue("#123456");
    await expect(page.getByLabel("Project accent colour")).toHaveValue("#abcdef");
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
    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await expect(page.getByText("Select cells and configure", { exact: false })).toHaveCount(0);
    await expect(page.getByText("No axes yet", { exact: false })).toHaveCount(0);
});

test("Crochet omits redundant panel and list headings", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();

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

    await page.locator("#btn-export").click();
    await expect(page.getByRole("status", { name: "Crochet errors" })).toHaveText("2 errors");
    await expect(page.getByLabel("Instruction blockers")).toHaveCount(0);
    await expect(page.getByText(/unresolved|draft|resolve chart/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
});
