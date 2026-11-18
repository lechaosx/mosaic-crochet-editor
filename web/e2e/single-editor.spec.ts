// One window at a time edits and writes the browser records; pages of one
// browser context share an origin's storage and locks, as windows do.
import { test, expect, type Page } from "@playwright/test";
import { addUnlistedProject, bootApp, cellCoord, clickCell, countRecoveryWrites, pixelRGB, storedHistory,
         storedProjectIds } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

async function cellRGB(page: Page, x: number, y: number) {
    const { cx, cy } = await cellCoord(page, x, y);
    return pixelRGB(page, cx, cy);
}

function takeOverOffer(page: Page) {
    return page.getByRole("dialog", { name: "Already open in another window" });
}

async function takeOver(page: Page) {
    await takeOverOffer(page).getByRole("button", { name: "Edit here" }).click();
    await page.waitForFunction(() => !!window.__test_matrix__);
}

test("a second window offers to take over and writes nothing until it does", async ({ page, context }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await addUnlistedProject(page, "closed");
    const projects = await storedProjectIds(page);
    const history = await storedHistory(page);

    const second = await context.newPage();
    const recoveryWrites = await countRecoveryWrites(second);
    await second.goto("/");
    await expect(takeOverOffer(second)).toBeVisible();
    await expect(takeOverOffer(second).getByRole("button", { name: "Edit here" })).toBeFocused();
    await second.keyboard.press("Escape");
    await second.keyboard.press("Escape");
    await expect(takeOverOffer(second)).toBeVisible();

    expect(await recoveryWrites()).toBe(0);
    expect(await storedProjectIds(page)).toEqual(projects);
    expect(await storedHistory(page)).toEqual(history);
});

test("taking over moves editing to the new window with the stored undo history", async ({ page, context }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);

    const second = await context.newPage();
    await second.goto("/");
    await takeOver(second);
    await expect(takeOverOffer(page)).toBeVisible();
    expect(await cellRGB(second, 0, 1)).toEqual(A);

    await second.keyboard.press("p");
    await clickCell(second, 1, 1);
    await second.reload();
    await second.waitForFunction(() => !!window.__test_matrix__);
    expect(await cellRGB(second, 1, 1)).toEqual(A);
    await second.keyboard.press("Control+z");
    expect(await cellRGB(second, 1, 1)).toEqual(B);
    await second.keyboard.press("Control+z");
    expect(await cellRGB(second, 0, 1)).toEqual(B);
    await second.keyboard.press("Control+y");
    await second.keyboard.press("Control+y");

    await takeOver(page);
    await expect(takeOverOffer(second)).toBeVisible();
    expect(await cellRGB(page, 1, 1)).toEqual(A);
    await page.keyboard.press("Control+z");
    expect(await cellRGB(page, 1, 1)).toEqual(B);
});
