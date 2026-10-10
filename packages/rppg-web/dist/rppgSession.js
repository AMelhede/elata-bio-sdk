import { MediaPipeFaceFrameSource } from "./mediaPipeFaceFrameSource.js";
import { MediaPipeFrameSource } from "./mediaPipeFrameSource.js";
import { loadFaceLandmarker, loadTrialFaceFinder } from "./mediapipeLoader.js";
import { PulseCheck, } from "./pulseCheck.js";
import { ChestMotion } from "./chestBreathing.js";
import { TrialFaceFinder } from "./faceFinderTrial.js";
import { resolveFixSwitches, } from "./fixSwitches.js";
import { ensureVideoPlaying } from "./videoPlayback.js";
import { RppgProcessor, } from "./rppgProcessor.js";
import { loadWasmBackend, createUnavailableBackend, } from "./wasmBackend.js";
import { DemoRunner, FACE_GONE_RESET_MS, } from "./demoRunner.js";
import { WaveformFeatureWindowBuilder } from "./waveformFeatureWindow.js";
import { WaveformReconstructionController } from "./waveformReconstructionController.js";
import { createWorkerRppgProcessor, WorkerRppgProcessor, } from "./workerRppgProcessor.js";
/** Whether a session reads chest motion: only for `experimentalVitals`' breathing. */
export function wantsChestMotion(options) {
    return options.experimentalVitals === true;
}
const WITHHELD_VITALS = {
    hrv_rmssd: null,
    respiration_rate: null,
    respiration_confidence: null,
};
/**
 * Metrics with every rate cleared, not only the headline one (the intermediate estimates, spectral,
 * ACF, peaks, Bayes, calibrated, would otherwise keep reporting numbers from before), and HRV and
 * breathing with them; `reason` says why.
 */
