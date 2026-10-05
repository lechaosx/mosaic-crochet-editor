import { expect, test } from "@playwright/test";
import { addGlobalMirror, bootApp, clickCell } from "./_helpers";

test("painting does not rewrite unchanged local mirror descriptions", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        const observations: string[] = [];
        (window as typeof window & { descriptions: string[] }).descriptions = observations;
        new MutationObserver(records => observations.push(...records.map(record => record.attributeName!)))
            .observe(document.getElementById("recipe-mirror-controls")!, {
                subtree: true, attributes: true, attributeFilter: ["aria-description", "title"],
            });
    });
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 3, 4);
    expect(await page.evaluate(() => (window as typeof window & { descriptions: string[] }).descriptions)).toEqual([]);
});

test("dimension changes leave unchanged global mirror metadata stable", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: /^Global Mirror:/ }).click();
    await addGlobalMirror(page, "Vertical");
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.evaluate(() => {
        const observations: string[] = [];
        (window as typeof window & { descriptions: string[] }).descriptions = observations;
        new MutationObserver(records => observations.push(...records.map(record => `${(record.target as Element).id}:${record.attributeName}`)))
            .observe(document.getElementById("sym-popover")!, {
                subtree: true, attributes: true,
                attributeFilter: ["aria-description", "aria-label", "title", "data-mirror-id", "hidden"],
            });
    });
    await page.locator("#edit-width").fill("10");
    expect(await page.evaluate(() => (window as typeof window & { descriptions: string[] }).descriptions)).toEqual([]);
});
