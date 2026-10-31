import type { LightLevel } from "./lightLevel.js";
import type { FrameSource } from "./frameSource.js";
import { type FaceLandmarkerLike } from "./mediapipeLoader.js";
import { PulseCheck, type PulseCheckRules, type PulseCheckState, type ResolvedPulseCheckRules } from "./pulseCheck.js";
import { type PulseCheckRecording } from "./pulseCheckRecording.js";
import { ChestMotion, type ChestSample } from "./chestBreathing.js";
import { type ResolvedRppgFixSwitches } from "./fixSwitches.js";
import { RppgProcessor, type Metrics, type RppgDebugIssueCode, type RppgDebugSnapshot, type RppgProcessorBackendFailure, type RppgTraceSnapshot } from "./rppgProcessor.js";
import { type WasmImporter } from "./wasmBackend.js";
import { DemoRunner, type DemoRunnerDiagnostics, type DemoRunnerOptions } from "./demoRunner.js";
import type { BpmEvidenceQualityProvider, BpmTrackerConfigV1 } from "./bpmBayesTracker.js";
import type { RppgModelDiagnosticsV1, WaveformReconstructionV1, WaveformReconstructor } from "./waveformModel.js";
import { WaveformReconstructionController } from "./waveformReconstructionController.js";
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
    /**
     * No face has been in view for FACE_GONE_RESET_MS (face tracking on), so `getMetrics()` reports
     * no rate: the moment a status should say no face is in view. A shorter miss (a turned head, a
     * raised hand) leaves it false, as it leaves the rate; `lastDropReason` describes one frame only.
     */
    faceGone: boolean;
    /**
     * No frame has arrived for over FRAME_GAP_MS of wall-clock time while the session runs (fix
     * noFramesNoReading), so `getMetrics()` reports no rate: the moment a status should say the camera
     * has stopped sending (a frozen driver, an ended track, a hidden tab, a locked screen).
     */
    framesStopped: boolean;
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
     * With `pulseCheck`, read the forehead region from 49 small skin patches weighted toward the cleanest
     * (foreheadPool.ts) instead of one box; the cheeks stay boxes. Off unless true. Costs a pixel pass over the
     * forehead patches per frame and one small spectrum per patch per second.
     */
    foreheadPool?: boolean;
    /**
     * With `pulseCheck`, decide how much light the screen should put on the face (lightLevel.ts): `session.light()`
     * gives the level, 0, 1 or 0.5 in linear light, and the app reports what it rendered with `session.reportLight()`.
     * An app that cannot light the screen can ignore it: the reading is unchanged. Off unless true. Costs a pass over
     * every second pixel of the three face region boxes per frame.
     */
    light?: boolean;
    /**
     * With `pulseCheck`, keep what the check is fed (the face regions, the wall, the head, a lost face)
     * and every `getMetrics()` read, so the check
     * can be replayed offline with any rules (`replayPulseCheck`): `session.getPulseCheckRecording()`.
     * Off by default. `true` keeps the newest PULSE_CHECK_RECORDING_SECONDS (5 minutes); `{ seconds }`
     * sets that. `{ facePatches: true }` also keeps the 115 skin patches of every frame (facePatches.ts), so a finer
     * or steadier face region can be scored offline on the same seconds; it costs a little time per frame and about
     * 3 kB per frame in the file. Recording changes no output; see pulseCheckRecording.ts for the format and the memory bound.
     */
    recordPulseCheckInputs?: boolean | {
        seconds?: number;
        facePatches?: boolean;
    };
    /**
     * Experimental, off by default. Hands over HRV and breathing in their own box,
     * `getExperimentalVitals()`, labelled experimental, for research and testing, not for showing a
     * person as a measurement. HRV has not passed a check against a reference: against an ECG it read
     * several times too high. Breathing comes from the up-and-down motion of the chest and shoulders
     * in a box below the chin (chestBreathing.ts), not from the metrics' `respiration_rate`; it has so
     * far been checked only on still people against a reference
     * worked out from a finger sensor, not a breathing belt. HRV comes only while a face is in view and
     * not while the analysis may still hold samples from before the face last came back; with the
     * pulse check on, also only while the session reports a heart rate the check proved, from the
     * session's latest `getMetrics()` read. With `pulseCheck: false` it is the engine's own HRV, handed
     * over whether or not a heart rate is reported. With the pulse
     * check on, the session's own reads (`getMetrics()`, `getDebugSnapshot()`) withhold HRV and
     * breathing whether this option is on or off; `session.processor`, the raw engine, is not filtered, but with the
     * pulse check on it does not estimate breathing at all (its `respiration_rate` stays null), since no read hands it over.
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
    experimentalVitals?: boolean;
    foreheadPool?: boolean;
    light?: boolean;
};
/** HRV and breathing as `experimentalVitals` hands them over: research outputs, not measurements. */
export type ExperimentalVitals = {
    experimental: true;
    /**
     * RMSSD in ms under the conditions on the `experimentalVitals` option (with the pulse check on, only
     * while the session reports a proven heart rate; with it off, the engine's own HRV); else null.
     */
    hrvRmssd: number | null;
    /**
     * Breathing from chest motion over the latest 32 s: `rate` in breaths a minute, and `share`, its
     * line's share of the band's power (1 a pure rhythm, near 0 noise). Null until the window is covered.
     */
    breathing: {
        rate: number;
        share: number;
    } | null;
};
/** Whether a session reads chest motion: only for `experimentalVitals`' breathing. */
export declare function wantsChestMotion(options: {
    experimentalVitals?: boolean;
}): boolean;
export declare class RppgSession {
    readonly source: FrameSource;
    readonly processor: RppgProcessor;
    readonly runner: DemoRunner;
    readonly backendMode: RppgSessionBackendMode;
    readonly faceTrackingMode: RppgSessionFaceTrackingMode;
    private readonly internals;
    private lastErrorValue;
    /** The engine read behind the latest getMetrics(), before any withholding (for getExperimentalVitals). */
    private lastEngineMetrics;
    constructor(source: FrameSource, processor: RppgProcessor, runner: DemoRunner, backendMode: RppgSessionBackendMode, faceTrackingMode: RppgSessionFaceTrackingMode, internals?: SessionInternals);
    get lastError(): RppgSessionError | null;
    get state(): RppgSessionState;
    getMetrics(): Metrics;
    /** With `recordPulseCheckInputs`, files this read with the check's inputs; returns the metrics unchanged. */
    private noteRead;
    /**
     * What the pulse check was fed, and every `getMetrics()` read, for replay with `replayPulseCheck`
     * (`recordPulseCheckInputs`); a copy, the newest events within the recording's bound. Null when the
     * option or the check is off.
     */
    getPulseCheckRecording(): PulseCheckRecording | null;
    /**
     * Switch `light`: the level the screen should light the face at (0, 1 or 0.5, linear light) and the face light it
     * was decided from; level 0 and nulls when the switch is off.
     */
    light(): {
        level: LightLevel;
        faceLuma: number | null;
        faceRedClip: number | null;
    };
    /** Switch `light`: the level the app actually rendered. Report every change; an app that cannot light never calls it. */
    reportLight(applied: LightLevel): void;
    /** State of the real-pulse check; null when `pulseCheck` is off. */
    getPulseCheck(): PulseCheckState | null;
    /** The chest motion kept (`experimentalVitals`), for recording and replay; empty when off. */
    getChestMotionSamples(): readonly ChestSample[];
    /**
     * HRV and breathing for research and testing (`experimentalVitals`), labelled experimental; null
     * when the option is off. Neither is a measurement yet (see the option).
     *
     * HRV is the engine's, from the session's latest `getMetrics()` read (reading the engine again here
     * would run another analysis, and move the engine's own rate). It is
     * given only while all of these hold: a face is in view; the pulse check (when on) has proven a
     * pulse and still shows its rate, as `getMetrics()` does (an HRV of something that is not a pulse
     * means nothing). The engine's window holds no samples from before the face last came back: the
     * runner starts the engine's signal afresh then (`resetSignal()`).
     */
    getExperimentalVitals(): ExperimentalVitals | null;
    /** Which fixes and checks this session runs, for logging results against a build. */
    getBuildSwitches(): {
        fixes: ResolvedRppgFixSwitches;
        pulseCheck: boolean;
        pulseCheckRules: ResolvedPulseCheckRules | null;
        experimentalVitals: boolean;
        foreheadPool: boolean;
        light: boolean;
    };
    /** Latest face blendshapes for affect estimation (null until a face is tracked). */
    getLastBlendshapes(): import("./demoRunner.js").LastBlendshapes | null;
    /** Latest normalized head box for framing guidance (null until a face is tracked). */
    getLastFaceBox(): import("./demoRunner.js").LastFaceBox | null;
    getDebugSnapshot(nowMs?: number): RppgDebugSnapshot;
    getTraceSnapshot(maxPoints?: number): RppgTraceSnapshot;
    getLatestWaveformReconstruction(): WaveformReconstructionV1 | null;
    getModelDiagnostics(): RppgModelDiagnosticsV1 | null;
    /**
     * No frame has arrived for over FRAME_GAP_MS by the wall clock while the session runs (fix
     * noFramesNoReading): what `getMetrics()` reports as `no_frames`. Cheap; it runs no analysis.
     */
    framesStopped(): boolean;
    /** The engine threw (the runner stops on that): the session can report nothing more. */
    private failed;
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
/**
 * The pulse check a session runs with these options: none with `pulseCheck: false`; one that also
 * records its inputs with `recordPulseCheckInputs` (RecordingPulseCheck); else a plain PulseCheck,
 * so with recording off the session runs exactly the check it ran before the option existed.
 */
export declare function sessionPulseCheck(options: Pick<CreateRppgSessionOptions, "pulseCheck" | "pulseCheckRules" | "recordPulseCheckInputs" | "foreheadPool">): PulseCheck | null;
export {};
//# sourceMappingURL=rppgSession.d.ts.map