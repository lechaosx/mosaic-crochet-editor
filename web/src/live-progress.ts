import type { InstructionOverviewUnit } from "./ui";

const LIVE_PROGRESS_KEY = "mosaic-live-progress";
const LIVE_PROGRESS_VERSION = 1;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

interface LiveProgressRecord {
    version: 1;
    fingerprint: string;
    completedUnits: number;
}

export function fingerprintInstructionPlan(units: readonly InstructionOverviewUnit[]): string {
    const bytes = new TextEncoder().encode(JSON.stringify(units));
    let hash = FNV_OFFSET;
    for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * FNV_PRIME);
    }
    return hash.toString(16).padStart(16, "0");
}

export function loadLiveProgress(fingerprint: string, totalUnits: number): number {
    try {
        const raw = localStorage.getItem(LIVE_PROGRESS_KEY);
        if (raw === null) return 0;
        const value = JSON.parse(raw) as Partial<LiveProgressRecord>;
        if (value.version !== LIVE_PROGRESS_VERSION
            || typeof value.fingerprint !== "string"
            || !Number.isInteger(value.completedUnits)
            || value.completedUnits! < 0
            || value.completedUnits! > totalUnits) {
            localStorage.removeItem(LIVE_PROGRESS_KEY);
            return 0;
        }
        return value.fingerprint === fingerprint ? value.completedUnits! : 0;
    } catch {
        localStorage.removeItem(LIVE_PROGRESS_KEY);
        return 0;
    }
}

export function saveLiveProgress(fingerprint: string, completedUnits: number): boolean {
    if (!Number.isInteger(completedUnits) || completedUnits < 0) return false;
    try {
        const value: LiveProgressRecord = {
            version: LIVE_PROGRESS_VERSION,
            fingerprint,
            completedUnits,
        };
        localStorage.setItem(LIVE_PROGRESS_KEY, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}
