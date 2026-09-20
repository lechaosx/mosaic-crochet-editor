import type { PatternState } from "@mosaic/logic/types";

const LIVE_PROGRESS_KEY = "mosaic-live-progress";
const LIVE_PROGRESS_VERSION = 2;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

interface LiveProgressRecord {
    version: 2;
    fingerprint: string;
    completedUnits: number;
}

function fingerprint(bytes: Uint8Array, initial = FNV_OFFSET): bigint {
    let hash = initial;
    for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = BigInt.asUintN(64, hash * FNV_PRIME);
    }
    return hash;
}

function fingerprintString(value: string): bigint {
    return fingerprint(new TextEncoder().encode(value));
}

export function fingerprintPatternShape(pattern: PatternState): string {
    return fingerprintString(JSON.stringify(pattern)).toString(16).padStart(16, "0");
}

export function fingerprintPattern(pattern: PatternState, pixels: Uint8Array): string {
    let hash = fingerprintString(JSON.stringify(pattern));
    hash = fingerprint(new Uint8Array([0]), hash);
    hash = fingerprint(pixels, hash);
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
        if (value.fingerprint !== fingerprint) {
            localStorage.removeItem(LIVE_PROGRESS_KEY);
            return 0;
        }
        return value.completedUnits!;
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
