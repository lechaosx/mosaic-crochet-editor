import type { PatternState } from "@mosaic/logic/types";

// One record per open project, under this prefix and the project id.
const LIVE_PROGRESS_PREFIX = "mosaic-live-progress:";
const LIVE_PROGRESS_VERSION = 2;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

interface LiveProgressRecord {
    version: 2;
    fingerprint: string;
    completedUnits: number;
}

function readLiveProgress(project: string, fingerprint: string, totalUnits: number): number | null {
    const key = LIVE_PROGRESS_PREFIX + project;
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        const value = JSON.parse(raw) as Partial<LiveProgressRecord>;
        if (value.version !== LIVE_PROGRESS_VERSION
            || typeof value.fingerprint !== "string"
            || !Number.isInteger(value.completedUnits)
            || value.completedUnits! < 0) {
            localStorage.removeItem(key);
            return null;
        }
        if (value.fingerprint !== fingerprint) return null;
        if (value.completedUnits! > totalUnits) {
            localStorage.removeItem(key);
            return null;
        }
        return value.completedUnits!;
    } catch {
        localStorage.removeItem(key);
        return null;
    }
}

function fingerprint(bytes: Uint8Array): bigint {
    let hash = FNV_OFFSET;
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

// Two 32-bit lanes over four pixels at a time: a whole-chart BigInt hash is
// too slow for millions of pixels. Each step is a bijection of the lane for a
// given word, so pixels differing in one word always differ in fingerprint.
function fingerprintPixels(pixels: Uint8Array): string {
    const aligned = pixels.byteOffset % 4 === 0 ? pixels : pixels.slice();
    const words = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.length >> 2);
    let a = 0x811c9dc5, b = 0x9e3779b9;
    const mix = (word: number) => {
        a = Math.imul(a ^ word, 0x01000193);
        a = a << 13 | a >>> 19;
        b = Math.imul(b ^ word, 0x85ebca6b);
        b = b << 17 | b >>> 15;
    };
    for (let i = 0; i < words.length; i++) mix(words[i]);
    for (let i = words.length * 4; i < aligned.length; i++) mix(aligned[i]);
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintPattern(pattern: PatternState, pixels: Uint8Array): string {
    return fingerprintPatternShape(pattern) + fingerprintPixels(pixels);
}

export function loadLiveProgress(project: string, fingerprint: string, totalUnits: number): number {
    return readLiveProgress(project, fingerprint, totalUnits) ?? 0;
}

export function hasLiveProgress(project: string, fingerprint: string, totalUnits: number): boolean {
    return (readLiveProgress(project, fingerprint, totalUnits) ?? 0) > 0;
}

export function clearLiveProgress(project: string): void {
    try {
        localStorage.removeItem(LIVE_PROGRESS_PREFIX + project);
    } catch {
        // Progress is optional when browser storage is unavailable.
    }
}

export function deleteLiveProgressExcept(projects: readonly string[]): void {
    try {
        const kept = new Set(projects.map(project => LIVE_PROGRESS_PREFIX + project));
        const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
        const stale = keys.filter(key => key.startsWith(LIVE_PROGRESS_PREFIX) && !kept.has(key));
        for (const key of stale) localStorage.removeItem(key);
    } catch {
        // Progress is optional when browser storage is unavailable.
    }
}

export function saveLiveProgress(project: string, fingerprint: string, completedUnits: number): boolean {
    if (!Number.isInteger(completedUnits) || completedUnits < 0) return false;
    try {
        const value: LiveProgressRecord = {
            version: LIVE_PROGRESS_VERSION,
            fingerprint,
            completedUnits,
        };
        localStorage.setItem(LIVE_PROGRESS_PREFIX + project, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}
