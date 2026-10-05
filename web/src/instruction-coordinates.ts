import { PlanDir } from "@mosaic/wasm";

const DIR_VECTORS: Record<number, readonly [number, number]> = {
    [PlanDir.Up]: [0, -1],
    [PlanDir.Down]: [0, 1],
    [PlanDir.Left]: [-1, 0],
    [PlanDir.Right]: [1, 0],
};

export function planOutwardCoordinate(plan: Int16Array, recordOffset: number): readonly [number, number] {
    const [dx, dy] = DIR_VECTORS[plan[recordOffset + 1]];
    return [plan[recordOffset + 2] + dx, plan[recordOffset + 3] + dy];
}

export interface PackedInstructionCoordinates {
    readonly values: Uint32Array;
    has(x: number, y: number): boolean;
    forEach(callback: (x: number, y: number) => void): void;
}

export function packInstructionCoordinates(
    coords: ArrayLike<number>, canvasWidth: number,
): PackedInstructionCoordinates {
    const stride = canvasWidth + 2;
    const values = new Uint32Array(Math.floor(coords.length / 2));
    for (let index = 0; index < values.length; index++) {
        values[index] = (coords[index * 2 + 1] + 1) * stride + coords[index * 2] + 1;
    }
    values.sort();
    let length = 0;
    for (const value of values) {
        if (length === 0 || values[length - 1] !== value) values[length++] = value;
    }
    const packed = length === values.length ? values : values.slice(0, length);
    const encode = (x: number, y: number) => (y + 1) * stride + x + 1;
    return {
        values: packed,
        has(x, y) {
            if (x < -1 || x > canvasWidth || y < -1) return false;
            const target = encode(x, y);
            let low = 0, high = packed.length - 1;
            while (low <= high) {
                const middle = (low + high) >>> 1;
                if (packed[middle] === target) return true;
                if (packed[middle] < target) low = middle + 1;
                else high = middle - 1;
            }
            return false;
        },
        forEach(callback) {
            for (const value of packed) {
                callback(value % stride - 1, Math.floor(value / stride) - 1);
            }
        },
    };
}
