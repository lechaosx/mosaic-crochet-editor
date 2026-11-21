import { describe, expect, it } from "vitest";
import {
    initialize_round_pattern, initialize_row_pattern, instruction_start_round, instruction_start_row,
    InstructionSession,
} from "@mosaic/wasm";
import type { PatternState } from "@mosaic/logic/types";
import type { CachedInstructionUnit } from "../src/instruction-cache";
import { generateInstructions, type InstructionWorker } from "../src/instruction-generation";
import { instructionReply, startInstructions, type InstructionReply, type InstructionRequest } from "../src/instruction-units";

// Answers each request on a later task, like a worker, and keeps answering
// after `terminate`: a reply can already be queued when generation stops.
class FakeWorker implements InstructionWorker {
    onmessage: ((event: MessageEvent<InstructionReply>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    session: InstructionSession | null = null;
    requested: number[] = [];
    postMessage(request: InstructionRequest) {
        if (request.kind === "unit") this.requested.push(request.index);
        setTimeout(() => {
            if (request.kind === "start") this.session = startInstructions(request.pattern, request.pixels);
            else this.onmessage?.(new MessageEvent("message", {
                data: instructionReply(this.session!, request.index, request.knownContentKey),
            }));
        });
    }
    terminate() {}
}

let seed = 7;
function randomYarns(pixels: Uint8Array): Uint8Array {
    for (let i = 0; i < pixels.length; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        if (pixels[i] !== 0) pixels[i] = seed & 0x10000 ? 2 : 1;
    }
    return pixels;
}

const charts: { name: string; pattern: PatternState; pixels: Uint8Array; total: number }[] = [
    { name: "rows", pattern: { mode: "row", canvasWidth: 11, canvasHeight: 9 },
        pixels: randomYarns(initialize_row_pattern(11, 9)), total: 9 },
    { name: "full centre-out rounds", pattern: {
        mode: "round", canvasWidth: 13, canvasHeight: 13, virtualWidth: 13, virtualHeight: 13,
        offsetX: 0, offsetY: 0, rounds: 6,
    }, pixels: randomYarns(initialize_round_pattern(13, 13, 13, 13, 0, 0, 6)), total: 6 },
    { name: "quarter centre-out rounds", pattern: {
        mode: "round", canvasWidth: 7, canvasHeight: 7, virtualWidth: 13, virtualHeight: 13,
        offsetX: 6, offsetY: 6, rounds: 6,
    }, pixels: randomYarns(initialize_round_pattern(7, 7, 13, 13, 6, 6, 6)), total: 6 },
];

function session({ pattern, pixels }: (typeof charts)[number]) {
    return pattern.mode === "row"
        ? instruction_start_row(pixels, pattern.canvasWidth, pattern.canvasHeight)
        : instruction_start_round(pixels, pattern.canvasWidth, pattern.canvasHeight, pattern.virtualWidth,
            pattern.virtualHeight, pattern.offsetX, pattern.offsetY, pattern.rounds);
}

function generate(
    chart: (typeof charts)[number], workers: FakeWorker[], selected: () => number,
    previous: { shapeFingerprint: string; units: readonly CachedInstructionUnit[] } | null = null,
) {
    const delivered: number[] = [];
    const units: CachedInstructionUnit[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => resolveDone = resolve);
    const failures: string[] = [];
    const stop = generateInstructions(workers, chart, chart.total, previous, "shape", selected, (index, unit) => {
        delivered.push(index);
        units[index] = unit;
        if (delivered.length === chart.total) resolveDone();
    }, error => failures.push(error));
    return { delivered, units, failures, done, stop };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("instruction generation", () => {
    for (const chart of charts) {
        it(`matches the instruction session unit by unit for ${chart.name}`, async () => {
            const { units, done } = generate(chart, [new FakeWorker(), new FakeWorker(), new FakeWorker()], () => 0);
            await done;
            const reference = session(chart);
            expect(units).toHaveLength(reference.total());
            units.forEach((unit, index) => {
                const signature = reference.signature_at(index)!;
                const expected = reference.unit_at(index)!;
                expect(unit).toEqual({
                    label: `${chart.pattern.mode === "row" ? "Row" : "Round"} ${index + 1}`,
                    yarn: index % 2 === 0 ? "A" : "B",
                    contentKey: signature.content_key(),
                    invalidWorkedCoords: signature.invalid_worked_coords(),
                    startDirection: signature.start_direction(),
                    reversedStartDirection: signature.reversed_start_direction(),
                    text: expected.text(),
                    reversedText: expected.reversed_text(),
                    workedCoords: expected.worked_coords(),
                    reversedWorkedCoords: expected.reversed_worked_coords(),
                    invalid: signature.invalid_worked_coords().length > 0,
                });
            });
        });
    }

    it("delivers the selected unit first, then the rest from the first unit", async () => {
        const worker = new FakeWorker();
        const { delivered, done } = generate(charts[0], [worker], () => 5);
        await done;
        expect(worker.requested).toEqual([5, 0, 1, 2, 3, 4, 6, 7, 8]);
        expect(delivered).toEqual([5, 0, 1, 2, 3, 4, 6, 7, 8]);
    });

    it("moves a newly selected pending unit ahead of the rest", async () => {
        const worker = new FakeWorker();
        let selected = 0;
        const { delivered, done } = generate(charts[0], [worker], () => selected);
        selected = 7;
        await done;
        expect(delivered).toEqual([0, 7, 1, 2, 3, 4, 5, 6, 8]);
    });

    it("ignores replies that arrive after generation stops", async () => {
        const workers = [new FakeWorker(), new FakeWorker()];
        const { delivered, stop } = generate(charts[0], workers, () => 0);
        stop();
        await settle();
        expect(workers.flatMap(worker => worker.requested)).not.toHaveLength(0);
        expect(delivered).toEqual([]);
    });

    it("stops when a worker fails to load, reporting the failure once", async () => {
        const workers = [new FakeWorker(), new FakeWorker()];
        const { delivered, failures } = generate(charts[0], workers, () => 0);
        workers[0].onerror!(new ErrorEvent("error"));
        workers[1].onerror!(new ErrorEvent("error"));
        await settle();
        expect(failures).toEqual(["The worker failed to load."]);
        expect(delivered).toEqual([]);
    });

    it("stops when a worker replies with a failure", async () => {
        class FailingWorker extends FakeWorker {
            postMessage(request: InstructionRequest) {
                if (request.kind === "unit" && request.index === 1) {
                    setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: { error: "no wasm" } })));
                } else super.postMessage(request);
            }
        }
        const { delivered, failures } = generate(charts[0], [new FakeWorker(), new FailingWorker()], () => 0);
        await settle();
        expect(failures).toEqual(["no wasm"]);
        expect(delivered).toEqual([0]);
    });

    it("reuses cached units whose stitches are unchanged", async () => {
        const first = generate(charts[0], [new FakeWorker()], () => 0);
        await first.done;
        const previous = { shapeFingerprint: "shape", units: first.units };
        const again = generate(charts[0], [new FakeWorker()], () => 0, previous);
        await again.done;
        again.units.forEach((unit, index) => expect(unit).toBe(first.units[index]));
    });

    it("regenerates every unit of a cache with another shape", async () => {
        const first = generate(charts[0], [new FakeWorker()], () => 0);
        await first.done;
        const previous = { shapeFingerprint: "other shape", units: first.units };
        const again = generate(charts[0], [new FakeWorker()], () => 0, previous);
        await again.done;
        again.units.forEach((unit, index) => {
            expect(unit).not.toBe(first.units[index]);
            expect(unit).toEqual(first.units[index]);
        });
    });
});
