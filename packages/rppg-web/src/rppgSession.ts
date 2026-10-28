import type {
	FrameSource,
	FrameSourceError,
	FrameSourceWithErrors,
} from "./frameSource";
import { MediaPipeFaceFrameSource } from "./mediaPipeFaceFrameSource";
import { MediaPipeFrameSource } from "./mediaPipeFrameSource";
import { loadFaceLandmarker, type FaceLandmarkerLike } from "./mediapipeLoader";
import {
	PulseCheck,
	type PulseCheckRules,
	type PulseCheckState,
	type ResolvedPulseCheckRules,
	shownPulseBpm,
} from "./pulseCheck";
import {
	type PulseCheckReadReason,
	type PulseCheckRecording,
	RecordingPulseCheck,
} from "./pulseCheckRecording";
import { ChestMotion, type ChestSample } from "./chestBreathing";
import {
	type ResolvedRppgFixSwitches,
	resolveFixSwitches,
} from "./fixSwitches";
import { ensureVideoPlaying } from "./videoPlayback";
import {
	RppgProcessor,
	type Metrics,
	type RppgDebugIssueCode,
	type RppgDebugSnapshot,
	type RppgProcessorBackendFailure,
	type RppgTraceSnapshot,
	withoutReading,
} from "./rppgProcessor";
import {
	loadWasmBackend,
	createUnavailableBackend,
	type Backend,
	type RppgWasmLoadError,
	type WasmImporter,
} from "./wasmBackend";
import {
	DemoRunner,
	FACE_GONE_RESET_MS,
	FRAME_GAP_MS,
	type DemoRunnerDiagnostics,
	type DemoRunnerError,
	type DemoRunnerOptions,
} from "./demoRunner";
import type {
	BpmEvidenceQualityProvider,
	BpmTrackerConfigV1,
} from "./bpmBayesTracker";
import { WaveformFeatureWindowBuilder } from "./waveformFeatureWindow";
import type {
	RppgModelDiagnosticsV1,
	WaveformReconstructionV1,
	WaveformReconstructor,
} from "./waveformModel";
import { WaveformReconstructionController } from "./waveformReconstructionController";

export type RppgSessionBackendPreference = "auto" | "wasm";
export type RppgSessionBackendMode = "wasm" | "unavailable";
export type RppgSessionFaceTrackingMode = "face_mesh" | "video_frame";
export type RppgSessionIssueCode =
	| RppgDebugIssueCode
	| "backend_unavailable"
	| "face_mesh_unavailable"
	| "processor_failed";
export type RppgSessionErrorCode =
	| "backend_init_failed"
	| "face_mesh_init_failed"
	| "capture_error"
	| "processor_error";

export type RppgSessionStateStatus = "running" | "degraded" | "failed";
export type RppgSessionStatePhase = "none" | "startup" | "runtime";
export type RppgSessionStateReason =
	| RppgSessionIssueCode
	| RppgSessionErrorCode
	| null;

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

export type CreateRppgSessionOptions = Omit<
	DemoRunnerOptions,
	"onDiagnostics" | "onError" | "pulseChecker" | "chestMotion"
