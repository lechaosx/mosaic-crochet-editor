export interface InstructionUnitSignature {
    label: string;
    yarn: "A" | "B";
    contentKey: string;
    invalidWorkedCoords: readonly number[];
    startDirection: readonly number[];
    reversedStartDirection: readonly number[];
}

export interface CachedInstructionUnit extends InstructionUnitSignature {
    text: string;
    reversedText: string;
    workedCoords: readonly number[];
    reversedWorkedCoords: readonly number[];
    invalid: boolean;
}

export interface InstructionCache {
    fingerprint: string;
    shapeFingerprint: string;
    units: readonly CachedInstructionUnit[];
}

const SCAN_YIELD_INTERVAL = 64;

export function shouldYieldInstructionGeneration(index: number, recomputed: boolean): boolean {
    return recomputed || (index + 1) % SCAN_YIELD_INTERVAL === 0;
}

export function cachedInstructionUnit(
    previous: Pick<InstructionCache, "shapeFingerprint" | "units"> | null,
    shapeFingerprint: string,
    index: number,
    signature: InstructionUnitSignature,
): CachedInstructionUnit | null {
    const existing = previous?.shapeFingerprint === shapeFingerprint ? previous.units[index] : undefined;
    if (!existing || existing.contentKey !== signature.contentKey) return null;
    if (existing.invalidWorkedCoords.join(",") === signature.invalidWorkedCoords.join(",")) return existing;
    return { ...existing, invalidWorkedCoords: signature.invalidWorkedCoords, invalid: signature.invalidWorkedCoords.length > 0 };
}

export function buildInstructionUnits(
    previous: Pick<InstructionCache, "shapeFingerprint" | "units"> | null,
    shapeFingerprint: string,
    signatures: readonly InstructionUnitSignature[],
    hydrate: (signature: InstructionUnitSignature, index: number) => CachedInstructionUnit,
): CachedInstructionUnit[] {
    return signatures.map((signature, index) =>
        cachedInstructionUnit(previous, shapeFingerprint, index, signature) ?? hydrate(signature, index));
}
