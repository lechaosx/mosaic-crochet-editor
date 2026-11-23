import type { PatternState } from "@mosaic/logic/types";
import { cachedInstructionUnit, type CachedInstructionUnit, type InstructionCache } from "./instruction-cache";
import type { InstructionReply, InstructionRequest } from "./instruction-units";

export interface InstructionWorker<Reply = InstructionReply> {
    postMessage(request: InstructionRequest): void;
    onmessage: ((event: MessageEvent<Reply>) => void) | null;
    // Called when the worker's script fails to load or throws outside a request.
    onerror: ((event: ErrorEvent) => void) | null;
    terminate(): void;
}

// Generates the `total` units of `chart` on `workers`, each computing one unit
// at a time: the unit `selected` names whenever it is still pending, otherwise
// the first pending one. Reports each unit once, in completion order, or a
// worker's failure once instead of the units not yet reported, and
// terminates the workers when all are reported, on a failure, or when the
// returned stop is called; replies already queued by then are ignored.
export function generateInstructions(
    workers: readonly InstructionWorker[],
    chart: { pattern: PatternState; pixels: Uint8Array },
    total: number,
    previous: Pick<InstructionCache, "shapeFingerprint" | "units"> | null,
    shapeFingerprint: string,
    selected: () => number,
    onUnit: (index: number, unit: CachedInstructionUnit) => void,
    onFailure: (error: string) => void,
): () => void {
    const requested = new Uint8Array(total);
    let firstPending = 0, remaining = total, stopped = false;
    const take = () => {
        const index = selected();
        if (index >= 0 && index < total && !requested[index]) return index;
        while (firstPending < total && requested[firstPending]) firstPending++;
        return firstPending < total ? firstPending : null;
    };
    const request = (worker: InstructionWorker) => {
        const index = take();
        if (index === null) return;
        requested[index] = 1;
        const known = previous?.shapeFingerprint === shapeFingerprint ? previous.units[index] : undefined;
        worker.postMessage({ kind: "unit", index, knownContentKey: known?.contentKey ?? null });
    };
    const stop = () => {
        stopped = true;
        for (const worker of workers) worker.terminate();
    };
    const fail = (error: string) => {
        if (stopped) return;
        stop();
        onFailure(error);
    };
    for (const worker of workers) {
        worker.onerror = event => fail(event.message || "The worker failed to load.");
        worker.onmessage = ({ data: reply }) => {
            if (stopped) return;
            if ("error" in reply) return fail(reply.error);
            remaining--;
            request(worker);
            onUnit(reply.index, "unit" in reply ? reply.unit
                : cachedInstructionUnit(previous, shapeFingerprint, reply.index, reply.signature)!);
            if (remaining === 0) stop();
        };
        worker.postMessage({ kind: "start", ...chart, previews: false });
        request(worker);
    }
    return stop;
}
