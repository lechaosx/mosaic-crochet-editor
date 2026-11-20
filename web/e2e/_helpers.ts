// E2E helpers. All cell-relative actions go through `window.__test_matrix__`
// (exposed by `render.ts` per frame) so view state — pan/zoom/rotation —
// doesn't leak into tests.

import { Page } from "@playwright/test";

export async function addGlobalMirror(page: Page, type: string) {
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: type, exact: true }).click();
}

export async function chooseToolVariant(page: Page, family: string, variant: string) {
    await page.locator(`#tool-${family === "Rectangle" ? "select" : family === "Wand" ? "wand" : family === "Move" ? "move" : "overlay"}`).press("ArrowDown");
    await page.getByRole("menu", { name: `${family} variants`, exact: true })
        .getByRole("menuitemradio", { name: variant, exact: true }).click();
}

export async function selectionHandleCoords(page: Page): Promise<{ cx: number; cy: number }[]> {
    await page.evaluate(() => {
        const target = window as unknown as { selectionGrips?: { cx: number; cy: number }[] };
        if (target.selectionGrips) return;
        target.selectionGrips = [];
        // The renderer sets the test matrix once per frame, before drawing any grip.
        let current = window.__test_matrix__;
        Object.defineProperty(window, "__test_matrix__", { configurable: true, get: () => current, set(value) {
            current = value; target.selectionGrips = [];
        } });
        const proto = CanvasRenderingContext2D.prototype, arc = proto.arc;
        proto.arc = function (x, y, radius, start, end, ccw) {
            const matrix = this.getTransform(), scale = Math.hypot(matrix.a, matrix.b) / devicePixelRatio;
            if (this.canvas.id === "canvas" && radius * scale >= 8) {
                const point = matrix.transformPoint({ x, y }), bounds = this.canvas.getBoundingClientRect();
                target.selectionGrips!.push({ cx: point.x / devicePixelRatio + bounds.left, cy: point.y / devicePixelRatio + bounds.top });
            }
            arc.call(this, x, y, radius, start, end, ccw);
        };
    });
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    return page.evaluate(() => (window as unknown as { selectionGrips: { cx: number; cy: number }[] }).selectionGrips);
}

declare global {
    interface Window {
        __test_matrix__?: DOMMatrix;
        __test_instruction_seam_geometry__?: {
            edges: number[][];
            triangle: number[][];
            screenTriangle: number[][];
            outline: number[][];
        } | null;
        __test_instruction_yields__?: readonly { index: number; recomputed: boolean }[];
        __test_on_instruction_yield__?: (yielded: { index: number; recomputed: boolean }) => void;
    }
}

// CSS-px coord of cell (x, y)'s centre on the rendered canvas.
export async function cellCoord(page: Page, x: number, y: number): Promise<{ cx: number; cy: number }> {
    await page.waitForFunction(() => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        return canvas.width === Math.max(1, Math.round(canvas.clientWidth * dpr))
            && canvas.height === Math.max(1, Math.round(canvas.clientHeight * dpr));
    });
    return page.evaluate(({ x, y }) => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const m = window.__test_matrix__;
        if (!m) throw new Error("test matrix hook missing");
        const cx = m.a * (x + 0.5) + m.c * (y + 0.5) + m.e;
        const cy = m.b * (x + 0.5) + m.d * (y + 0.5) + m.f;
        const dpr = window.devicePixelRatio || 1;
        return { cx: cx / dpr + rect.left, cy: cy / dpr + rect.top };
    }, { x, y });
}

// The chart as displayed, as RGBA rows of `rect` (default: all of it) in
// device pixels of `#canvas`: the WebGL layer with the Canvas 2D overlay on
// top. Every chart pixel assertion reads through these helpers, so specs
// don't depend on how the chart's layers are drawn.
export async function chartPixels(page: Page, rect?: { x: number; y: number; width: number; height: number }) {
    const { width, height, base64 } = await page.evaluate(rect => {
        const overlay = document.getElementById("canvas") as HTMLCanvasElement;
        const { x, y, width, height } = rect ?? { x: 0, y: 0, width: overlay.width, height: overlay.height };
        const composite = document.createElement("canvas");
        composite.width = width;
        composite.height = height;
        const context = composite.getContext("2d", { willReadFrequently: true })!;
        // A presented WebGL frame is no longer readable; repaint it in this task.
        (window as typeof window & { __test_repaint_chart__?: (x: number, y: number, width: number, height: number) => void })
            .__test_repaint_chart__?.(x, y, width, height);
        for (const layer of [document.getElementById("chart-gl") as HTMLCanvasElement, overlay]) {
            context.drawImage(layer, x, y, width, height, 0, 0, width, height);
        }
        const data = context.getImageData(0, 0, width, height).data;
        // Base64 crosses the protocol far faster than a whole-canvas array.
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return { width, height, base64: btoa(binary) };
    }, rect);
    return { width, height, data: Uint8Array.from(atob(base64), char => char.charCodeAt(0)) };
}

