import type { RppgFixesOption } from "./fixSwitches";
import type { BpmTrackerConfigV1 } from "./bpmBayesTracker";
/**
 * RppgProcessor's interface on the main thread, with the processor itself in a worker
 * (createRppgSession({ analysisWorker: true }), off by default).
 *
 * Every push and setting is forwarded; every read answers from the worker's latest state,
 * which it sends at most once per ANALYSIS_EVERY_MS of sample time. That is the same answer a
 * main-thread processor gives (it also analyses at most that often and returns the last result
 * in between), at most one message later, and the main thread never waits on the analysis.
 */
import {
	type CaptureConfidenceConfig,
	type CaptureConfidenceResult,
	CaptureConfidenceScorer,
	type CaptureFrameSample,
} from "./captureConfidence";
import type {
	ProcessorWorkerMethod,
	ProcessorWorkerRequest,
	ProcessorWorkerResponse,
	ProcessorWorkerState,
} from "./processorWorkerProtocol";
import { createProcessorWorker } from "./processorWorkerUrl";
import type {
	Metrics,
	RppgDebugSnapshot,
	RppgProcessor,
	RppgProcessorBackendFailure,
	RppgTraceSnapshot,
} from "./rppgProcessor";

/** What the session and runner use of a processor; both implementations provide it. */
export type RppgProcessorLike = Pick<
	RppgProcessor,
	| "enableTracker"
	| "pushCaptureFrame"
	| "getCaptureConfidence"
	| "isBackendFailed"
	| "getBackendFailure"
	| "dispose"
	| "pushSample"
	| "pushFusedSample"
	| "pushSampleRgb"
	| "pushSampleRgbMeta"
	| "updateMuseMetrics"
	| "resetCalibration"
	| "getStateSnapshot"
	| "loadStateSnapshot"
	| "getMetrics"
	| "getDebugSnapshot"
	| "getTraceSnapshot"
>;

/** How long to wait for the worker to load the WASM core before falling back. */
const WORKER_READY_TIMEOUT_MS = 10000;

/** Minimal Worker surface (mockable in tests). */
export type WorkerLike = {
	postMessage(message: ProcessorWorkerRequest): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<ProcessorWorkerResponse>) => void) | null;
	onerror: ((event: unknown) => void) | null;
};

const EMPTY_METRICS: Metrics = { bpm: null, confidence: 0, signal_quality: 0 };

function emptyState(
	sampleRate: number,
	windowSec: number,
): ProcessorWorkerState {
	return {
		metrics: { ...EMPTY_METRICS },
		debug: {
			totalSamplesReceived: 0,
			windowSampleCount: 0,
			windowDurationMs: 0,
			lastSampleTimestampMs: null,
			lastSampleAgeMs: null,
			lastSample: null,
			backendMetrics: { ...EMPTY_METRICS },
			issues: ["no_samples_yet"],
		},
		trace: {
			sampleRate,
			windowSec,
			totalSamplesReceived: 0,
			windowSampleCount: 0,
			windowDurationMs: 0,
			durationSec: 0,
			points: [],
			lastSample: null,
			backendFailure: null,
		},
		backendFailure: null,
		stateSnapshot: null,
	};
}

export class WorkerRppgProcessor implements RppgProcessorLike {
	private state: ProcessorWorkerState;
	private captureScorer: CaptureConfidenceScorer | null = null;
	private lastCapture: CaptureConfidenceResult | null = null;
	private disposed = false;

	constructor(
		private readonly worker: WorkerLike,
		sampleRate: number,
		windowSec: number,
	) {
		this.state = emptyState(sampleRate, windowSec);
		worker.onmessage = (event) => {
			if (event.data?.type === "state") this.state = event.data.state;
		};
	}

	private call(method: ProcessorWorkerMethod, args: unknown[]) {
		if (this.disposed) return;
		this.worker.postMessage({ type: "call", method, args });
	}

	enableTracker(minBpm = 50, maxBpm = 160, numParticles = 150) {
		this.call("enableTracker", [minBpm, maxBpm, numParticles]);
	}

	pushCaptureFrame(
		sample: CaptureFrameSample,
		config?: Partial<CaptureConfidenceConfig>,
	): CaptureConfidenceResult {
		// The score is returned at once, so it is also kept here; the worker gets the frame
		// so its metrics carry the same capture fields a main-thread processor's would.
		if (this.captureScorer == null)
			this.captureScorer = new CaptureConfidenceScorer(config ?? {});
		this.lastCapture = this.captureScorer.push(sample);
		this.call("pushCaptureFrame", [sample, config]);
		return this.lastCapture;
	}