function clearedMetrics(metrics, reason) {
    const cleared = { ...metrics };
    for (const key of Object.keys(cleared)) {
        if (key.endsWith("_bpm"))
            cleared[key] = null;
    }
    return {
        ...cleared,
        bpm: null,
        confidence: 0,
        hrv_rmssd: null,
        respiration_rate: null,
        respiration_confidence: null,
        reason_codes: metrics.reason_codes?.includes(reason) || (reason === "processor_failed" && metrics.reason_codes?.includes("backend_failed"))
            ? metrics.reason_codes
            : [...(metrics.reason_codes ?? []), reason],
    };
}
export class RppgSession {
    constructor(source, processor, runner, backendMode, faceTrackingMode, internals = {}) {
        this.source = source;
        this.processor = processor;
        this.runner = runner;
        this.backendMode = backendMode;
        this.faceTrackingMode = faceTrackingMode;
        this.internals = internals;
        this.lastErrorValue = null;
        /** The engine read behind the latest getMetrics(), before any withholding (for getExperimentalVitals). */
        this.lastEngineMetrics = null;
    }
    get lastError() {
        return this.lastErrorValue;
    }
    get state() {
        return this.getState();
    }
    getMetrics() {
        const metrics = this.processor.getMetrics();
        this.lastEngineMetrics = metrics;
        // The engine failed: the runner has stopped, so no frame reaches the engine or the pulse
        // check again and both keep their last state. Their last numbers are not a reading.
        if (this.failed())
            return clearedMetrics(metrics, "processor_failed");
        // No face for a second (face tracking on): nothing to report, not the last number.
        // One second rides out a brief face-finder miss without dropping a real reading.
        if ((this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS)
            return clearedMetrics(metrics, "no_face");
        const check = this.internals.pulseCheck;
        if (!check)
            return metrics;
        // With the check on, the only number reported is the heart rate the check proved, or none.
        // Breathing rate and HRV are withheld always: neither yet passes a known answer, even with
        // the pulse proven (synthetic face, rate proven at 70, no breathing in the video: breathing
        // read 14 to 21 in 42 of 42 seconds). Each comes back when it has a check of its own.
        const state = check.getState();
        return {
            ...metrics,
            bpm: state.verdict === "measured" ? state.bpm : null,
            hrv_rmssd: null,
            respiration_rate: null,
            respiration_confidence: null,
        };
    }
    /** State of the real-pulse check; null when `pulseCheck` is off. */
    getPulseCheck() {
        return this.internals.pulseCheck?.getState() ?? null;
    }
    /** The chest motion kept (`experimentalVitals`), for recording and replay; empty when off. */
    getChestMotionSamples() {
        return this.internals.chestMotion?.getSamples() ?? [];
    }
    /**
     * HRV and breathing for research and testing (`experimentalVitals`), labelled experimental; null
     * when the option is off. Neither is a measurement yet (see the option).
     *
     * HRV is the engine's, from the session's latest `getMetrics()` read (reading the engine again here
     * would run another analysis when steadyAnalysis is off, and move the engine's own rate). It is
     * given only while all of these hold: a face is in view; the pulse check (when on) has proven a
     * pulse and still shows its rate, as `getMetrics()` does (an HRV of something that is not a pulse
     * means nothing). The engine's window holds no samples from before the face last came back: the
     * runner starts the engine's signal afresh then (`resetSignal()`).
     */
    getExperimentalVitals() {
        if (!this.internals.experimentalVitals)
            return null;
        const faceGone = this.failed() || (this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS;
        const state = this.internals.pulseCheck?.getState();
        const proven = !state || (state.verdict === "measured" && state.bpm != null);
        const hrv = this.lastEngineMetrics?.hrv_rmssd;
        return {
            experimental: true,
            hrvRmssd: !faceGone && proven && Number.isFinite(hrv)
                ? hrv
                : null,
            breathing: this.internals.chestMotion?.rate() ?? null,
        };
    }
    /**
     * The face finder's delegate and its trial (faceFinderTrial): which one this device runs on and the
     * mean call time of each tried. Null when the session did not build the finder itself that way.
     */
    getFaceFinder() {
        const f = this.source?.faceLandmarker;
        return f instanceof TrialFaceFinder ? { delegate: f.delegate, trial: f.trialResults } : null;
    }
    /** Which fixes and checks this session runs, for logging results against a build. */
    getBuildSwitches() {
        const fixes = this.runner.fixes ??
            resolveFixSwitches();
        const procFixes = this.processor
            .fixes;
        const srcFixes = this.source
            ?.fixes;
        return {
            fixes: {
                ...fixes,
                colourProjectionFix: procFixes?.colourProjectionFix ?? fixes.colourProjectionFix,
                noRateDoubling: procFixes?.noRateDoubling ?? fixes.noRateDoubling,
                analysisWidth: srcFixes?.analysisWidth ?? fixes.analysisWidth,
                analysisWorker: this.processor instanceof WorkerRppgProcessor,
            },
            pulseCheck: this.internals.pulseCheck != null,
            pulseCheckAgreement: this.internals.pulseCheck?.agreementOn === true,
            pulseCheckRules: this.internals.pulseCheck?.rules ?? null,
            experimentalVitals: this.internals.experimentalVitals === true,
        };
    }
    /** Latest face blendshapes for affect estimation (null until a face is tracked). */
    getLastBlendshapes() {
        return this.runner.getLastBlendshapes();
    }
    /** Latest normalized head box for framing guidance (null until a face is tracked). */
    getLastFaceBox() {
        return this.runner.getLastFaceBox();
    }
    getDebugSnapshot(nowMs = Date.now()) {
        const snapshot = this.processor.getDebugSnapshot(nowMs);
        // With the pulse check on, HRV and breathing are withheld here too, as in getMetrics: a debug
        // feed an app displays is a screen like any other. Of the session's reads, experimentalVitals is
        // their one way out.
        if (!this.internals.pulseCheck)
            return snapshot;
        return {
            ...snapshot,
            backendMetrics: { ...snapshot.backendMetrics, ...WITHHELD_VITALS },
        };
    }
    getTraceSnapshot(maxPoints = 300) {
        return this.processor.getTraceSnapshot(maxPoints);
    }
    getLatestWaveformReconstruction() {
        return this.internals.waveformController?.getLatest() ?? null;
    }
    getModelDiagnostics() {
        return this.internals.waveformController?.getDiagnostics() ?? null;
    }
    /** The engine threw (the runner stops on that): the session can report nothing more. */
    failed() {
        return (this.processor.getBackendFailure?.() != null ||
            this.lastErrorValue?.code === "processor_error");
    }
    getState() {
        const lastError = this.lastErrorValue;
        const terminal = this.failed();
        if (terminal) {
            return {
                status: "failed",
                phase: "runtime",
                terminal: true,
                reason: lastError?.code ?? "processor_failed",
                errorCode: lastError?.code ?? "processor_error",
                errorStage: lastError?.stage ?? "processor",
            };
        }
        if (lastError) {
            const startupFailure = lastError.code === "backend_init_failed" ||
                lastError.code === "face_mesh_init_failed";
            return {
                status: "degraded",
                phase: startupFailure ? "startup" : "runtime",
                terminal: false,
                reason: lastError.code,
                errorCode: lastError.code,
                errorStage: lastError.stage,
            };
        }
        if (this.internals.backendDegraded) {
            return {
                status: "degraded",
                phase: "startup",
                terminal: false,
                reason: "backend_unavailable",
                errorCode: null,
                errorStage: null,
            };
        }
        if (this.internals.faceTrackingDegraded) {
            return {
                status: "degraded",
                phase: "startup",
                terminal: false,
                reason: "face_mesh_unavailable",
                errorCode: null,
                errorStage: null,
            };
        }
        return {
            status: "running",
            phase: "none",
            terminal: false,
            reason: null,
            errorCode: null,
            errorStage: null,
        };
    }
    getDiagnostics(nowMs = Date.now()) {
        const runnerDiagnostics = this.runner.getDiagnostics();
        const debugSnapshot = this.processor.getDebugSnapshot(nowMs);
        const processorFailure = this.processor.getBackendFailure();
        const state = this.getState();
        const issues = new Set(debugSnapshot.issues);
        if (this.internals.backendDegraded)
            issues.add("backend_unavailable");
        if (this.internals.faceTrackingDegraded)
            issues.add("face_mesh_unavailable");
        if (state.status === "failed")
            issues.add("processor_failed");
        return {
            ...runnerDiagnostics,
            backendMode: this.backendMode,
            estimationAvailable: this.backendMode === "wasm" && processorFailure == null,
            faceTrackingMode: this.faceTrackingMode,
            roiSource: runnerDiagnostics.lastRoiSource,
            processorMethod: runnerDiagnostics.lastProcessorMethod,
            totalSamplesReceived: debugSnapshot.totalSamplesReceived,
            windowSampleCount: debugSnapshot.windowSampleCount,
            windowDurationMs: debugSnapshot.windowDurationMs,
            lastSampleTimestampMs: debugSnapshot.lastSampleTimestampMs,
            lastSampleAgeMs: debugSnapshot.lastSampleAgeMs,
            lastSample: debugSnapshot.lastSample,
            processorIssues: debugSnapshot.issues,
            issues: Array.from(issues),
            processorFailure,
            state,
            lastError: this.lastErrorValue,
            faceGone: (this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS,
            modelDiagnostics: this.getModelDiagnostics(),
        };
    }
    async start() {
        await this.internals.beforeStart?.();
        await this.runner.start();
        this.emitDiagnostics();
    }
    async stop() {
        await this.runner.stop();
        await this.internals.waveformController?.stop();
        this.emitDiagnostics();
    }
    async dispose() {
        await this.stop();
        await this.internals.waveformController?.dispose();
        this.processor.dispose();
    }
    recordError(error) {
        if (this.lastErrorValue?.code === "processor_error") {
            return;
        }
        this.lastErrorValue = error;
        this.internals.onError?.(error);
        this.emitDiagnostics();
    }
    emitDiagnostics() {
        this.internals.onDiagnostics?.(this.getDiagnostics());
    }
}
/**
 * Primary browser entrypoint for the rPPG pipeline: wires camera → ROI → WASM
 * backend → {@link RppgSession}. Configure WASM loading with `wasmImporter` or
 * `wasmJsUrl` / `wasmBinaryUrl` when your bundler cannot resolve default paths.
 */
export async function createRppgSession(options) {
    const sampleRate = options.sampleRate ?? 30;
    const windowSec = options.windowSec ?? 10;
    const backendPreference = options.backend ?? "auto";
    const enableTracker = options.enableTracker ?? true;
    const pendingErrors = [];
    const faceMeshResult = await resolveFaceMesh(options.faceMesh, resolveFixSwitches(options.fixes).faceFinderTrial);
    if (faceMeshResult.error)
        pendingErrors.push(faceMeshResult.error);
    const faceTrackingMode = faceMeshResult.faceMesh
        ? "face_mesh"
        : "video_frame";
    const source = faceMeshResult.faceMesh
        ? new MediaPipeFaceFrameSource(options.video, faceMeshResult.faceMesh, sampleRate, options.roiGeometryProfile, options.fixes)
        : new MediaPipeFrameSource(options.video, { fps: sampleRate });
    const workerProcessor = (options.analysisWorker ??
        resolveFixSwitches(options.fixes).analysisWorker) &&
        !options.wasmImporter &&
        !options.bpmEvidenceQualityProvider
        ? await createWorkerRppgProcessor({
            sampleRate,
            windowSec,
            wasmJsUrl: options.wasmJsUrl,
            wasmBinaryUrl: options.wasmBinaryUrl,
            bpmTrackerConfig: options.bpmTrackerConfig,
            fixes: options.fixes,
        })
        : null;
    const backendResult = workerProcessor
        ? { mode: "wasm" }
        : await resolveBackend(backendPreference, {
            wasmJsUrl: options.wasmJsUrl,
            wasmBinaryUrl: options.wasmBinaryUrl,
            wasmImporter: options.wasmImporter,
        });
    if ("error" in backendResult && backendResult.error)
        pendingErrors.push(backendResult.error);
    const processor = workerProcessor ??
        new RppgProcessor(backendResult.backend, sampleRate, windowSec, {
            bpmTrackerConfig: options.bpmTrackerConfig,
            bpmEvidenceQualityProvider: options.bpmEvidenceQualityProvider,
            fixes: options.fixes,
        });
    applyTrackerConfiguration(processor, enableTracker);
    let session = null;
    const waveformBuilder = options.experimental
        ? new WaveformFeatureWindowBuilder()
        : null;
    const waveformController = options.experimental
        ? new WaveformReconstructionController(options.experimental.waveformReconstructor, options.experimental.inferenceIntervalMs)
        : undefined;
    const pulseCheck = options.pulseCheck !== false
        ? new PulseCheck({
            agreement: options.pulseCheckAgreement === true,
            rules: options.pulseCheckRules,
        })
        : null;
    const chestMotion = wantsChestMotion(options) ? new ChestMotion() : null;
    const runner = new DemoRunner(source, processor, {
        fixes: options.fixes,
        pulseChecker: pulseCheck,
        chestMotion,
        roi: options.roi,
        roiGeometryProfile: options.roiGeometryProfile,
        sampleRate,
        roiSmoothingAlpha: options.roiSmoothingAlpha ?? 0.25,
        useSkinMask: options.useSkinMask ?? true,
        multiRoiFusion: options.multiRoiFusion,
        requireFace: faceTrackingMode === "face_mesh" && options.roi === undefined,
        fusionProjection: options.fusionProjection,
        roiPixelSampler: options.roiPixelSampler,
        onRoiSamples: (samples) => {
            options.onRoiSamples?.(samples);
            if (!waveformBuilder || !waveformController || !options.experimental)
                return;
            for (const sample of samples)
                waveformBuilder.push(sample);
            const manifest = options.experimental.waveformReconstructor.manifest;
            const window = waveformBuilder.build({
                profileId: manifest.input.profileId,
                channels: manifest.input.channels,
                length: manifest.input.length,
            });
            if (window) {
                waveformController.offer(window);
            }
            else {
                waveformController.reportInputUnavailable(waveformBuilder.lastFailureReason ?? "insufficient_window", waveformBuilder.sampleCount);
            }
        },
        onStats: options.onStats,
        skinRatioSmoothingAlpha: options.skinRatioSmoothingAlpha,
        onDiagnostics: () => {
            session?.emitDiagnostics();
        },
        onError: (error) => {
            session?.recordError({
                code: "processor_error",
                stage: "processor",
                message: error.message,
                timestampMs: error.timestampMs,
                cause: error.cause,
            });
        },
    });
    session = new RppgSession(source, processor, runner, backendResult.mode, faceTrackingMode, {
        onDiagnostics: options.onDiagnostics,
        onError: options.onError,
        pulseCheck,
        chestMotion,
        experimentalVitals: options.experimentalVitals === true,
        backendDegraded: backendResult.mode !== "wasm",
        faceTrackingDegraded: faceMeshResult.error != null,
        waveformController,
        beforeStart: async () => {
            await waveformController?.init();
            if (options.ensureVideoPlayback !== false) {
                await ensureVideoPlaying(options.video, {
                    timeoutMs: options.videoPlaybackTimeoutMs,
                });
            }
        },
    });
    attachSourceErrorForwarder(source, session);
    for (const error of pendingErrors) {
        session.recordError(error);
    }
    if (options.autoStart !== false) {
        await session.start();
    }
    return session;
}
async function resolveFaceMesh(faceMeshOption, delegateTrial = false) {
    if (faceMeshOption && faceMeshOption !== "auto" && faceMeshOption !== "off") {
        return { faceMesh: faceMeshOption, error: null };
    }
    if (faceMeshOption === "off") {
        return { faceMesh: null, error: null };
    }
    try {
        // faceFinderTrial: the faster delegate for this device, timed on the live video (faceFinderTrial.ts).
        const faceMesh = delegateTrial ? await loadTrialFaceFinder() : await loadFaceLandmarker();
        return { faceMesh, error: null };
    }
    catch (cause) {
        return {
            faceMesh: null,
            error: {
                code: "face_mesh_init_failed",
                stage: "face_mesh",
                message: cause instanceof Error
                    ? cause.message
                    : "FaceMesh failed to initialize.",
                timestampMs: Date.now(),
                cause,
            },
        };
    }
}
async function resolveBackend(backendPreference, options) {
    // Always load strictly, so the reason it failed is kept. "auto" still falls back to a backend
    // that reads nothing, but now says why through onError: before, a bundler that could not serve
    // the WASM gave a session that ran, found a face and never produced a number, with no error.
    try {
        const backend = await loadWasmBackend(options.wasmImporter, {
            strict: true,
            jsUrl: options.wasmJsUrl,
            binaryUrl: options.wasmBinaryUrl,
        });
        if (backend)
            return { backend, mode: "wasm" };
        throw new Error("rPPG WASM backend loaded no pipeline.");
    }
    catch (cause) {
        if (backendPreference === "wasm")
            throw cause;
        return {
            backend: createUnavailableBackend(),
            mode: "unavailable",
            error: {
                code: "backend_init_failed",
                stage: "backend",
                message: cause instanceof Error
                    ? cause.message
                    : "rPPG WASM backend failed to load.",
                timestampMs: Date.now(),
                cause,
            },
        };
    }
}
function applyTrackerConfiguration(processor, enableTracker) {
    if (!enableTracker)
        return;
    if (enableTracker === true) {
        processor.enableTracker(55, 150, 200);
        return;
    }
    processor.enableTracker(enableTracker.minBpm ?? 55, enableTracker.maxBpm ?? 150, enableTracker.numParticles ?? 200);
}
function attachSourceErrorForwarder(source, session) {
    const errorSource = source;
    if (typeof errorSource.getLastError !== "function")
        return;
    errorSource.onError = (error) => {
        session.recordError({
            code: error.stage === "face_mesh" ? "face_mesh_init_failed" : "capture_error",
            stage: error.stage,
            message: error.message,
            timestampMs: error.timestampMs,
            cause: error.cause,
        });
    };
}