// [r, g, b, a] of the chart's device pixel (x, y).
export async function chartPixel(page: Page, x: number, y: number): Promise<number[]> {
    return Array.from((await chartPixels(page, { x, y, width: 1, height: 1 })).data);
}

// [r, g, b] of the chart pixel at CSS-px (cx, cy).
export async function pixelRGB(page: Page, cx: number, cy: number): Promise<[number, number, number]> {
    const { x, y } = await page.locator("#canvas").evaluate((canvas, { cx, cy }) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        return { x: Math.round((cx - rect.left) * dpr), y: Math.round((cy - rect.top) * dpr) };
    }, { cx, cy });
    const [r, g, b] = await chartPixel(page, x, y);
    return [r, g, b];
}

// `page.mouse.click` doesn't accept modifiers — we wrap with explicit
// keyboard down/up so callers can simulate Shift / Ctrl / Alt chord clicks.
export async function clickCell(
    page: Page, x: number, y: number,
    opts: Parameters<Page["mouse"]["click"]>[2] & { modifiers?: ("Shift" | "Control" | "Alt")[] } = {},
) {
    const { cx, cy } = await cellCoord(page, x, y);
    const { modifiers = [], ...mouseOpts } = opts;
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.click(cx, cy, mouseOpts);
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m);
}

// Drag from cell (sx,sy) to (ex,ey) with interpolated steps so the gesture
// state machine sees real pointermove events.
export async function dragCells(page: Page, sx: number, sy: number, ex: number, ey: number, mods: ("Shift" | "Control" | "Alt")[] = []) {
    const a = await cellCoord(page, sx, sy);
    const b = await cellCoord(page, ex, ey);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.down();
    await page.mouse.move(b.cx, b.cy, { steps: 10 });
    await page.mouse.up();
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
}

export async function touchDragCells(page: Page, sx: number, sy: number, ex: number, ey: number) {
    const a = await cellCoord(page, sx, sy);
    const b = await cellCoord(page, ex, ey);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: a.cx, y: a.cy, id: 0 }],
    });
    for (let i = 1; i <= 10; i++) {
        await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{
                x: a.cx + (b.cx - a.cx) * i / 10,
                y: a.cy + (b.cy - a.cy) * i / 10,
                id: 0,
            }],
        });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
}

export async function touchPanZoom(
    page: Page,
    start: [{ cx: number; cy: number }, { cx: number; cy: number }],
    end: [{ cx: number; cy: number }, { cx: number; cy: number }],
) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: start.map((p, id) => ({ x: p.cx, y: p.cy, id })),
    });
    await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: end.map((p, id) => ({ x: p.cx, y: p.cy, id })),
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
}

export async function bootApp(page: Page) {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__test_matrix__);
    if (await page.locator("#about-dialog").isVisible()) {
        await page.locator("#about-new").evaluate((button: HTMLButtonElement) => button.click());
        await page.locator("#about-dialog").waitFor({ state: "hidden" });
        await page.keyboard.press("Escape");
    }
}

// The helpers below keep the storage layout of the recovery, undo history and
// Crochet progress records out of the specs that observe them. Project records
// live in IndexedDB under the active project's id from the localStorage index.

// Records in the project database: by project id for "recovery" and "history",
// and by [project id, snapshot id] for "snapshots". Null when the app hasn't
// created the database. A read transaction runs after every write transaction
// created before it, so this sees each write the app has already issued.
function projectDatabase(page: Page): Promise<any> {
    return page.evaluate(async () => {
        if (!(await indexedDB.databases()).some(database => database.name === "mosaic-projects")) return null;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("mosaic-projects");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const transaction = database.transaction(["recovery", "history", "snapshots"], "readonly");
                const requests = ["recovery", "history", "snapshots"].map(name => {
                    const store = transaction.objectStore(name);
                    return [name, store.getAllKeys(), store.getAll()] as const;
                });
                transaction.oncomplete = () => resolve(Object.fromEntries(requests.map(([name, keys, values]) =>
                    [name, keys.result.map((key, i) => ({ key, value: values.result[i] }))])));
                transaction.onerror = () => reject(transaction.error);
            });
        } finally {
            database.close();
        }
    });
}

export function activeProjectId(page: Page): Promise<string> {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-projects")!).active);
}

async function storedProject(page: Page) {
    const [records, project] = await Promise.all([projectDatabase(page), activeProjectId(page)]);
    const value = (name: string) => records?.[name].find((record: any) => record.key === project)?.value ?? null;
    const snapshots = new Map((records?.snapshots ?? [])
        .filter((record: any) => record.key[0] === project)
        .map((record: any) => [record.key[1], record.value]));
    return { recovery: value("recovery"), history: value("history"), snapshots };
}

export async function storedRecovery(page: Page) {
    return (await storedProject(page)).recovery;
}

