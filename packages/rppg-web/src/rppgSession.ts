import type {
	BpmEvidenceQualityProvider,
	BpmTrackerConfigV1,
} from "./bpmBayesTracker";
import {
	DemoRunner,
	type DemoRunnerDiagnostics,
	type DemoRunnerError,
	type DemoRunnerOptions,
} from "./demoRunner";
import type {
	FrameSource,
	FrameSourceError,
	FrameSourceWithErrors,
} from "./frameSource";
import { MediaPipeFaceFrameSource } from "./mediaPipeFaceFrameSource";
import { MediaPipeFrameSource } from "./mediaPipeFrameSource";
import { type FaceLandmarkerLike, loadFaceLandmarker } from "./mediapipeLoader";
import { PulseCheck, type PulseCheckState } from "./pulseCheck";
import {
	type Metrics,
	type RppgDebugIssueCode,
	type RppgDebugSnapshot,
	RppgProcessor,
	type RppgProcessorBackendFailure,
	type RppgTraceSnapshot,
} from "./rppgProcessor";
import { ensureVideoPlaying } from "./videoPlayback";
import {
	type Backend,
	type WasmImporter,
	createUnavailableBackend,
	loadWasmBackend,
} from "./wasmBackend";
import { WaveformFeatureWindowBuilder } from "./waveformFeatureWindow";
import type {
	RppgModelDiagnosticsV1,
	WaveformReconstructionV1,
	WaveformReconstructor,
} from "./waveformModel";
import { WaveformReconstructionController } from "./waveformReconstructionController";
import {
	type RppgProcessorLike,
	createWorkerRppgProcessor,
} from "./workerRppgProcessor";

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
	modelDiagnostics?: RppgModelDiagnosticsV1 | null;
};

export type CreateRppgSessionOptions = Omit<
	DemoRunnerOptions,
	"onDiagnostics" | "onError" | "pulseChecker"
> & {
	video: HTMLVideoElement;
	bpmTrackerConfig?: BpmTrackerConfigV1;
	bpmEvidenceQualityProvider?: BpmEvidenceQualityProvider;
	experimental?: {
		waveformReconstructor: WaveformReconstructor;
		inferenceIntervalMs?: number;
		/** Reserved for later validation; reconstructed BPM evidence is disabled. */
		useReconstructedBpmEvidence?: false;
	};
	/**
	 * Report a heart rate only once a real pulse is proven, and report the proven rate
	 * (see pulseCheck.ts). Off by default; when off, nothing changes.
	 */
	pulseCheck?: boolean;
	/**
	 * Run the heart-rate analysis in a Web Worker, so it never blocks the camera frames (see
	 * workerRppgProcessor.ts). Off by default. Falls back to the main thread, exactly as
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
};

export class RppgSession {
	private lastErrorValue: RppgSessionError | null = null;

	constructor(
		public readonly source: FrameSource,
		public readonly processor: RppgProcessorLike,
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
		const metrics = this.processor.getMetrics();
		const check = this.internals.pulseCheck;
		if (!check) return metrics;
		// With the check on, the only number reported is the heart rate the check proved, or none.
		// Breathing rate and HRV are withheld always, because neither yet passes a known answer
		// even with the pulse proven (sandbox, 2026-10-02, synthetic face, rate proven at 70):
		// with NO breathing in the video, breathing read 14 to 21 in 42 of 42 seconds; at a true
		// 12 it was within 2 in 22 of 42. Each comes back when it has a check of its own.
		const state = check.getState();
		return {
			...metrics,
			bpm: state.verdict === "measured" ? state.bpm : null,
			hrv_rmssd: null,
			respiration_rate: null,
			respiration_confidence: null,
		};
	}

	/** State of the optional real-pulse check; null when `pulseCheck` is off. */
	getPulseCheck(): PulseCheckState | null {
		return this.internals.pulseCheck?.getState() ?? null;
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
		return this.processor.getDebugSnapshot(nowMs);
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

	getState(): RppgSessionState {
		const processorFailure = this.processor.getBackendFailure();
		const lastError = this.lastErrorValue;
		const terminal =
			processorFailure != null || lastError?.code === "processor_error";
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
			lastSampleAgeMs: debugSnapshot.lastSampleAgeMs,
			lastSample: debugSnapshot.lastSample,
			processorIssues: debugSnapshot.issues,
			issues: Array.from(issues),
			processorFailure,
			state,
			lastError: this.lastErrorValue,
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
			)
		: new MediaPipeFrameSource(options.video, { fps: sampleRate });

	const workerProcessor =
		options.analysisWorker &&
		!options.wasmImporter &&
		!options.bpmEvidenceQualityProvider
			? await createWorkerRppgProcessor({
					sampleRate,
					windowSec,
					wasmJsUrl: options.wasmJsUrl,
					wasmBinaryUrl: options.wasmBinaryUrl,
					bpmTrackerConfig: options.bpmTrackerConfig,
				})
			: null;
	const backendResult = workerProcessor
		? { mode: "wasm" as const }
		: await resolveBackend(backendPreference, {
				wasmJsUrl: options.wasmJsUrl,
				wasmBinaryUrl: options.wasmBinaryUrl,
				wasmImporter: options.wasmImporter,
			});
	const processor: RppgProcessorLike =
		workerProcessor ??
		new RppgProcessor(
			(backendResult as { backend: Backend }).backend,
			sampleRate,
			windowSec,
			{
				bpmTrackerConfig: options.bpmTrackerConfig,
				bpmEvidenceQualityProvider: options.bpmEvidenceQualityProvider,
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

	const pulseCheck = options.pulseCheck ? new PulseCheck() : null;
	const runner = new DemoRunner(source, processor, {
		pulseChecker: pulseCheck,
		roi: options.roi,
		roiGeometryProfile: options.roiGeometryProfile,
		sampleRate,
		roiSmoothingAlpha: options.roiSmoothingAlpha ?? 0.25,
		useSkinMask: options.useSkinMask ?? true,
		multiRoiFusion: options.multiRoiFusion,
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
): Promise<{ backend: Backend; mode: RppgSessionBackendMode }> {
	const backend = await loadWasmBackend(options.wasmImporter, {
		strict: backendPreference === "wasm",
		jsUrl: options.wasmJsUrl,
		binaryUrl: options.wasmBinaryUrl,
	});
	if (backend) {
		return { backend, mode: "wasm" };
	}
	return { backend: createUnavailableBackend(), mode: "unavailable" };
}

function applyTrackerConfiguration(
	processor: RppgProcessorLike,
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
