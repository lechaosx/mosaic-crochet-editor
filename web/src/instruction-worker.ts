import type { InstructionSession } from "@mosaic/wasm";
import type { InstructionReply, InstructionRequest } from "./instruction-units";

// Imported on demand so the listener exists before the wasm module finishes
// loading; requests wait for it in the order they arrived.
const units = import("./instruction-units");
let session: InstructionSession;

addEventListener("message", async ({ data: request }: MessageEvent<InstructionRequest>) => {
    try {
        const { startInstructions, instructionReply } = await units;
        if (request.kind === "start") session = startInstructions(request.pattern, request.pixels);
        else postMessage(instructionReply(session, request.index, request.knownContentKey));
    } catch (error) {
        postMessage({ error: String(error) } satisfies InstructionReply);
    }
});
