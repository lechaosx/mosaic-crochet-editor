import type { SymKey } from "@mosaic/logic/types";
import { centered_transform_placements } from "@mosaic/wasm";

export const MIRROR_TYPES: { key: SymKey; name: string; shortcut: string; code: number; orientation: number[] }[] = [
    { key: "V", name: "Vertical", shortcut: "V", code: 0, orientation: [-1, 0, 0, 1] },
    { key: "H", name: "Horizontal", shortcut: "H", code: 1, orientation: [1, 0, 0, -1] },
    { key: "D1", name: "Diagonal", shortcut: "D", code: 3, orientation: [0, 1, 1, 0] },
    { key: "D2", name: "Anti-diagonal", shortcut: "A", code: 4, orientation: [0, -1, -1, 0] },
    { key: "C", name: "Point reflection (180°)", shortcut: "C", code: 2, orientation: [-1, 0, 0, -1] },
];

export function mirrorTypePresentation(chosen: readonly SymKey[]) {
    // Centred orientations describe geometric implication even when chart clipping limits executable copies.
    const matrices = centered_transform_placements(0, 0,
        new Uint8Array(chosen.map(key => MIRROR_TYPES.find(type => type.key === key)!.code)));
    return MIRROR_TYPES.map(type => {
        const explicit = chosen.includes(type.key);
        let implied = false;
        for (let i = 0; !explicit && i < matrices.length; i += 6) {
            if (type.orientation.every((coefficient, index) => matrices[i + index] === coefficient)) {
                implied = true;
                break;
            }
        }
        return { ...type, chosen: explicit, implied };
    });
}
