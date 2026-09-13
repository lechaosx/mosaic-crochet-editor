import { describe, expect, test } from "vitest";
import { instruction_start_round } from "@mosaic/wasm";
import { composeOutput } from "../src/output-composition";
import { applyEditSettings } from "../src/pattern";

function quarter(innerWidth: number, innerHeight: number, rounds: number) {
    return applyEditSettings({
        mode: "round",
        innerWidth,
        innerHeight,
        rounds,
        subMode: "quarter",
        wipe: true,
    });
}

describe("output composition prototype", () => {
    test("As authored preserves geometry, pixels, and identity source mapping", () => {
        const source = quarter(0, 0, 2);
        const output = composeOutput(source.pattern, source.pixels, "as-authored");

        expect(output.status).toBe("ready");
        if (output.status === "unavailable") return;
        expect(output.pattern).toEqual(source.pattern);
        expect(output.pixels).toEqual(source.pixels);
        expect(output.pixels).not.toBe(source.pixels);
        expect([...output.sourceIndices]).toEqual([0, 1, 2, 3]);
        expect(output.sharedCells).toEqual([]);
        expect(output.conflicts).toEqual([]);
    });

    test("rotates a square zero-centre quarter into a full output without distortion", () => {
        const source = quarter(0, 0, 2);
        source.pixels[0] = source.pixels[0] === 1 ? 2 : 1;
        const output = composeOutput(source.pattern, source.pixels, "rotate-quarter-to-full");

        expect(output.status).toBe("ready");
        if (output.status === "unavailable") return;
        expect(output.pattern).toEqual({
            mode: "round",
            canvasWidth: 4,
            canvasHeight: 4,
            virtualWidth: 4,
            virtualHeight: 4,
            offsetX: 0,
            offsetY: 0,
            rounds: 2,
        });
        expect([...output.pixels].filter(Boolean)).toHaveLength(16);
        for (const [x, y] of [[0, 2], [1, 0], [3, 1], [2, 3]]) {
            expect(output.pixels[y * 4 + x]).toBe(source.pixels[0]);
            expect(output.sourceIndices[y * 4 + x]).toBe(0);
        }
        expect(output.sharedCells).toEqual([]);
        expect(output.conflicts).toEqual([]);
    });

    test("accepts matching shared midpoint claims and reports conflicting ones", () => {
        const source = quarter(1, 1, 2);
        const matching = composeOutput(source.pattern, source.pixels, "rotate-quarter-to-full");

        expect(matching.status).toBe("ready");
        if (matching.status === "unavailable") return;
        expect(matching.sharedCells.length).toBeGreaterThan(0);
        expect(matching.conflicts).toEqual([]);
        expect(matching.sharedCells).toContainEqual({
            x: 1,
            y: 2,
            sourceIndices: [1, 5],
        });
        expect(matching.sourceIndices[2 * 5 + 1]).toBe(1);

        const conflictingPixels = source.pixels.slice();
        conflictingPixels[5] = conflictingPixels[5] === 1 ? 2 : 1;
        const conflicting = composeOutput(source.pattern, conflictingPixels, "rotate-quarter-to-full");
        expect(conflicting.status).toBe("conflict");
        if (conflicting.status === "unavailable") return;
        expect(conflicting.conflicts).toContainEqual({
            x: 1,
            y: 2,
            sourceIndices: [1, 5],
        });
    });

    test("produces complete round paths with four corners and mapped source cells", () => {
        const source = quarter(0, 0, 2);
        const output = composeOutput(source.pattern, source.pixels, "rotate-quarter-to-full");
        if (output.status !== "ready" || output.pattern.mode !== "round") {
            throw new Error("expected ready round output");
        }
        const pattern = output.pattern;
        const session = instruction_start_round(
            output.pixels,
            pattern.canvasWidth,
            pattern.canvasHeight,
            pattern.virtualWidth,
            pattern.virtualHeight,
            pattern.offsetX,
            pattern.offsetY,
            pattern.rounds,
            false,
        );
        expect(session.total()).toBe(2);
        for (let round = 1; round <= 2; round++) {
            const unit = session.next()!;
            const coords = Array.from(unit.worked_coords());
            const inset = pattern.rounds - round;
            let corners = 0;
            for (let i = 0; i < coords.length; i += 2) {
                const x = coords[i];
                const y = coords[i + 1];
                expect(output.sourceIndices[y * pattern.canvasWidth + x]).toBeGreaterThanOrEqual(0);
                if ((x === inset || x === pattern.canvasWidth - 1 - inset)
                    && (y === inset || y === pattern.canvasHeight - 1 - inset)) corners++;
            }
            expect(corners).toBe(4);
            unit.free();
        }
        session.free();
    });

    test("keeps unsupported source geometry unavailable", () => {
        const rectangular = quarter(0, 1, 2);
        const half = applyEditSettings({
            mode: "round",
            innerWidth: 0,
            innerHeight: 0,
            rounds: 2,
            subMode: "half",
            wipe: true,
        });

        expect(composeOutput(rectangular.pattern, rectangular.pixels, "rotate-quarter-to-full"))
            .toMatchObject({ status: "unavailable", reason: expect.stringMatching(/square/i) });
        expect(composeOutput(half.pattern, half.pixels, "rotate-quarter-to-full"))
            .toMatchObject({ status: "unavailable", reason: expect.stringMatching(/quarter/i) });
    });
});
