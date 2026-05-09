const snapshots: Uint8Array[] = [];
let   index                   = -1;

export function historySave(pixels: Uint8Array) {
    snapshots.splice(index + 1);
    snapshots.push(pixels.slice());
    index = snapshots.length - 1;
    if (snapshots.length > 64) { snapshots.shift(); index--; }
}

export function historyReset(pixels: Uint8Array) {
    snapshots.length = 0;
    index            = -1;
    historySave(pixels);
}

export function canUndo(): boolean { return index > 0; }
export function canRedo(): boolean { return index < snapshots.length - 1; }

export function historyUndo(): Uint8Array | null {
    if (!canUndo()) return null;
    index--;
    return snapshots[index].slice();
}

export function historyRedo(): Uint8Array | null {
    if (!canRedo()) return null;
    index++;
    return snapshots[index].slice();
}
