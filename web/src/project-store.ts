// Browser records of the open projects. A localStorage index lists them; each
// project's recovery record and undo history live in IndexedDB under its id.
// Writes don't wait: each creates its transaction at once, and IndexedDB runs
// transactions over the same stores in creation order.

import type { SessionState } from "@mosaic/logic/store";
import { recoveryRecord } from "./storage-io";
import type { HistoryMeta, Snapshot } from "./history";

const INDEX_KEY     = "mosaic-projects";
const INDEX_VERSION = 2;
const DATABASE      = "mosaic-projects";
// Records of the earlier single-session storage, discarded rather than migrated.
const RETIRED_KEYS  = ["mosaic-recovery", "mosaic-pattern-v4", "mosaic-history", "mosaic-history-v4", "mosaic-live-progress"];
// "recovery" and "history" are keyed by project id, "snapshots" by [project id, snapshot id].
const STORES        = ["recovery", "history", "snapshots"];

export interface OpenEntry {
    id:    string;
    title: string;
}

export interface ProjectIndex {
    // In tab order.
    open:   OpenEntry[];
    // Null exactly when no project is open.
    active: string | null;
}

export interface StoredProject {
    recovery:  unknown;
    history:   unknown;
    snapshots: unknown[];
}

export function removeRetiredRecords(): void {
    for (const key of RETIRED_KEYS) localStorage.removeItem(key);
}

export function newProjectId(): string {
    // `crypto.randomUUID` exists only in secure contexts.
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

function isOpenEntry(value: unknown): value is OpenEntry {
    return typeof value === "object" && value !== null
        && typeof (value as OpenEntry).id === "string" && typeof (value as OpenEntry).title === "string";
}

// Null when no valid index is stored.
export function loadProjectIndex(): ProjectIndex | null {
    try {
        const value = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "null");
        if (value?.version === INDEX_VERSION && Array.isArray(value.open) && value.open.every(isOpenEntry)
            && (value.open.length === 0 ? value.active === null : value.open.some((entry: OpenEntry) => entry.id === value.active))) {
            return { open: value.open.map(({ id, title }: OpenEntry) => ({ id, title })), active: value.active };
        }
    } catch {
        // A malformed index lists no projects.
    }
    return null;
}

// False when the index can't be stored.
export function saveProjectIndex(open: readonly OpenEntry[], active: string | null): boolean {
    try {
        localStorage.setItem(INDEX_KEY, JSON.stringify({ version: INDEX_VERSION, open, active }));
        return true;
    } catch {
        return false;
    }
}

// Null when the browser denies IndexedDB or another tab's connection blocks
// the upgrade. The connection closes when another tab's newer app version
// upgrades the database, so this tab never blocks it; later writes then fail.
export function openProjectDatabase(): Promise<IDBDatabase | null> {
    return new Promise(resolve => {
        let blocked = false;
        try {
            const request = indexedDB.open(DATABASE, 1);
            request.onupgradeneeded = () => {
                for (const name of STORES) request.result.createObjectStore(name);
            };
            request.onblocked = () => {
                blocked = true;
                resolve(null);
            };
            request.onsuccess = () => {
                const database = request.result;
                if (blocked) {
                    database.close();
                    return;
                }
                database.onversionchange = () => database.close();
                resolve(database);
            };
            request.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

function snapshotKeys(project: string): IDBKeyRange {
    // Arrays sort after numbers, so this spans every [project, snapshot id].
    return IDBKeyRange.bound([project], [project, []]);
}

// Null when the records can't be read.
export function readProject(database: IDBDatabase, project: string): Promise<StoredProject | null> {
    return new Promise(resolve => {
        try {
            const transaction = database.transaction(STORES, "readonly");
            const recovery = transaction.objectStore("recovery").get(project);
            const history = transaction.objectStore("history").get(project);
            const snapshots = transaction.objectStore("snapshots").getAll(snapshotKeys(project));
            transaction.oncomplete = () => resolve({ recovery: recovery.result, history: history.result, snapshots: snapshots.result });
            transaction.onabort = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export function deleteProjectsExcept(database: IDBDatabase, projects: readonly string[]): void {
    try {
        const transaction = database.transaction(STORES, "readwrite");
        for (const name of STORES) {
            const store = transaction.objectStore(name);
            const keys = store.getAllKeys();
            keys.onsuccess = () => {
                for (const key of keys.result) {
                    if (!projects.includes(Array.isArray(key) ? key[0] as string : key as string)) store.delete(key);
                }
            };
        }
    } catch {
        // Unreachable records are deleted at a later boot.
    }
}

// `done` reports whether the write was stored. Committing at once lets a
// write issued just before the page unloads still land.
function write(database: IDBDatabase, stores: string[], done: (stored: boolean) => void,
               fill: (transaction: IDBTransaction) => void): void {
    let transaction: IDBTransaction;
    try {
        transaction = database.transaction(stores, "readwrite");
    } catch {
        done(false);
        return;
    }
    transaction.oncomplete = () => done(true);
    transaction.onabort = () => done(false);
    try {
        fill(transaction);
        transaction.commit();
    } catch {
        try {
            transaction.abort();
        } catch {
            // Already aborted, which reported the failure.
        }
    }
}

export function writeRecovery(database: IDBDatabase, project: string, s: Readonly<SessionState>, done: (stored: boolean) => void): void {
    write(database, ["recovery"], done, transaction => transaction.objectStore("recovery").put(recoveryRecord(s), project));
}

// Stores `put` and `meta`, and deletes the project's snapshots `meta` doesn't
// list: as listed ids increase, those lie in the gaps around them.
export function writeHistory(database: IDBDatabase, project: string, { meta, put }: { meta: HistoryMeta; put: Snapshot[] },
                             done: (stored: boolean) => void): void {
    write(database, ["history", "snapshots"], done, transaction => {
        const snapshots = transaction.objectStore("snapshots");
        const bounds = [-Infinity, ...meta.ids, Infinity];
        for (let i = 1; i < bounds.length; i++) {
            if (bounds[i] - bounds[i - 1] > 1) {
                snapshots.delete(IDBKeyRange.bound([project, bounds[i - 1]], [project, bounds[i]], true, true));
            }
        }
        for (const snapshot of put) snapshots.put(snapshot, [project, snapshot.id]);
        transaction.objectStore("history").put(meta, project);
    });
}
