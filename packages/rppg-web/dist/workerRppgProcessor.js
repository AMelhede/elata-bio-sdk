/**
 * RppgProcessor's interface on the main thread, with the processor itself in a worker
 * (the `analysisWorker` fix switch, on by default in this test build, or createRppgSession's
 * `analysisWorker` option, which wins over it).
 *
 * Every push and setting is forwarded; every read answers from the worker's latest state,
 * which it sends at most once per ANALYSIS_EVERY_MS of sample time. That is the same answer a
 * main-thread processor gives (it also analyses at most that often and returns the last result
 * in between), at most one message later, and the main thread never waits on the analysis.
 */
import { CaptureConfidenceScorer, } from "./captureConfidence.js";
import { createProcessorWorker } from "./processorWorkerUrl.js";
/** How long to wait for the worker to load the WASM core before falling back. */
const WORKER_READY_TIMEOUT_MS = 10000;
const EMPTY_METRICS = { bpm: null, confidence: 0, signal_quality: 0 };
function emptyState(sampleRate, windowSec) {
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
export class WorkerRppgProcessor {
    constructor(worker, sampleRate, windowSec) {
        this.worker = worker;
        this.captureScorer = null;
        this.lastCapture = null;
        this.disposed = false;
        this.state = emptyState(sampleRate, windowSec);
        worker.onmessage = (event) => {
            if (event.data?.type === "state")
                this.state = event.data.state;
        };
    }
    call(method, args) {
        if (this.disposed)
            return;
        this.worker.postMessage({ type: "call", method, args });
    }
    enableTracker(minBpm = 50, maxBpm = 160, numParticles = 150) {
        this.call("enableTracker", [minBpm, maxBpm, numParticles]);
    }
    pushCaptureFrame(sample, config) {
        // The score is returned at once, so it is also kept here; the worker gets the frame
        // so its metrics carry the same capture fields a main-thread processor's would.
        if (this.captureScorer == null)
            this.captureScorer = new CaptureConfidenceScorer(config ?? {});
        this.lastCapture = this.captureScorer.push(sample);
        this.call("pushCaptureFrame", [sample, config]);
        return this.lastCapture;
    }
    getCaptureConfidence() {
        return this.lastCapture;
    }
    isBackendFailed() {
        return this.state.backendFailure != null;
    }
    getBackendFailure() {
        return this.state.backendFailure;
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.worker.terminate();
    }
    pushSample(timestampMs, intensity) {
        this.call("pushSample", [timestampMs, intensity]);
    }
    pushFusedSample(timestampMs, fusedValue, fusedSnr) {
        this.call("pushFusedSample", [timestampMs, fusedValue, fusedSnr]);
    }
    pushSampleRgb(timestampMs, r, g, b, skinRatio = 1) {
        this.call("pushSampleRgb", [timestampMs, r, g, b, skinRatio]);
    }
    pushSampleRgbMeta(...args) {
        this.call("pushSampleRgbMeta", args);
    }
    updateMuseMetrics(bpm, quality = 0, timestampMs = Date.now()) {
        this.call("updateMuseMetrics", [bpm, quality, timestampMs]);
    }
    resetCalibration() {
        this.captureScorer?.reset();
        this.lastCapture = null;
        this.call("resetCalibration", []);
    }
    getStateSnapshot() {
        return this.state.stateSnapshot;
    }
    loadStateSnapshot(snapshot) {
        this.call("loadStateSnapshot", [snapshot]);
    }
    getMetrics() {
        return { ...this.state.metrics };
    }
    getDebugSnapshot(nowMs = Date.now()) {
        const debug = this.state.debug;
        return {
            ...debug,
            lastSampleAgeMs: debug.lastSampleTimestampMs != null
                ? Math.max(0, nowMs - debug.lastSampleTimestampMs)
                : null,
        };
    }
    getTraceSnapshot(maxPoints = 300) {
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
export async function createWorkerRppgProcessor(options) {
    let worker;
    try {
        worker = options.createWorker
            ? options.createWorker()
            : createProcessorWorker();
    }
    catch {
        return null;
    }
    // The worker resolves URLs against its own script, so pass them absolute.
    const absolute = (url) => url && typeof location !== "undefined"
        ? new URL(url, location.href).href
        : url;
    const ready = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), WORKER_READY_TIMEOUT_MS);
        worker.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
        worker.onmessage = (event) => {
            if (event.data?.type !== "ready")
                return;
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
