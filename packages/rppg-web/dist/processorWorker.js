import { ANALYSIS_EVERY_MS } from "./processorWorkerProtocol.js";
import { RppgProcessor } from "./rppgProcessor.js";
import { createUnavailableBackend, loadWasmBackend } from "./wasmBackend.js";
const scope = self;
const PUSHES = [
    "pushSample",
    "pushFusedSample",
    "pushSampleRgb",
    "pushSampleRgbMeta",
];
let processor = null;
let postedAtMs = null;
function postState() {
    if (!processor)
        return;
    scope.postMessage({
        type: "state",
        state: {
            metrics: processor.getMetrics(),
            debug: processor.getDebugSnapshot(Date.now()),
            trace: processor.getTraceSnapshot(300),
            backendFailure: processor.getBackendFailure(),
            stateSnapshot: processor.getStateSnapshot(),
        },
    });
}
scope.onmessage = async (event) => {
    const message = event.data;
    try {
        if (message.type === "init") {
            const backend = await loadWasmBackend(undefined, {
                jsUrl: message.wasmJsUrl,
                binaryUrl: message.wasmBinaryUrl,
            });
            processor = new RppgProcessor(backend ?? createUnavailableBackend(), message.sampleRate, message.windowSec, { bpmTrackerConfig: message.bpmTrackerConfig, fixes: message.fixes });
            scope.postMessage({
                type: "ready",
                mode: backend ? "wasm" : "unavailable",
            });
            return;
        }
        if (message.type === "dispose") {
            processor?.dispose();
            processor = null;
            scope.close();
            return;
        }
        if (!processor)
            return;
        processor[message.method](...message.args);
        if (!PUSHES.includes(message.method)) {
            postState();
            return;
        }
        const atMs = message.args[0];
        if (postedAtMs == null ||
            atMs - postedAtMs >= ANALYSIS_EVERY_MS ||
            atMs < postedAtMs) {
            postedAtMs = atMs;
            postState();
        }
    }
    catch (error) {
        scope.postMessage({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
        });
        postState();
    }
};
