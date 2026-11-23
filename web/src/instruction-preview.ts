import type { PatternState } from "@mosaic/logic/types";
import type { InstructionWorker } from "./instruction-generation";
import type { InstructionPreview, PreviewReply } from "./instruction-units";

// Computes Crochet previews of `chart` on `worker`, one at a time. A request
// made while a preview is computed replaces any request still waiting, and
// supersedes that preview, so only the latest request's preview is shown.
// Reports a worker's failure once instead of further previews, and
// terminates the worker on a failure or when `stop` is called; replies
// already queued by then are ignored.
export function showPreviews(
    worker: InstructionWorker<PreviewReply>,
    chart: { pattern: PatternState; pixels: Uint8Array },
    onPreview: (completedUnits: number | null, preview: InstructionPreview) => void,
    onFailure: (error: string) => void,
): { request: (completedUnits: number | null) => void; stop: () => void } {
    // The request computed, and the one waiting for it, if any.
    let computing: { completedUnits: number | null } | null = null;
    let waiting: { completedUnits: number | null } | null = null;
    let stopped = false;
    const send = (request: { completedUnits: number | null }) => {
        computing = request;
        worker.postMessage({ kind: "preview", ...request });
    };
    const stop = () => {
        stopped = true;
        worker.terminate();
    };
    const fail = (error: string) => {
        if (stopped) return;
        stop();
        onFailure(error);
    };
    worker.onerror = event => fail(event.message || "The worker failed to load.");
    worker.onmessage = ({ data: reply }) => {
        if (stopped) return;
        if ("error" in reply) return fail(reply.error);
        const computed = computing!;
        computing = null;
        if (waiting) {
            send(waiting);
            waiting = null;
        } else onPreview(computed.completedUnits, reply.preview);
    };
    worker.postMessage({ kind: "start", ...chart, previews: true });
    return {
        request: completedUnits => {
            if (stopped) return;
            if (computing) waiting = { completedUnits };
            else send({ completedUnits });
        },
        stop,
    };
}
