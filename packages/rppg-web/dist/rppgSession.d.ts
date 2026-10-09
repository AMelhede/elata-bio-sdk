import type { FrameSource } from "./frameSource.js";
import { type FaceLandmarkerLike } from "./mediapipeLoader.js";
import { PulseCheck, type PulseCheckRules, type PulseCheckState, type ResolvedPulseCheckRules } from "./pulseCheck.js";
import { ChestMotion, type ChestSample } from "./chestBreathing.js";
import { type ResolvedRppgFixSwitches } from "./fixSwitches.js";
import { type Metrics, type RppgDebugIssueCode, type RppgDebugSnapshot, type RppgProcessorBackendFailure, type RppgTraceSnapshot } from "./rppgProcessor.js";
import { type WasmImporter } from "./wasmBackend.js";
import { DemoRunner, type DemoRunnerDiagnostics, type DemoRunnerOptions } from "./demoRunner.js";
import type { BpmEvidenceQualityProvider, BpmTrackerConfigV1 } from "./bpmBayesTracker.js";
import type { RppgModelDiagnosticsV1, WaveformReconstructionV1, WaveformReconstructor } from "./waveformModel.js";
import { WaveformReconstructionController } from "./waveformReconstructionController.js";
import { type RppgProcessorLike } from "./workerRppgProcessor.js";
export type RppgSessionBackendPreference = "auto" | "wasm";
export type RppgSessionBackendMode = "wasm" | "unavailable";
export type RppgSessionFaceTrackingMode = "face_mesh" | "video_frame";
export type RppgSessionIssueCode = RppgDebugIssueCode | "backend_unavailable" | "face_mesh_unavailable" | "processor_failed";
export type RppgSessionErrorCode = "backend_init_failed" | "face_mesh_init_failed" | "capture_error" | "processor_error";
export type RppgSessionStateStatus = "running" | "degraded" | "failed";
export type RppgSessionStatePhase = "none" | "startup" | "runtime";
export type RppgSessionStateReason = RppgSessionIssueCode | RppgSessionErrorCode | null;
export type RppgSessionError = {
    code: RppgSessionErrorCode;
    stage: "backend" | "face_mesh" | "capture" | "processor";
    message: string;
    timestampMs: number;
    cause?: unknown;
};
export type RppgSessionState = {
    status: RppgSessionStateStatus;
    phase: RppgSessionStatePhase;
    terminal: boolean;
    reason: RppgSessionStateReason;
    errorCode: RppgSessionErrorCode | null;
    errorStage: RppgSessionError["stage"] | null;
};
export type RppgSessionDiagnostics = DemoRunnerDiagnostics & {
    backendMode: RppgSessionBackendMode;
    estimationAvailable: boolean;
    faceTrackingMode: RppgSessionFaceTrackingMode;
    roiSource: DemoRunnerDiagnostics["lastRoiSource"];
    processorMethod: DemoRunnerDiagnostics["lastProcessorMethod"];
    totalSamplesReceived: number;
    windowSampleCount: number;
    windowDurationMs: number;
    lastSampleTimestampMs: number | null;
    lastSampleAgeMs: number | null;
    lastSample: RppgDebugSnapshot["lastSample"];
    processorIssues: RppgDebugIssueCode[];
    issues: RppgSessionIssueCode[];
    processorFailure: RppgProcessorBackendFailure | null;
    state: RppgSessionState;
    lastError: RppgSessionError | null;
    modelDiagnostics?: RppgModelDiagnosticsV1 | null;
};
export type CreateRppgSessionOptions = Omit<DemoRunnerOptions, "onDiagnostics" | "onError" | "pulseChecker" | "chestMotion"> & {
    video: HTMLVideoElement;
    /**
     * The real-pulse check (see pulseCheck.ts). ON by default in this test build. A heart rate
     * is reported only while the check has proven a real pulse (the forehead and both cheeks
     * agree on one rate, clearly above the noise, over 8 one-second windows, and the newest
     * 8 seconds still back it), and the reported rate is the one the check measured. HRV and
     * breathing are withheld while it is on. `false`: the SDK's own rate, as published, with
     * the fixes set by `fixes`. It needs face tracking: with `faceMesh: "off"` (or when the face
     * finder failed to load) there are no face regions to check, so no heart rate is reported.
     */
    pulseCheck?: boolean;
    /**
     * With `pulseCheck`, the light rules it runs, each on unless set to false (PulseCheckRules in
     * pulseCheck.ts). For testing one rule at a time; leave out in an app.
     */
    pulseCheckRules?: PulseCheckRules;
    /**
     * With `pulseCheck`, also report the SDK's own rate when it agrees with the check's window
     * rate for 8 seconds running (agreementRate in pulseCheckCore.ts). Off by default: a small
     * gain on new recordings, kept opt-in.
     */
    pulseCheckAgreement?: boolean;
    /**
     * Experimental, off by default. Also read the breathing rate from the motion of the chest and
     * shoulders in a box below the chin (chestBreathing.ts), shown by `getChestBreathing()`. It is
     * separate from the metrics' `respiration_rate`, which stays withheld with the pulse check on.
     * Measured so far only on recorded captures against a finger-sensor breathing reference.
     */
    chestBreathing?: boolean;
    /**
     * Experimental, off by default. Hands over HRV and breathing in their own box,
     * `getExperimentalVitals()`, labelled experimental, for research and testing, not for showing a
     * person as a measurement. HRV has not passed a check against a reference: against an ECG it read
     * several times too high. Breathing comes from chest motion (as `chestBreathing`, which this
     * option does not turn on); it has so far been checked only on still people against a reference
     * worked out from a finger sensor, not a breathing belt. HRV comes only while the session reports
     * a heart rate the pulse check proved, from the session's latest `getMetrics()` read, and not
     * while the analysis may still hold samples from before the face last came back. With the pulse
     * check on, the session's own reads (`getMetrics()`, `getDebugSnapshot()`) withhold HRV and
     * breathing whether this option is on or off; `session.processor`, the raw engine, is not filtered.
     */
    experimentalVitals?: boolean;
    bpmTrackerConfig?: BpmTrackerConfigV1;
    bpmEvidenceQualityProvider?: BpmEvidenceQualityProvider;
    experimental?: {
        waveformReconstructor: WaveformReconstructor;
        inferenceIntervalMs?: number;
        /** Reserved for later validation; reconstructed BPM evidence is disabled. */
        useReconstructedBpmEvidence?: false;
    };
    /**
     * Run the heart-rate analysis in a Web Worker, so it never blocks the camera frames (see
     * workerRppgProcessor.ts). Defaults to the `analysisWorker` fix switch. Falls back to the main thread, exactly as
     * without the option, when workers are unavailable, the worker cannot load the WASM core,
     * or a function option is set that cannot cross to a worker (wasmImporter,
     * bpmEvidenceQualityProvider).
     */
    analysisWorker?: boolean;
    sampleRate?: number;
    windowSec?: number;
    backend?: RppgSessionBackendPreference;
    /**
     * Face ROI mode.
     * - `"off"` — uses the full video frame as the ROI. No MediaPipe dependency,
     *   no extra download. Good enough when the face fills most of the frame.
     *   Best choice for quick integration or when minimizing bundle size.
     * - `"auto"` — loads MediaPipe FaceMesh (~3 MB) for a tighter face-crop ROI,
     *   which improves signal quality when the user moves or is smaller in frame.
     *   Falls back to `"off"` (video_frame mode) silently if MediaPipe fails to
     *   load. Check `diagnostics.faceTrackingMode` to confirm which mode is
     *   active: `"face_mesh"` means MediaPipe loaded; `"video_frame"` means it
     *   fell back.
     * - A `FaceLandmarkerLike` instance — bring your own pre-loaded FaceLandmarker.
     */
    faceMesh?: FaceLandmarkerLike | "auto" | "off";
    ensureVideoPlayback?: boolean;
    videoPlaybackTimeoutMs?: number;
    enableTracker?: boolean | {
        minBpm?: number;
        maxBpm?: number;
        numParticles?: number;
    };
    /**
     * Whether to start the session immediately after creation. Defaults to `true`.
     * Pass `false` to defer capture until you call `session.start()` manually —
     * useful when you want to show UI or request permissions before capture begins.
     */
    autoStart?: boolean;
    /**
     * URL of the wasm-bindgen JS glue file to load.
     * Defaults to `/pkg/rppg_wasm.js` and falls back to `/rppg_wasm.js`.
     * In a Vite app, use a `?url` import to avoid public-directory restrictions:
     * `import url from "@elata-biosciences/rppg-web/pkg/rppg_wasm.js?url"`
     */
    wasmJsUrl?: string;
    /**
     * URL of the `.wasm` binary file.
     * Only needed when the wasm-bindgen JS glue cannot infer the binary path
     * automatically (e.g. when using a `?url` import in Vite).
     * `import url from "@elata-biosciences/rppg-web/pkg/rppg_wasm_bg.wasm?url"`
     */
    wasmBinaryUrl?: string;
    /**
     * Custom WASM module importer. Replaces the default `import(url)` call.
     * Use this in Vite (which blocks dynamic imports from `/public`) by
     * statically importing the WASM JS bundle and returning it here:
     * ```ts
     * import * as rppgWasm from "@elata-biosciences/rppg-web/pkg/rppg_wasm.js";
     * wasmImporter: () => Promise.resolve(rppgWasm)
     * ```
     */
    wasmImporter?: WasmImporter;
    onDiagnostics?: (diagnostics: RppgSessionDiagnostics) => void;
    onError?: (error: RppgSessionError) => void;
};
type SessionInternals = {
    onDiagnostics?: (diagnostics: RppgSessionDiagnostics) => void;
    onError?: (error: RppgSessionError) => void;
    backendDegraded?: boolean;
    faceTrackingDegraded?: boolean;
    beforeStart?: () => Promise<void>;
    waveformController?: WaveformReconstructionController;
    pulseCheck?: PulseCheck | null;
    chestMotion?: ChestMotion | null;
    /** The `chestBreathing` option itself (chest motion may also be read for `experimentalVitals`). */
    chestBreathing?: boolean;
    experimentalVitals?: boolean;
};
/** HRV and breathing as `experimentalVitals` hands them over: research outputs, not measurements. */
export type ExperimentalVitals = {
    experimental: true;
    /** RMSSD in ms, while the session reports a proven heart rate (see the option); else null. */
    hrvRmssd: number | null;
    /** Breathing from chest motion, `{ rate, share }` as `getChestBreathing()` gives it; null until its window is covered. */
    breathing: {
        rate: number;
        share: number;
    } | null;
};
/** Whether a session reads chest motion: for `chestBreathing`, and for `experimentalVitals`' breathing. */
export declare function wantsChestMotion(options: {
    chestBreathing?: boolean;
    experimentalVitals?: boolean;
}): boolean;
export declare class RppgSession {
    readonly source: FrameSource;
    readonly processor: RppgProcessorLike;
    readonly runner: DemoRunner;
    readonly backendMode: RppgSessionBackendMode;
    readonly faceTrackingMode: RppgSessionFaceTrackingMode;
    private readonly internals;
    private lastErrorValue;
    /** The engine read behind the latest getMetrics(), before any withholding (for getExperimentalVitals). */
    private lastEngineMetrics;
    constructor(source: FrameSource, processor: RppgProcessorLike, runner: DemoRunner, backendMode: RppgSessionBackendMode, faceTrackingMode: RppgSessionFaceTrackingMode, internals?: SessionInternals);
    get lastError(): RppgSessionError | null;
    get state(): RppgSessionState;
    getMetrics(): Metrics;
    /** State of the real-pulse check; null when `pulseCheck` is off. */
    getPulseCheck(): PulseCheckState | null;
    /**
     * Breathing from chest motion (`chestBreathing`), over the latest 32 s: the rate in breaths a
     * minute and its line's share of the band's power (1 a pure rhythm, near 0 noise). Null when the
     * option is off or the window is not covered yet.
     */
    getChestBreathing(): {
        rate: number;
        share: number;
    } | null;
    /** The chest motion kept (`chestBreathing`), for recording and replay; empty when off. */
    getChestMotionSamples(): readonly ChestSample[];
    /**
     * HRV and breathing for research and testing (`experimentalVitals`), labelled experimental; null
     * when the option is off. Neither is a measurement yet (see the option).
     *
     * HRV is the engine's, from the session's latest `getMetrics()` read (reading the engine again here
     * would run another analysis when steadyAnalysis is off, and move the engine's own rate). It is
     * given only while all of these hold: a face is in view; the pulse check (when on) has proven a
     * pulse and still shows its rate, as `getMetrics()` does (an HRV of something that is not a pulse
     * means nothing); and the engine's window holds no samples from before the face last came back.
     * The runner asks the engine to start afresh then, but neither processor has a `reset()`, so its
     * window keeps the previous face's samples until SAMPLE_HISTORY_MS have passed.
     */
    getExperimentalVitals(): ExperimentalVitals | null;
    /**
     * The face finder's delegate and its trial (faceFinderTrial): which one this device runs on and the
     * mean call time of each tried. Null when the session did not build the finder itself that way.
     */
    getFaceFinder(): {
        delegate: string;
        trial: readonly {
            delegate: string;
            meanMs: number;
        }[];
    } | null;
    /** Which fixes and checks this session runs, for logging results against a build. */
    getBuildSwitches(): {
        fixes: ResolvedRppgFixSwitches;
        pulseCheck: boolean;
        pulseCheckAgreement: boolean;
        pulseCheckRules: ResolvedPulseCheckRules | null;
        chestBreathing: boolean;
        experimentalVitals: boolean;
    };
    /** Latest face blendshapes for affect estimation (null until a face is tracked). */
    getLastBlendshapes(): import("./demoRunner.js").LastBlendshapes | null;
    /** Latest normalized head box for framing guidance (null until a face is tracked). */
    getLastFaceBox(): import("./demoRunner.js").LastFaceBox | null;
    getDebugSnapshot(nowMs?: number): RppgDebugSnapshot;
    getTraceSnapshot(maxPoints?: number): RppgTraceSnapshot;
    getLatestWaveformReconstruction(): WaveformReconstructionV1 | null;
    getModelDiagnostics(): RppgModelDiagnosticsV1 | null;
    getState(): RppgSessionState;
    getDiagnostics(nowMs?: number): RppgSessionDiagnostics;
    start(): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    recordError(error: RppgSessionError): void;
    emitDiagnostics(): void;
}
/**
 * Primary browser entrypoint for the rPPG pipeline: wires camera → ROI → WASM
 * backend → {@link RppgSession}. Configure WASM loading with `wasmImporter` or
 * `wasmJsUrl` / `wasmBinaryUrl` when your bundler cannot resolve default paths.
 */
export declare function createRppgSession(options: CreateRppgSessionOptions): Promise<RppgSession>;
export {};
//# sourceMappingURL=rppgSession.d.ts.map