	getCaptureConfidence(): CaptureConfidenceResult | null {
		return this.lastCapture;
	}

	isBackendFailed(): boolean {
		return this.state.backendFailure != null;
	}

	getBackendFailure(): RppgProcessorBackendFailure | null {
		return this.state.backendFailure;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.worker.terminate();
	}

	pushSample(timestampMs: number, intensity: number) {
		this.call("pushSample", [timestampMs, intensity]);
	}

	pushFusedSample(timestampMs: number, fusedValue: number, fusedSnr: number) {
		this.call("pushFusedSample", [timestampMs, fusedValue, fusedSnr]);
	}

	pushSampleRgb(
		timestampMs: number,
		r: number,
		g: number,
		b: number,
		skinRatio = 1,
	) {
		this.call("pushSampleRgb", [timestampMs, r, g, b, skinRatio]);
	}

	pushSampleRgbMeta(...args: Parameters<RppgProcessor["pushSampleRgbMeta"]>) {
		this.call("pushSampleRgbMeta", args);
	}

	updateMuseMetrics(bpm: number | null, quality = 0, timestampMs = Date.now()) {
		this.call("updateMuseMetrics", [bpm, quality, timestampMs]);
	}

	resetCalibration() {
		this.captureScorer?.reset();
		this.lastCapture = null;
		this.call("resetCalibration", []);
	}

	getStateSnapshot(): ReturnType<RppgProcessor["getStateSnapshot"]> {
		return this.state.stateSnapshot as ReturnType<
			RppgProcessor["getStateSnapshot"]
		>;
	}

	loadStateSnapshot(snapshot: unknown) {
		this.call("loadStateSnapshot", [snapshot]);
	}

	getMetrics(): Metrics {
		return { ...this.state.metrics };
	}

	getDebugSnapshot(nowMs = Date.now()): RppgDebugSnapshot {
		const debug = this.state.debug;
		return {
			...debug,
			lastSampleAgeMs:
				debug.lastSampleTimestampMs != null
					? Math.max(0, nowMs - debug.lastSampleTimestampMs)
					: null,
		};
	}

	getTraceSnapshot(maxPoints = 300): RppgTraceSnapshot {
		const trace = this.state.trace;
		const n = Math.max(1, Math.floor(maxPoints));
		return { ...trace, points: trace.points.slice(-n) };
	}
}

/**
 * Starts the analysis worker and waits until it has loaded the WASM core. Returns null (the
 * caller then uses a main-thread processor, exactly as without the option) when workers are
 * unavailable, the worker fails, the core does not load, or it takes over
 * WORKER_READY_TIMEOUT_MS.
 */
export async function createWorkerRppgProcessor(options: {
	sampleRate: number;
	windowSec: number;
	wasmJsUrl?: string;
	wasmBinaryUrl?: string;
	bpmTrackerConfig?: BpmTrackerConfigV1;
	fixes?: RppgFixesOption;
	createWorker?: () => WorkerLike;
}): Promise<WorkerRppgProcessor | null> {
	let worker: WorkerLike;
	try {
		worker = options.createWorker
			? options.createWorker()
			: (createProcessorWorker() as unknown as WorkerLike);
	} catch {
		return null;
	}
	// The worker resolves URLs against its own script, so pass them absolute.
	const absolute = (url?: string) =>
		url && typeof location !== "undefined"
			? new URL(url, location.href).href
			: url;
	const ready = await new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), WORKER_READY_TIMEOUT_MS);
		worker.onerror = () => {
			clearTimeout(timer);
			resolve(false);
		};
		worker.onmessage = (event) => {
			if (event.data?.type !== "ready") return;
			clearTimeout(timer);
			resolve(event.data.mode === "wasm");
		};
		worker.postMessage({
			type: "init",
			sampleRate: options.sampleRate,
			windowSec: options.windowSec,
			wasmJsUrl: absolute(options.wasmJsUrl),
			wasmBinaryUrl: absolute(options.wasmBinaryUrl),
			bpmTrackerConfig: options.bpmTrackerConfig,
			fixes: options.fixes,
		});
	});
	if (!ready) {
		worker.terminate();
		return null;
	}
	worker.onerror = null;
	return new WorkerRppgProcessor(worker, options.sampleRate, options.windowSec);
}
