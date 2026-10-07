/**
 * Messages between the main thread and the analysis worker (see workerRppgProcessor.ts).
 *
 * The main thread sends every sample and every setting; the worker runs the unchanged
 * RppgProcessor and, at most once per ANALYSIS_EVERY_MS of sample time, sends back what a
 * caller can ask for. Only plain data crosses: functions cannot be posted to a worker.
 */
import type { BpmTrackerConfigV1 } from "./bpmBayesTracker.js";
import type { RppgFixesOption } from "./fixSwitches.js";
import type { Metrics, RppgDebugSnapshot, RppgProcessorBackendFailure, RppgTraceSnapshot } from "./rppgProcessor.js";
/**
 * The worker answers at most once per this much SAMPLE time; reads in between return its last
 * answer. A heartbeat is about 1 s and a display updates about once a second, so 4 answers a
 * second lose nothing, and the main thread is not flooded with state messages.
 */
export declare const ANALYSIS_EVERY_MS = 250;
/** Processor methods the worker accepts from the main thread. */
export type ProcessorWorkerMethod = "pushSample" | "pushFusedSample" | "pushSampleRgb" | "pushSampleRgbMeta" | "pushCaptureFrame" | "enableTracker" | "updateMuseMetrics" | "resetCalibration" | "loadStateSnapshot";
export type ProcessorWorkerRequest = {
    type: "init";
    sampleRate: number;
    windowSec: number;
    wasmJsUrl?: string;
    wasmBinaryUrl?: string;
    bpmTrackerConfig?: BpmTrackerConfigV1;
    fixes?: RppgFixesOption;
} | {
    type: "call";
    method: ProcessorWorkerMethod;
    args: unknown[];
} | {
    type: "dispose";
};
/** Everything a caller can read, as of the worker's latest analysis. */
export type ProcessorWorkerState = {
    metrics: Metrics;
    debug: RppgDebugSnapshot;
    trace: RppgTraceSnapshot;
    backendFailure: RppgProcessorBackendFailure | null;
    stateSnapshot: unknown;
};
export type ProcessorWorkerResponse = {
    type: "ready";
    mode: "wasm" | "unavailable";
} | {
    type: "state";
    state: ProcessorWorkerState;
} | {
    type: "error";
    message: string;
};
//# sourceMappingURL=processorWorkerProtocol.d.ts.map