> & {
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
	 * With `pulseCheck`, keep what the check is fed (the face regions, the wall, the head, a lost face)
	 * and every `getMetrics()` read, so the check
	 * can be replayed offline with any rules (`replayPulseCheck`): `session.getPulseCheckRecording()`.
	 * Off by default. `true` keeps the newest PULSE_CHECK_RECORDING_SECONDS (5 minutes); `{ seconds }`
	 * sets that. Recording changes no output; see pulseCheckRecording.ts for the format and the memory bound.
	 */
	recordPulseCheckInputs?: boolean | { seconds?: number };
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
	enableTracker?:
		| boolean
		| {
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
	breathing: { rate: number; share: number } | null;
};

/** Whether a session reads chest motion: only for `experimentalVitals`' breathing. */
export function wantsChestMotion(options: { experimentalVitals?: boolean }): boolean {
	return options.experimentalVitals === true;
}

const WITHHELD_VITALS = {
	hrv_rmssd: null,
	respiration_rate: null,
	respiration_confidence: null,
} as const;

/**
 * Metrics with no reading in them (withoutReading): every estimate cleared, not only the headline
 * rate, and every figure describing the sample window (agreement, signal quality, the skin, motion
 * and clip means), which would otherwise keep describing the last face or the engine's last
 * window. The rolling baseline, calibration state, tracker configuration and capture fields stay.
 * `reason` says why, added once.
 */
function clearedMetrics(metrics: Metrics, reason: string): Metrics {
	const cleared = withoutReading(metrics, reason);
	const already =
		metrics.reason_codes?.includes(reason) ||
		(reason === "processor_failed" &&
			metrics.reason_codes?.includes("backend_failed"));
	return already ? { ...cleared, reason_codes: metrics.reason_codes } : cleared;
}

export class RppgSession {
	private lastErrorValue: RppgSessionError | null = null;
	/** The engine read behind the latest getMetrics(), before any withholding (for getExperimentalVitals). */
	private lastEngineMetrics: Metrics | null = null;

	constructor(
		public readonly source: FrameSource,
		public readonly processor: RppgProcessor,
		public readonly runner: DemoRunner,
		public readonly backendMode: RppgSessionBackendMode,
		public readonly faceTrackingMode: RppgSessionFaceTrackingMode,
		private readonly internals: SessionInternals = {},
	) {}

	get lastError(): RppgSessionError | null {
		return this.lastErrorValue;
	}

	get state(): RppgSessionState {
		return this.getState();
	}

	getMetrics(): Metrics {
		// Judged before this read's own analysis: no frame can arrive while it runs, so its time is not
		// the camera's (on a slow phone one analysis can take most of a second).
		const stopped = this.framesStopped();
		const metrics = this.processor.getMetrics();
		this.lastEngineMetrics = metrics;
		// The engine failed: the runner has stopped, so no frame reaches the engine or the pulse
		// check again and both keep their last state. Their last numbers are not a reading.
		if (this.failed()) return this.noteRead(clearedMetrics(metrics, "processor_failed"), "processor_failed");
		// No frame for over a second (fix noFramesNoReading): the engine and the check have seen nothing
		// since, so their last numbers describe the past, however long the frames stay away.
		if (stopped) return this.noteRead(clearedMetrics(metrics, "no_frames"), "no_frames");
		// No face for a second (face tracking on): nothing to report, not the last number.
		// One second rides out a brief face-finder miss without dropping a real reading.
		if ((this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS)
			return this.noteRead(clearedMetrics(metrics, "no_face"), "no_face");
		const check = this.internals.pulseCheck;
		if (!check) return metrics;
		// With the check on, `bpm` is the heart rate the check proved, or none. The engine's own
		// estimates (the other *_bpm fields) and its confidence pass through as diagnostics.
		// Breathing rate and HRV are withheld always: neither yet passes a known answer, even with
		// the pulse proven (synthetic face, rate proven at 70, no breathing in the video: breathing
		// read 14 to 21 in 42 of 42 seconds). Each comes back when it has a check of its own.
		const state = check.getState();
		return this.noteRead(
			{
				...metrics,
				bpm: shownPulseBpm(state),
				hrv_rmssd: null,
				respiration_rate: null,
				respiration_confidence: null,
			},
			null,
		);
	}

	/** With `recordPulseCheckInputs`, files this read with the check's inputs; returns the metrics unchanged. */
	private noteRead(metrics: Metrics, reason: PulseCheckReadReason): Metrics {
		const check = this.internals.pulseCheck;
		if (check instanceof RecordingPulseCheck) check.noteRead(metrics.bpm ?? null, reason);
		return metrics;
	}

	/**
	 * What the pulse check was fed, and every `getMetrics()` read, for replay with `replayPulseCheck`
	 * (`recordPulseCheckInputs`); a copy, the newest events within the recording's bound. Null when the
	 * option or the check is off.
	 */
	getPulseCheckRecording(): PulseCheckRecording | null {
		const check = this.internals.pulseCheck;
		return check instanceof RecordingPulseCheck ? check.getRecording() : null;
	}

	/** State of the real-pulse check; null when `pulseCheck` is off. */
	getPulseCheck(): PulseCheckState | null {
		return this.internals.pulseCheck?.getState() ?? null;
	}

	/** The chest motion kept (`experimentalVitals`), for recording and replay; empty when off. */
	getChestMotionSamples(): readonly ChestSample[] {
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
	getExperimentalVitals(): ExperimentalVitals | null {
		if (!this.internals.experimentalVitals) return null;
		const faceGone =
			this.failed() ||
			this.framesStopped() ||
			(this.runner.faceAbsentMs?.() ?? 0) >= FACE_GONE_RESET_MS;
		const state = this.internals.pulseCheck?.getState();
		const proven = !state || (state.verdict === "measured" && state.bpm != null);
		const hrv = this.lastEngineMetrics?.hrv_rmssd;
		return {
			experimental: true,
			hrvRmssd:
				!faceGone && proven && Number.isFinite(hrv)
					? (hrv as number)
					: null,
			breathing: this.internals.chestMotion?.rate() ?? null,
		};
	}

	/** Which fixes and checks this session runs, for logging results against a build. */
	getBuildSwitches(): {
		fixes: ResolvedRppgFixSwitches;
		pulseCheck: boolean;
		pulseCheckRules: ResolvedPulseCheckRules | null;
		experimentalVitals: boolean;
		foreheadPool: boolean;
	} {
		const fixes =
			(this.runner as { fixes?: ResolvedRppgFixSwitches }).fixes ??
			resolveFixSwitches();
		const procFixes = (this.processor as { fixes?: ResolvedRppgFixSwitches })
			.fixes;
		const srcFixes = (this.source as { fixes?: ResolvedRppgFixSwitches } | null)
			?.fixes;
		return {
			fixes: {
				...fixes,
				colourProjectionFix:
					procFixes?.colourProjectionFix ?? fixes.colourProjectionFix,
				noRateDoubling: procFixes?.noRateDoubling ?? fixes.noRateDoubling,
				analysisWidth: srcFixes?.analysisWidth ?? fixes.analysisWidth,
			},
			pulseCheck: this.internals.pulseCheck != null,
			pulseCheckRules: this.internals.pulseCheck?.rules ?? null,
			experimentalVitals: this.internals.experimentalVitals === true,
			foreheadPool: this.internals.foreheadPool === true && this.internals.pulseCheck != null,
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

	getDebugSnapshot(nowMs = Date.now()): RppgDebugSnapshot {
		const snapshot = this.processor.getDebugSnapshot(nowMs);
		// With the pulse check on, HRV and breathing are withheld here too, as in getMetrics: a debug
		// feed an app displays is a screen like any other. Of the session's reads, experimentalVitals is
		// their one way out.
		if (!this.internals.pulseCheck) return snapshot;
		return {
			...snapshot,
			backendMetrics: { ...snapshot.backendMetrics, ...WITHHELD_VITALS },
		};
	}

	getTraceSnapshot(maxPoints = 300): RppgTraceSnapshot {
		return this.processor.getTraceSnapshot(maxPoints);
	}

	getLatestWaveformReconstruction(): WaveformReconstructionV1 | null {
		return this.internals.waveformController?.getLatest() ?? null;
	}

	getModelDiagnostics(): RppgModelDiagnosticsV1 | null {
		return this.internals.waveformController?.getDiagnostics() ?? null;
	}

	/**
	 * No frame has arrived for over FRAME_GAP_MS by the wall clock while the session runs (fix
	 * noFramesNoReading): what `getMetrics()` reports as `no_frames`. Cheap; it runs no analysis.
	 */
	framesStopped(): boolean {
		return (this.runner.framesAbsentMs?.() ?? 0) > FRAME_GAP_MS;
	}

	/** The engine threw (the runner stops on that): the session can report nothing more. */
	private failed(): boolean {
		return (
			this.processor.getBackendFailure?.() != null ||
			this.lastErrorValue?.code === "processor_error"
		);
	}

	getState(): RppgSessionState {
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
			const startupFailure =
				lastError.code === "backend_init_failed" ||
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

	getDiagnostics(nowMs = Date.now()): RppgSessionDiagnostics {
		// Before the debug snapshot's analysis, for the reason given in getMetrics.
		const framesStopped = this.framesStopped();
		const runnerDiagnostics = this.runner.getDiagnostics();
		const debugSnapshot = this.processor.getDebugSnapshot(nowMs);
		const processorFailure = this.processor.getBackendFailure();
		const state = this.getState();
		const issues = new Set<RppgSessionIssueCode>(debugSnapshot.issues);
		if (this.internals.backendDegraded) issues.add("backend_unavailable");
		if (this.internals.faceTrackingDegraded)
			issues.add("face_mesh_unavailable");
		if (state.status === "failed") issues.add("processor_failed");

		return {
			...runnerDiagnostics,
			backendMode: this.backendMode,
			estimationAvailable:
				this.backendMode === "wasm" && processorFailure == null,
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

	async start(): Promise<void> {
		await this.internals.beforeStart?.();
		await this.runner.start();
		this.emitDiagnostics();
	}

	async stop(): Promise<void> {
		await this.runner.stop();
		await this.internals.waveformController?.stop();
		this.emitDiagnostics();
	}

	async dispose(): Promise<void> {
		await this.stop();
		await this.internals.waveformController?.dispose();
		this.processor.dispose();
	}

	recordError(error: RppgSessionError) {
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
export async function createRppgSession(
	options: CreateRppgSessionOptions,
): Promise<RppgSession> {
	const sampleRate = options.sampleRate ?? 30;
	const windowSec = options.windowSec ?? 10;
	const backendPreference = options.backend ?? "auto";
	const enableTracker = options.enableTracker ?? true;
	const pendingErrors: RppgSessionError[] = [];
	// Built first: a bad recordPulseCheckInputs length throws here, before a face finder or an
	// engine exists, so a refused call leaves nothing running that the caller has no session to dispose.
	const pulseCheck = sessionPulseCheck(options);

	const faceMeshResult = await resolveFaceMesh(options.faceMesh);
	if (faceMeshResult.error) pendingErrors.push(faceMeshResult.error);

	const faceTrackingMode: RppgSessionFaceTrackingMode = faceMeshResult.faceMesh
		? "face_mesh"
		: "video_frame";
	const source = faceMeshResult.faceMesh
		? new MediaPipeFaceFrameSource(
				options.video,
				faceMeshResult.faceMesh,
				sampleRate,
				options.roiGeometryProfile,
				options.fixes,
			)
		: new MediaPipeFrameSource(options.video, { fps: sampleRate });

	const backendResult = await resolveBackend(backendPreference, {
		wasmJsUrl: options.wasmJsUrl,
		wasmBinaryUrl: options.wasmBinaryUrl,
		wasmImporter: options.wasmImporter,
	});
	if ("error" in backendResult && backendResult.error)
		pendingErrors.push(backendResult.error);
	const processor: RppgProcessor = new RppgProcessor(
			(backendResult as { backend: Backend }).backend,
			sampleRate,
			windowSec,
			{
				bpmTrackerConfig: options.bpmTrackerConfig,
				bpmEvidenceQualityProvider: options.bpmEvidenceQualityProvider,
				fixes: options.fixes,
			},
		);
	applyTrackerConfiguration(processor, enableTracker);
	let session: RppgSession | null = null;
	const waveformBuilder = options.experimental
		? new WaveformFeatureWindowBuilder()
		: null;
	const waveformController = options.experimental
		? new WaveformReconstructionController(
				options.experimental.waveformReconstructor,
				options.experimental.inferenceIntervalMs,
			)
		: undefined;

	const chestMotion = wantsChestMotion(options) ? new ChestMotion() : null;
	const runner = new DemoRunner(source, processor, {
		fixes: options.fixes,
		pulseChecker: pulseCheck,
		foreheadPool: options.foreheadPool === true,
		chestMotion,
		roi: options.roi,
		roiGeometryProfile: options.roiGeometryProfile,
		sampleRate,
		roiSmoothingAlpha: options.roiSmoothingAlpha ?? 0.25,
		useSkinMask: options.useSkinMask ?? true,
		multiRoiFusion: options.multiRoiFusion,
		// Face tracking on and no explicit roi, unless the caller says otherwise.
		requireFace:
			options.requireFace ??
			(faceTrackingMode === "face_mesh" && options.roi === undefined),
		fusionProjection: options.fusionProjection,
		roiPixelSampler: options.roiPixelSampler,
		onRoiSamples: (samples) => {
			options.onRoiSamples?.(samples);
			if (!waveformBuilder || !waveformController || !options.experimental)
				return;
			for (const sample of samples) waveformBuilder.push(sample);
			const manifest = options.experimental.waveformReconstructor.manifest;
			const window = waveformBuilder.build({
				profileId: manifest.input.profileId,
				channels: manifest.input.channels,
				length: manifest.input.length,
			});
			if (window) {
				waveformController.offer(window);
			} else {
				waveformController.reportInputUnavailable(
					waveformBuilder.lastFailureReason ?? "insufficient_window",
					waveformBuilder.sampleCount,
				);
			}
		},
		onStats: options.onStats,
		skinRatioSmoothingAlpha: options.skinRatioSmoothingAlpha,
		onDiagnostics: () => {
			session?.emitDiagnostics();
		},
		onError: (error: DemoRunnerError) => {
			session?.recordError({
				code: "processor_error",
				stage: "processor",
				message: error.message,
				timestampMs: error.timestampMs,
				cause: error.cause,
			});
		},
	});

	session = new RppgSession(
		source,
		processor,
		runner,
		backendResult.mode,
		faceTrackingMode,
		{
			onDiagnostics: options.onDiagnostics,
			onError: options.onError,
			pulseCheck,
			chestMotion,
			experimentalVitals: options.experimentalVitals === true,
			foreheadPool: options.foreheadPool === true,
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
		},
	);

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
export function sessionPulseCheck(
	options: Pick<CreateRppgSessionOptions, "pulseCheck" | "pulseCheckRules" | "recordPulseCheckInputs">,
): PulseCheck | null {
	if (options.pulseCheck === false) return null;
	const opts = { rules: options.pulseCheckRules };
	const rec = options.recordPulseCheckInputs;
	if (rec === true || (rec != null && rec !== false && typeof rec === "object"))
		return new RecordingPulseCheck({ ...opts, seconds: rec === true ? undefined : rec.seconds });
	return new PulseCheck(opts);
}

async function resolveFaceMesh(
	faceMeshOption: CreateRppgSessionOptions["faceMesh"],
): Promise<{
	faceMesh: FaceLandmarkerLike | null;
	error: RppgSessionError | null;
}> {
	if (faceMeshOption && faceMeshOption !== "auto" && faceMeshOption !== "off") {
		return { faceMesh: faceMeshOption, error: null };
	}
	if (faceMeshOption === "off") {
		return { faceMesh: null, error: null };
	}

	try {
		const faceMesh = await loadFaceLandmarker();
		return { faceMesh, error: null };
	} catch (cause) {
		return {
			faceMesh: null,
			error: {
				code: "face_mesh_init_failed",
				stage: "face_mesh",
				message:
					cause instanceof Error
						? cause.message
						: "FaceMesh failed to initialize.",
				timestampMs: Date.now(),
				cause,
			},
		};
	}
}

async function resolveBackend(
	backendPreference: RppgSessionBackendPreference,
	options: Pick<
		CreateRppgSessionOptions,
		"wasmJsUrl" | "wasmBinaryUrl" | "wasmImporter"
	>,
): Promise<{
	backend: Backend;
	mode: RppgSessionBackendMode;
	error?: RppgSessionError;
}> {
	// Always load strictly, so the reason it failed is kept. "auto" still falls back to a backend
	// that reads nothing, but now says why through onError: before, a bundler that could not serve
	// the WASM gave a session that ran, found a face and never produced a number, with no error.
	try {
		const backend = await loadWasmBackend(options.wasmImporter, {
			strict: true,
			jsUrl: options.wasmJsUrl,
			binaryUrl: options.wasmBinaryUrl,
		});
		if (backend) return { backend, mode: "wasm" };
		throw new Error("rPPG WASM backend loaded no pipeline.");
	} catch (cause) {
		if (backendPreference === "wasm") throw cause;
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
function describeWasmLoadFailure(error: unknown): string {
	if (!(error instanceof Error)) return "rPPG WASM backend failed to load.";
	const { attemptedUrls, errors } = error as Partial<
		Pick<RppgWasmLoadError, "attemptedUrls" | "errors">
	>;
	if (!Array.isArray(attemptedUrls) || !Array.isArray(errors))
		return error.message;
	const failures = attemptedUrls.map((url, index) => {
		const reason = errors[index];
		return `${url}: ${reason === undefined ? "no error recorded" : String(reason)}`;
	});
	return `${error.message} Errors by URL: ${failures.join("; ")}`;
}

function applyTrackerConfiguration(
	processor: RppgProcessor,
	enableTracker: CreateRppgSessionOptions["enableTracker"],
) {
	if (!enableTracker) return;
	if (enableTracker === true) {
		processor.enableTracker(55, 150, 200);
		return;
	}
	processor.enableTracker(
		enableTracker.minBpm ?? 55,
		enableTracker.maxBpm ?? 150,
		enableTracker.numParticles ?? 200,
	);
}

function attachSourceErrorForwarder(source: FrameSource, session: RppgSession) {
	const errorSource = source as Partial<FrameSourceWithErrors>;
	if (typeof errorSource.getLastError !== "function") return;
	errorSource.onError = (error: FrameSourceError) => {
		session.recordError({
			code:
				error.stage === "face_mesh" ? "face_mesh_init_failed" : "capture_error",
			stage: error.stage,
			message: error.message,
			timestampMs: error.timestampMs,
			cause: error.cause,
		});
	};
}
