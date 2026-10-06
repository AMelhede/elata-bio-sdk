import type { RppgFixesOption } from "./fixSwitches.js";
import type { BpmTrackerConfigV1 } from "./bpmBayesTracker.js";
/**
 * RppgProcessor's interface on the main thread, with the processor itself in a worker
 * (createRppgSession({ analysisWorker: true }), off by default).
 *
 * Every push and setting is forwarded; every read answers from the worker's latest state,
 * which it sends at most once per ANALYSIS_EVERY_MS of sample time. That is the same answer a
 * main-thread processor gives (it also analyses at most that often and returns the last result
 * in between), at most one message later, and the main thread never waits on the analysis.
 */
import { type CaptureConfidenceConfig, type CaptureConfidenceResult, type CaptureFrameSample } from "./captureConfidence.js";
import type { ProcessorWorkerRequest, ProcessorWorkerResponse } from "./processorWorkerProtocol.js";
import type { Metrics, RppgDebugSnapshot, RppgProcessor, RppgProcessorBackendFailure, RppgTraceSnapshot } from "./rppgProcessor.js";
/** What the session and runner use of a processor; both implementations provide it. */
export type RppgProcessorLike = Pick<RppgProcessor, "enableTracker" | "pushCaptureFrame" | "getCaptureConfidence" | "isBackendFailed" | "getBackendFailure" | "dispose" | "pushSample" | "pushFusedSample" | "pushSampleRgb" | "pushSampleRgbMeta" | "updateMuseMetrics" | "resetCalibration" | "getStateSnapshot" | "loadStateSnapshot" | "getMetrics" | "getDebugSnapshot" | "getTraceSnapshot">;
/** Minimal Worker surface (mockable in tests). */
export type WorkerLike = {
    postMessage(message: ProcessorWorkerRequest): void;
    terminate(): void;
    onmessage: ((event: MessageEvent<ProcessorWorkerResponse>) => void) | null;
    onerror: ((event: unknown) => void) | null;
};
export declare class WorkerRppgProcessor implements RppgProcessorLike {
    private readonly worker;
    private state;
    private captureScorer;
    private lastCapture;
    private disposed;
    constructor(worker: WorkerLike, sampleRate: number, windowSec: number);
    private call;
    enableTracker(minBpm?: number, maxBpm?: number, numParticles?: number): void;
    pushCaptureFrame(sample: CaptureFrameSample, config?: Partial<CaptureConfidenceConfig>): CaptureConfidenceResult;
    getCaptureConfidence(): CaptureConfidenceResult | null;
    isBackendFailed(): boolean;
    getBackendFailure(): RppgProcessorBackendFailure | null;
    dispose(): void;
    pushSample(timestampMs: number, intensity: number): void;
    pushFusedSample(timestampMs: number, fusedValue: number, fusedSnr: number): void;
    pushSampleRgb(timestampMs: number, r: number, g: number, b: number, skinRatio?: number): void;
    pushSampleRgbMeta(...args: Parameters<RppgProcessor["pushSampleRgbMeta"]>): void;
    updateMuseMetrics(bpm: number | null, quality?: number, timestampMs?: number): void;
    resetCalibration(): void;
    getStateSnapshot(): ReturnType<RppgProcessor["getStateSnapshot"]>;
    loadStateSnapshot(snapshot: unknown): void;
    getMetrics(): Metrics;
    getDebugSnapshot(nowMs?: number): RppgDebugSnapshot;
    getTraceSnapshot(maxPoints?: number): RppgTraceSnapshot;
}
/**
 * Starts the analysis worker and waits until it has loaded the WASM core. Returns null (the
 * caller then uses a main-thread processor, exactly as without the option) when workers are
 * unavailable, the worker fails, the core does not load, or it takes over
 * WORKER_READY_TIMEOUT_MS.
 */
export declare function createWorkerRppgProcessor(options: {
    sampleRate: number;
    windowSec: number;
    wasmJsUrl?: string;
    wasmBinaryUrl?: string;
    bpmTrackerConfig?: BpmTrackerConfigV1;
    fixes?: RppgFixesOption;
    createWorker?: () => WorkerLike;
}): Promise<WorkerRppgProcessor | null>;
//# sourceMappingURL=workerRppgProcessor.d.ts.map