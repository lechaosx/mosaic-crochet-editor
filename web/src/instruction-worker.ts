import type { InstructionSession } from "@mosaic/wasm";
import type { PatternState } from "@mosaic/logic/types";
import type { InstructionPreview, InstructionReply, InstructionRequest, PreviewReply } from "./instruction-units";

// Imported on demand so the listener exists before the wasm module finishes
// loading; requests wait for it in the order they arrived.
const units = import("./instruction-units");
let session: InstructionSession;
// The chart of a worker started for previews, and its last preview, which the
// next one is updated from.
let previews: { pattern: PatternState; pixels: Uint8Array; last: InstructionPreview | null };

addEventListener("message", async ({ data: request }: MessageEvent<InstructionRequest>) => {
    try {
        const { startInstructions, instructionReply, nextPreview } = await units;
        if (request.kind === "start") {
            session = startInstructions(request.pattern, request.pixels);
            if (request.previews) previews = { pattern: request.pattern, pixels: request.pixels, last: null };
        } else if (request.kind === "unit") {
            postMessage(instructionReply(session, request.index, request.knownContentKey));
        } else {
            const preview = nextPreview(session, previews.pattern, previews.pixels, previews.last, request.completedUnits);
            previews.last = preview;
            const pixels = preview.pixels.slice(), cells = preview.plan.cells.slice();
            postMessage({ preview: { pixels, plan: { ...preview.plan, cells } } } satisfies PreviewReply,
                { transfer: [pixels.buffer, cells.buffer] });
        }
    } catch (error) {
        postMessage({ error: String(error) } satisfies InstructionReply);
    }
});
