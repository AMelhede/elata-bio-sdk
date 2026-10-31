import { MediaPipeFaceFrameSource } from "./mediaPipeFaceFrameSource.js";
import { MediaPipeFrameSource } from "./mediaPipeFrameSource.js";
import { loadFaceLandmarker } from "./mediapipeLoader.js";
import { PulseCheck, shownPulseBpm, } from "./pulseCheck.js";
import { RecordingPulseCheck, } from "./pulseCheckRecording.js";
import { ChestMotion } from "./chestBreathing.js";
import { resolveFixSwitches, } from "./fixSwitches.js";
import { ensureVideoPlaying } from "./videoPlayback.js";
import { RppgProcessor, withoutReading, } from "./rppgProcessor.js";
import { loadWasmBackend, createUnavailableBackend, } from "./wasmBackend.js";
import { DemoRunner, FACE_GONE_RESET_MS, FRAME_GAP_MS, } from "./demoRunner.js";
import { WaveformFeatureWindowBuilder } from "./waveformFeatureWindow.js";
import { WaveformReconstructionController } from "./waveformReconstructionController.js";
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
 * Metrics with no reading in them (withoutReading): every estimate cleared, not only the headline
 * rate, and every figure describing the sample window (agreement, signal quality, the skin, motion
 * and clip means), which would otherwise keep describing the last face or the engine's last
 * window. The rolling baseline, calibration state, tracker configuration and capture fields stay.
 * `reason` says why, added once.
 */
