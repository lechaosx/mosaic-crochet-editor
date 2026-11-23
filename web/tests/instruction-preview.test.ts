import { describe, expect, it } from "vitest";
import { initialize_round_pattern, initialize_row_pattern } from "@mosaic/wasm";
import { Store } from "@mosaic/logic/store";
import type { PatternState } from "@mosaic/logic/types";
import { showPreviews } from "../src/instruction-preview";
import {
    nextPreview, startInstructions, type InstructionPreview, type InstructionRequest, type PreviewReply,
} from "../src/instruction-units";
import { rowSession } from "./_helpers";

let seed = 11;
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

describe("instruction previews", () => {
    for (const chart of charts) {
        it(`match the preview store's pixels and plan forwards and backwards for ${chart.name}`, () => {
            const { pattern, pixels, total } = chart;
            const editor = new Store(rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
            const expected = editor.derive({ ...editor.state, mirrors: [], liveMirrors: false });
            const reference = startInstructions(pattern, pixels);
            const session = startInstructions(pattern, pixels);
            const forwards = Array.from({ length: total + 1 }, (_, units) => units);
            const steps = [...forwards, null, ...forwards.reverse(), null, 2, total, 1];
            let preview: InstructionPreview | null = null;
            for (const completedUnits of steps) {
                expected.commit(s => {
                    s.pixels = completedUnits === null ? editor.visible : reference.wip_pixels(completedUnits);
                }, { render: false, persist: false });
                preview = nextPreview(session, pattern, pixels, preview, completedUnits);
                expect(preview.pixels).toEqual(expected.visible);
                expect(preview.plan).toEqual(expected.plan);
            }
        });
    }
});

// Answers nothing until `reply` is called, so tests decide when each preview arrives.
class FakeWorker {
    onmessage: ((event: MessageEvent<PreviewReply>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    requested: (number | null)[] = [];
    postMessage(request: InstructionRequest) {
        if (request.kind === "preview") this.requested.push(request.completedUnits);
    }
    reply(completedUnits: number | null) {
        const pixels = new Uint8Array([completedUnits ?? 255]);
        this.onmessage?.(new MessageEvent("message", {
            data: { preview: { pixels, plan: { cells: new Uint8Array(1), marked: 0, invalid: 0 } } },
        }));
    }
    terminate() {}
}

function previews() {
    const worker = new FakeWorker();
    const shown: (number | null)[] = [];
    const failures: string[] = [];
    const chart = { pattern: charts[0].pattern, pixels: charts[0].pixels };
    const controls = showPreviews(worker, chart, (completedUnits, preview) => {
        expect(preview.pixels[0]).toBe(completedUnits ?? 255);
        shown.push(completedUnits);
    }, error => failures.push(error));
    return { worker, shown, failures, ...controls };
}

describe("showing instruction previews", () => {
    it("shows each preview requested while none is pending", () => {
        const { worker, shown, request } = previews();
        request(3);
        worker.reply(3);
        request(null);
        worker.reply(null);
        expect(worker.requested).toEqual([3, null]);
        expect(shown).toEqual([3, null]);
    });

    it("computes only the latest request made while a preview is pending, and shows only that one", () => {
        const { worker, shown, request } = previews();
        request(1);
        request(2);
        request(3);
        expect(worker.requested).toEqual([1]);
        worker.reply(1);
        expect(shown).toEqual([]);
        expect(worker.requested).toEqual([1, 3]);
        worker.reply(3);
        expect(shown).toEqual([3]);
    });

    it("ignores a reply that arrives after previews stop", () => {
        const { worker, shown, request, stop } = previews();
        request(1);
        stop();
        worker.reply(1);
        expect(shown).toEqual([]);
    });

    it("stops on a failure, reporting it once", () => {
        const { worker, shown, failures, request } = previews();
        request(1);
        worker.onmessage!(new MessageEvent("message", { data: { error: "no wasm" } }));
        worker.onerror!(new ErrorEvent("error"));
        request(2);
        worker.reply(2);
        expect(failures).toEqual(["no wasm"]);
        expect(shown).toEqual([]);
        expect(worker.requested).toEqual([1]);
    });
});
