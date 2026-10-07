/**
 * Worker entry: runs the unchanged RppgProcessor off the main thread.
 *
 * Why: the analysis takes ~50 ms four times a second. On the main thread every camera frame
 * that arrives during it is skipped (the browser hands over only the newest frame), which cost
 * ~5 of 30 frames a second on a 1280x960 test feed (2026-10-02). Here it blocks nothing.
 *
 * The worker answers in the same rhythm the processor already analyses at: after a push, if at
 * least ANALYSIS_EVERY_MS of sample time has passed since the last answer, it reads the
 * processor (which analyses then) and posts the state. Settings are answered at once.
 */
import type {
	ProcessorWorkerMethod,
	ProcessorWorkerRequest,
	ProcessorWorkerResponse,
} from "./processorWorkerProtocol";
import { ANALYSIS_EVERY_MS } from "./processorWorkerProtocol";
import { RppgProcessor } from "./rppgProcessor";
import { createUnavailableBackend, loadWasmBackend } from "./wasmBackend";

const scope = self as unknown as {
	postMessage(message: ProcessorWorkerResponse): void;
	onmessage: ((event: MessageEvent<ProcessorWorkerRequest>) => void) | null;
	close(): void;
};

const PUSHES: readonly ProcessorWorkerMethod[] = [
	"pushSample",
	"pushFusedSample",
	"pushSampleRgb",
	"pushSampleRgbMeta",
];

let processor: RppgProcessor | null = null;
let postedAtMs: number | null = null;

function postState() {
	if (!processor) return;
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
			processor = new RppgProcessor(
				backend ?? createUnavailableBackend(),
				message.sampleRate,
				message.windowSec,
				{ bpmTrackerConfig: message.bpmTrackerConfig, fixes: message.fixes },
			);
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
		if (!processor) return;
		(processor[message.method] as (...args: unknown[]) => unknown)(
			...message.args,
		);
		if (!PUSHES.includes(message.method)) {
			postState();
			return;
		}
		const atMs = message.args[0] as number;
		if (
			postedAtMs == null ||
			atMs - postedAtMs >= ANALYSIS_EVERY_MS ||
			atMs < postedAtMs
		) {
			postedAtMs = atMs;
			postState();
		}
	} catch (error) {
		scope.postMessage({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		});
		postState();
	}
};