// The stored undo snapshots in order and the current index, or null.
export async function storedHistory(page: Page) {
    const { history, snapshots } = await storedProject(page);
    return history && { snapshots: history.ids.map((id: number) => snapshots.get(id)), index: history.index };
}

// Number of stored snapshot records, including any the history no longer lists.
export async function storedHistoryLength(page: Page): Promise<number> {
    return (await storedProject(page)).snapshots.size;
}

// Whether the stored history's current snapshot is the one last saved, or that
// a new, opened or example project started from.
export async function storedHistoryIsClean(page: Page): Promise<boolean> {
    const { history } = await storedProject(page);
    return history.cleanId === history.ids[history.index];
}

// Ids of every project with records in the project database.
export async function storedProjectIds(page: Page): Promise<string[]> {
    const records = await projectDatabase(page);
    return [...new Set(["recovery", "history", "snapshots"].flatMap(name =>
        records[name].map(({ key }: { key: IDBValidKey }) => Array.isArray(key) ? key[0] : key)))].sort();
}

// Deletes the recovery record of project `id`, as when its write never landed.
export function deleteStoredRecovery(page: Page, id: string) {
    return page.evaluate(async id => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("mosaic-projects");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
            const transaction = database.transaction("recovery", "readwrite");
            transaction.objectStore("recovery").delete(id);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        database.close();
    }, id);
}

// Stores records of a project the index doesn't list, as a closed project leaves.
export function addUnlistedProject(page: Page, id: string) {
    return page.evaluate(async id => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("mosaic-projects");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(["recovery", "history", "snapshots"], "readwrite");
            transaction.objectStore("recovery").put({}, id);
            transaction.objectStore("history").put({}, id);
            transaction.objectStore("snapshots").put({}, [id, 0]);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
        database.close();
    }, id);
}

export async function storedLiveProgress(page: Page) {
    const project = await activeProjectId(page);
    return page.evaluate(key => {
        const raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
    }, `mosaic-live-progress:${project}`);
}

// From the next navigation on, every write to the project database store
// `name` fails as when storage is full.
function failStoreWrites(page: Page, name: string) {
    return page.addInitScript(name => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
            const request = put.apply(this, args);
            if (this.name === name) this.transaction.abort();
            return request;
        };
    }, name);
}

export function failRecoveryWrites(page: Page) {
    return failStoreWrites(page, "recovery");
}

// From the next navigation on, the returned function makes the next write of
// undo history metadata fail as when storage is full.
export async function failNextHistoryWrite(page: Page): Promise<() => Promise<void>> {
    await page.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
            const request = put.apply(this, args);
            const target = window as typeof window & { __failNextHistoryWrite?: boolean };
            if (this.name === "history" && target.__failNextHistoryWrite) {
                target.__failNextHistoryWrite = false;
                this.transaction.abort();
            }
            return request;
        };
    });
    return () => page.evaluate(() => { (window as typeof window & { __failNextHistoryWrite?: boolean }).__failNextHistoryWrite = true; });
}

// From the next navigation on, the project index is missing and can't be stored.
export function loseProjectIndex(page: Page) {
    return page.addInitScript(() => {
        localStorage.removeItem("mosaic-projects");
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === "mosaic-projects") throw new DOMException("full", "QuotaExceededError");
            return setItem.call(this, key, value);
        };
    });
}

// Opens the project database at a newer version, as a newer build of the app
// in another tab would. Resolves to whether the open proceeded rather than
// being blocked by this page's connection.
export function upgradeProjectDatabase(page: Page): Promise<boolean> {
    return page.evaluate(() => new Promise<boolean>(resolve => {
        const request = indexedDB.open("mosaic-projects", 2);
        request.onblocked = () => resolve(false);
        request.onsuccess = () => { request.result.close(); resolve(true); };
    }));
}

// From the next navigation on, the project database can't be opened, as in
// browsers that deny IndexedDB.
export function blockProjectDatabase(page: Page) {
    return page.addInitScript(() => {
        IDBFactory.prototype.open = () => { throw new DOMException("denied", "SecurityError"); };
    });
}

// From the next navigation on, writing Crochet progress throws as when storage is full.
export function failLiveProgressWrites(page: Page) {
    return page.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith("mosaic-live-progress:")) throw new DOMException("full", "QuotaExceededError");
            return setItem.call(this, key, value);
        };
    });
}

// From the next navigation on, counts recovery writes since that page load.
// Returns a reader for the current count.
export async function countRecoveryWrites(page: Page): Promise<() => Promise<number>> {
    await page.addInitScript(() => {
        const put = IDBObjectStore.prototype.put;
        let writes = 0;
        IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
            if (this.name === "recovery") writes++;
            return put.apply(this, args);
        };
        Object.defineProperty(window, "__recoveryWriteCount", { get: () => writes });
    });
    return () => page.evaluate(() => (window as typeof window & { __recoveryWriteCount: number }).__recoveryWriteCount);
}