function clearedMetrics(metrics, reason) {
    const cleared = withoutReading(metrics, reason);
    const already = metrics.reason_codes?.includes(reason) ||
        (reason === "processor_failed" &&
            metrics.reason_codes?.includes("backend_failed"));
    return already ? { ...cleared, reason_codes: metrics.reason_codes } : cleared;
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
        // Judged before this read's own analysis: no frame can arrive while it runs, so its time is not
        // the camera's (on a slow phone one analysis can take most of a second).
        const stopped = this.framesStopped();
        const metrics = this.processor.getMetrics();
        this.lastEngineMetrics = metrics;
        // The engine failed: the runner has stopped, so no frame reaches the engine or the pulse
        // check again and both keep their last state. Their last numbers are not a reading.
        if (this.failed())
            return this.noteRead(clearedMetrics(metrics, "processor_failed"), "processor_failed");
        // No frame for over a second (fix noFramesNoReading): the engine and the check have seen nothing
        // since, so their last numbers describe the past, however long the frames stay away.
        if (stopped)
            return this.noteRead(clearedMetrics(metrics, "no_frames"), "no_frames");
        // No face for a second (face tracking on): nothing to report, not the last number.
        // One second rides out a brief face-finder miss without dropping a real reading.
        if ((this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS)
            return this.noteRead(clearedMetrics(metrics, "no_face"), "no_face");
        const check = this.internals.pulseCheck;
        if (!check)
            return metrics;
        // With the check on, `bpm` is the heart rate the check proved, or none. The engine's own
        // estimates (the other *_bpm fields) and its confidence pass through as diagnostics.
        // Breathing rate and HRV are withheld always: neither yet passes a known answer, even with
        // the pulse proven (synthetic face, rate proven at 70, no breathing in the video: breathing
        // read 14 to 21 in 42 of 42 seconds). Each comes back when it has a check of its own.
        const state = check.getState();
        return this.noteRead({
            ...metrics,
            bpm: shownPulseBpm(state),
            hrv_rmssd: null,
            respiration_rate: null,
            respiration_confidence: null,
        }, null);
    }
    /** With `recordPulseCheckInputs`, files this read with the check's inputs; returns the metrics unchanged. */
    noteRead(metrics, reason) {
        const check = this.internals.pulseCheck;
        if (check instanceof RecordingPulseCheck)
            check.noteRead(metrics.bpm ?? null, reason);
        return metrics;
    }
    /**
     * What the pulse check was fed, and every `getMetrics()` read, for replay with `replayPulseCheck`
     * (`recordPulseCheckInputs`); a copy, the newest events within the recording's bound. Null when the
     * option or the check is off.
     */
    getPulseCheckRecording() {
        const check = this.internals.pulseCheck;
        return check instanceof RecordingPulseCheck ? check.getRecording() : null;
    }
    /**
     * Switch `light`: the level the screen should light the face at (0, 1 or 0.5, linear light) and the face light it
     * was decided from; level 0 and nulls when the switch is off.
     */
    light() {
        return this.internals.light === true ? this.runner.getLight() : { level: 0, faceLuma: null, faceRedClip: null };
    }
    /** Switch `light`: the level the app actually rendered. Report every change; an app that cannot light never calls it. */
    reportLight(applied) {
        if (this.internals.light === true)
            this.runner.setAppliedLight(applied);
    }
    /** The rate to hand to the next session after a camera restart (its pulseCheckResume); null before a proven rate. */
    getPulseCheckResume() {
        return this.internals.pulseCheck?.resumePoint() ?? null;
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
     * would run another analysis, and move the engine's own rate). It is
     * given only while all of these hold: a face is in view; the pulse check (when on) has proven a
     * pulse and still shows its rate, as `getMetrics()` does (an HRV of something that is not a pulse
     * means nothing). The engine's window holds no samples from before the face last came back: the
     * runner starts the engine's signal afresh then (`resetSignal()`).
     */
    getExperimentalVitals() {
        if (!this.internals.experimentalVitals)
            return null;
        const faceGone = this.failed() ||
            this.framesStopped() ||
            (this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS;
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
            },
            pulseCheck: this.internals.pulseCheck != null,
            pulseCheckRules: this.internals.pulseCheck?.rules ?? null,
            experimentalVitals: this.internals.experimentalVitals === true,
            foreheadPool: this.internals.foreheadPool === true && this.internals.pulseCheck != null,
            light: this.internals.light === true,
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
    /**
     * No frame has arrived for over FRAME_GAP_MS by the wall clock while the session runs (fix
     * noFramesNoReading): what `getMetrics()` reports as `no_frames`. Cheap; it runs no analysis.
     */
    framesStopped() {
        return (this.runner.framesAbsentMs?.() ?? 0) > FRAME_GAP_MS;
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
        // Before the debug snapshot's analysis, for the reason given in getMetrics.
        const framesStopped = this.framesStopped();
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
            // On the runner's wall clock: the processor's own subtracts the frames' clock (page time,
            // or the video's) from `nowMs` (Date.now() by default), about 55 years on most browsers.
            lastSampleAgeMs: this.runner.sampleAgeMs?.() ?? debugSnapshot.lastSampleAgeMs,
            lastSample: debugSnapshot.lastSample,
            processorIssues: debugSnapshot.issues,
            issues: Array.from(issues),
            processorFailure,
            state,
            lastError: this.lastErrorValue,
            faceGone: (this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS,
            framesStopped,
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
    // Built first: a bad recordPulseCheckInputs length throws here, before a face finder or an
    // engine exists, so a refused call leaves nothing running that the caller has no session to dispose.
    const pulseCheck = sessionPulseCheck(options);
    const faceMeshResult = await resolveFaceMesh(options.faceMesh);
    if (faceMeshResult.error)
        pendingErrors.push(faceMeshResult.error);
    const faceTrackingMode = faceMeshResult.faceMesh
        ? "face_mesh"
        : "video_frame";
    const source = faceMeshResult.faceMesh
        ? new MediaPipeFaceFrameSource(options.video, faceMeshResult.faceMesh, sampleRate, options.roiGeometryProfile, options.fixes)
        : new MediaPipeFrameSource(options.video, { fps: sampleRate });
    const backendResult = await resolveBackend(backendPreference, {
        wasmJsUrl: options.wasmJsUrl,
        wasmBinaryUrl: options.wasmBinaryUrl,
        wasmImporter: options.wasmImporter,
    });
    if ("error" in backendResult && backendResult.error)
        pendingErrors.push(backendResult.error);
    const processor = new RppgProcessor(backendResult.backend, sampleRate, windowSec, {
        bpmTrackerConfig: options.bpmTrackerConfig,
        bpmEvidenceQualityProvider: options.bpmEvidenceQualityProvider,
        fixes: options.fixes,
        // With the pulse check on every read withholds the engine's breathing, and experimentalVitals reads
        // breathing from the chest, so the engine does not compute it.
        respiration: pulseCheck == null,
    });
    applyTrackerConfiguration(processor, enableTracker);
    let session = null;
    const waveformBuilder = options.experimental
        ? new WaveformFeatureWindowBuilder()
        : null;
    const waveformController = options.experimental
        ? new WaveformReconstructionController(options.experimental.waveformReconstructor, options.experimental.inferenceIntervalMs)
        : undefined;
    const chestMotion = wantsChestMotion(options) ? new ChestMotion() : null;
    const runner = new DemoRunner(source, processor, {
        fixes: options.fixes,
        pulseChecker: pulseCheck,
        foreheadPool: options.foreheadPool === true,
        light: options.light === true && pulseCheck != null,
        chestMotion,
        roi: options.roi,
        roiGeometryProfile: options.roiGeometryProfile,
        sampleRate,
        roiSmoothingAlpha: options.roiSmoothingAlpha ?? 0.25,
        useSkinMask: options.useSkinMask ?? true,
        multiRoiFusion: options.multiRoiFusion,
        // Face tracking on and no explicit roi, unless the caller says otherwise.
        requireFace: options.requireFace ??
            (faceTrackingMode === "face_mesh" && options.roi === undefined),
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
        foreheadPool: options.foreheadPool === true,
        light: options.light === true && pulseCheck != null,
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
/**
 * The pulse check a session runs with these options: none with `pulseCheck: false`; one that also
 * records its inputs with `recordPulseCheckInputs` (RecordingPulseCheck); else a plain PulseCheck,
 * so with recording off the session runs exactly the check it ran before the option existed.
 */
export function sessionPulseCheck(options) {
    if (options.pulseCheck === false)
        return null;
    // Switch foreheadPool sets the check's rule of the same name, so the check always knows what it is fed.
    const opts = { rules: options.foreheadPool === true ? { ...options.pulseCheckRules, foreheadPool: true } : options.pulseCheckRules, resumeFrom: options.pulseCheckResume ?? null };
    const rec = options.recordPulseCheckInputs;
    if (rec === true || (rec != null && rec !== false && typeof rec === "object"))
        return new RecordingPulseCheck({ ...opts, seconds: rec === true ? undefined : rec.seconds, facePatches: rec === true ? false : rec.facePatches === true });
    return new PulseCheck(opts);
}
async function resolveFaceMesh(faceMeshOption) {
    if (faceMeshOption && faceMeshOption !== "auto" && faceMeshOption !== "off") {
        return { faceMesh: faceMeshOption, error: null };
    }
    if (faceMeshOption === "off") {
        return { faceMesh: null, error: null };
    }
    try {
        const faceMesh = await loadFaceLandmarker();
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
                message: describeWasmLoadFailure(cause),
                timestampMs: Date.now(),
                cause,
            },
        };
    }
}
// The loader's message names the URLs; this adds what each one failed with. The telling error is
// not always the last one: when the glue at the first URL loads but its .wasm does not, the loader
// moves on and the last error is just the next URL's not-found.
// Read by shape (RppgWasmLoadError's attemptedUrls and errors), not instanceof, so an error from
// another copy of the loader is described the same way.
function describeWasmLoadFailure(error) {
    if (!(error instanceof Error))
        return "rPPG WASM backend failed to load.";
    const { attemptedUrls, errors } = error;
    if (!Array.isArray(attemptedUrls) || !Array.isArray(errors))
        return error.message;
    const failures = attemptedUrls.map((url, index) => {
        const reason = errors[index];
        return `${url}: ${reason === undefined ? "no error recorded" : String(reason)}`;
    });
    return `${error.message} Errors by URL: ${failures.join("; ")}`;
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
