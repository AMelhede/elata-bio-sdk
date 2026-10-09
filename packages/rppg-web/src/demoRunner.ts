import {
	FrameSource,
	Frame,
	type FrameBlendshape,
	averageGreenInROI,
	averageGreenInROIWithSkinMaskStats,
	averageRgbInROI,
	averageRgbInROIWithSkinMaskStats,
} from "./frameSource";
import {
	faceBoxFromLandmarks,
	padFaceBoxToHead,
	type FaceBox,
} from "./faceFraming";
import {
	type ResolvedRppgFixSwitches,
	type RppgFixesOption,
	resolveFixSwitches,
} from "./fixSwitches";
import {
	FUSION_ROIS,
	type FusionProjection,
	type FusionRoiName,
	type MultiRoiFusionResult,
	MultiRoiRppgFuser,
	type RoiRgbSample,
} from "./multiRoiFusion";
import { type PulseCheck, WallTracker, headCentre, wallMissReason } from "./pulseCheck";
import type { ChestMotion } from "./chestBreathing";
import { RppgProcessor } from "./rppgProcessor";
import {
	ELATA_YCBCR_V1_PIXEL_SAMPLER,
	type RoiPixelSampler,
	type RppgRoiSampleV1,
	sampleRppgRoi,
} from "./roiPixelSampler";
import {
	ELATA_FACE_YCBCR_V1_PROFILE,
	type RoiGeometryProfile,
} from "./roiProfile";
import type { RppgProcessorLike } from "./workerRppgProcessor";

export type LastBlendshapes = {
	blendshapes: FrameBlendshape[];
	atMs: number;
};

export type LastFaceBox = {
	/** Normalized (0..1) head box — the mesh bounds padded out to the head. */
	box: FaceBox;
	atMs: number;
};

export type DemoRunnerOptions = {
	/**
	 * Fix switches (see fixSwitches.ts). All on unless set to false. The runner applies
	 * noFaceNoReading, realFrameRate and posFusion; the processor applies the other two.
	 */
	fixes?: RppgFixesOption;
	/**
	 * The real-pulse check (see pulseCheck.ts), fed the same three face regions the fuser
	 * reads plus a patch of wall beside the face. The session creates it (`pulseCheck`);
	 * null or left out: no check.
	 */
	pulseChecker?: PulseCheck | null;
	/**
	 * Breathing from chest motion (see chestBreathing.ts), fed every analysed frame with its face
	 * landmarks. The session creates it (`chestBreathing`); null or left out: not read.
	 */
	chestMotion?: ChestMotion | null;
	roi?: { x: number; y: number; w: number; h: number } | null;
	/** Face-mesh ROI geometry profile. */
	roiGeometryProfile?: RoiGeometryProfile;
	sampleRate?: number;
	roiSmoothingAlpha?: number;
	useSkinMask?: boolean;
	onStats?: (stats: {
		intensity: number;
		skinRatio: number;
		fps: number | null;
		r: number;
		g: number;
		b: number;
		clipRatio: number;
		motion: number;
	}) => void;
	onDiagnostics?: (diagnostics: DemoRunnerDiagnostics) => void;
	onError?: (error: DemoRunnerError) => void;
	skinRatioSmoothingAlpha?: number;
	/**
	 * Multi-ROI rPPG fusion: run CHROM + bandpass per face region (forehead +
	 * both cheeks) and blend by in-band spectral SNR, so glare/hair/occlusion on
	 * one region no longer poisons the estimate. Requires sub-ROIs on the frame
	 * (face-mesh mode) + the skin mask. Defaults to on; falls back to the single
	 * aggregated-ROI path when sub-ROIs are unavailable.
	 */
	multiRoiFusion?: boolean;
	/**
	 * Per-region projection inside the fuser: "pos" or "chrom". Left out, it follows the
	 * `posFusion` fix switch ("pos" when on, "chrom", as published, when off).
	 */
	fusionProjection?: FusionProjection;
	/**
	 * Face tracking is on. With the `noFaceNoReading` fix switch on, a frame with no face is
	 * then dropped instead of read. Otherwise the runner reads a 100x100 square in the middle
	 * of the frame, which is right for whole-frame mode and wrong with face tracking on: every
	 * published rppg-web (0.1.1 to 0.14.0) then kept reporting a heart rate from a plain wall
	 * (27 of 41 seconds on real wall footage, demo settings).
	 */
	requireFace?: boolean;
	/**
	 * Pixel-selection and spatial-weighting profile. When omitted, the original
	 * SDK YCbCr helper is used unchanged.
	 */
	roiPixelSampler?: RoiPixelSampler;
	onRoiSamples?: (samples: readonly RppgRoiSampleV1[]) => void;
};

export type DemoRunnerDropReason =
	| "frame_invalid"
	| "roi_missing"
	| "no_face"
	| "non_finite_intensity"
	| "processor_error";

export type DemoRunnerDiagnostics = {
	framesSeen: number;
	framesWithFaceRoi: number;
	framesWithFallbackRoi: number;
	framesWithMultiRoi: number;
	samplesPushed: number;
	droppedFrames: number;
	lastDropReason: DemoRunnerDropReason | null;
	lastTimestampMs: number | null;
	lastIntensity: number | null;
	lastSkinRatio: number | null;
	lastClipRatio: number | null;
	lastMotion: number | null;
	lastProcessorMethod: "rgb_meta" | "rgb" | "intensity" | "fused" | null;
	lastRoiSource: "multi_roi" | "face_roi" | "fallback_roi" | null;
	/** Frames fed through the multi-ROI fuser (subset of framesWithMultiRoi). */
	framesWithFusion: number;
	/** Per-region fusion weights (sum to 1), SNR-driven; null until fusion runs. */
	lastFusionWeights: Record<FusionRoiName, number> | null;
	/** In-band spectral SNR (linear) of the fused signal, or null. */
	lastFusedSnr: number | null;
	/** Versioned ROI contracts active for this runner. */
	roiGeometryProfileId: string;
	roiPixelSamplerId: string;
};

export type DemoRunnerError = {
	code: "processor_error";
	stage: "processor";
	message: string;
	timestampMs: number;
	diagnostics: DemoRunnerDiagnostics;
	cause?: unknown;
};

/** How long without a face (face tracking on) before the session stops reporting and the analysis restarts when the face returns. */
export const FACE_GONE_RESET_MS = 1000;
type FusionSamples = Partial<Record<FusionRoiName, RoiRgbSample>>;
type GridSample = {
	t: number;
	regions: FusionSamples;
	rgb: { r: number; g: number; b: number };
};

/**
 * Longest gap between frames that the sample grid bridges. 250 ms covers a
 * camera down to 4 frames a second (the slowest measured here was 6, with
 * analysis on the main thread of a real laptop); a longer gap is a stall, and
 * a straight line across it would stand in for a third of a beat or more.
 */
const GRID_MAX_GAP_MS = 250;

function interpolateGrid(a: GridSample, b: GridSample, t: number): GridSample {
	const w = (t - a.t) / (b.t - a.t);
	const mix = (x: number, y: number) => x + w * (y - x);
	const regions: FusionSamples = {};
	for (const name of Object.keys(b.regions) as FusionRoiName[]) {
		const p = a.regions[name];
		const q = b.regions[name]!;
		regions[name] = p
			? {
					r: mix(p.r, q.r),
					g: mix(p.g, q.g),
					b: mix(p.b, q.b),
					skinFraction:
						p.skinFraction != null && q.skinFraction != null
							? mix(p.skinFraction, q.skinFraction)
							: q.skinFraction,
				}
			: q;
	}
	return {
		t,
		regions,
		rgb: {
			r: mix(a.rgb.r, b.rgb.r),
			g: mix(a.rgb.g, b.rgb.g),
			b: mix(a.rgb.b, b.rgb.b),
		},
	};
}

export class DemoRunner {
	private running = false;
	private frameCount = 0;
	private lastSampleTs = 0;
	private smoothedRoi: { x: number; y: number; w: number; h: number } | null =
		null;
	private frameTimes: number[] = [];
	private lastFps: number | null = null;
	private lastCenter: { x: number; y: number } | null = null;
	private smoothedSkinRatio: number | null = null;
	private diagnostics: DemoRunnerDiagnostics = {
		framesSeen: 0,
		framesWithFaceRoi: 0,
		framesWithFallbackRoi: 0,
		framesWithMultiRoi: 0,
		samplesPushed: 0,
		droppedFrames: 0,
		lastDropReason: null,
		lastTimestampMs: null,
		lastIntensity: null,
		lastSkinRatio: null,
		lastClipRatio: null,
		lastMotion: null,
		lastProcessorMethod: null,
		lastRoiSource: null,
		framesWithFusion: 0,
		lastFusionWeights: null,
		lastFusedSnr: null,
		roiGeometryProfileId: ELATA_FACE_YCBCR_V1_PROFILE.id,
		roiPixelSamplerId: ELATA_YCBCR_V1_PIXEL_SAMPLER.id,
	};
	private lastError: DemoRunnerError | null = null;
	private lastBlendshapes: LastBlendshapes | null = null;
	private lastFaceBox: LastFaceBox | null = null;
	private fuser: MultiRoiRppgFuser | null = null;
	/** Timestamp of the first frame of the current run without a face; null while a face is in view. */
	private noFaceSinceMs: number | null = null;
	private noFaceLastMs: number | null = null;
	/** Last frame on the fusion path, and the next grid time, for {@link pushOnGrid}. */
	private gridPrev: GridSample | null = null;
	private gridNextT = 0;
	/** The fix switches this runner applies. */
	readonly fixes: ResolvedRppgFixSwitches;
	/** The wall beside the face, one signal across patches (see WallTracker in pulseCheck.ts). */
	private wallTracker = new WallTracker();
	private lastOpinionMs: number | null = null;

	constructor(
		private source: FrameSource,
		private processor: RppgProcessorLike,
		private opts: DemoRunnerOptions = {},
	) {
		this.source.onFrame = this.onFrame.bind(this);
		this.diagnostics.roiGeometryProfileId =
			opts.roiGeometryProfile?.id ?? ELATA_FACE_YCBCR_V1_PROFILE.id;
		this.diagnostics.roiPixelSamplerId =
			opts.roiPixelSampler?.id ?? ELATA_YCBCR_V1_PIXEL_SAMPLER.id;
		this.fixes = resolveFixSwitches(opts.fixes);
		if (opts.multiRoiFusion !== false) {
			this.fuser = new MultiRoiRppgFuser(
				opts.sampleRate ?? 30,
				8,
				0.5,
				opts.fusionProjection ?? (this.fixes.posFusion ? "pos" : "chrom"),
			);
		}
	}

	/** How long no face has been in view as of `nowMs` (0 while a face is in view). */
	faceAbsentMs(nowMs: number = this.noFaceLastMs ?? 0): number {
		return this.noFaceSinceMs == null
			? 0
			: Math.max(0, nowMs - this.noFaceSinceMs);
	}

	/** Latest face blendshapes (for affect estimation), with capture timestamp. */
	getLastBlendshapes(): LastBlendshapes | null {
		return this.lastBlendshapes;
	}

	/**
	 * Latest normalized head box (for framing guidance), with capture timestamp.
	 * Null until a face is tracked; consumers should treat a stale entry as
	 * "no face" against their own clock.
	 */
	getLastFaceBox(): LastFaceBox | null {
		return this.lastFaceBox;
	}

	async start() {
		this.running = true;
		await this.source.start();
	}

	async stop() {
		this.running = false;
		this.fuser?.reset();
		this.noFaceSinceMs = null;
		this.gridPrev = null;
		await this.source.stop();
	}

	getDiagnostics(): DemoRunnerDiagnostics {
		return { ...this.diagnostics };
	}

	getLastError(): DemoRunnerError | null {
		return this.lastError;
	}

	private onFrame(frame: Frame) {
		if (!this.running) return;
		this.diagnostics.framesSeen += 1;
		if (frame.blendshapes && frame.blendshapes.length) {
			this.lastBlendshapes = {
				blendshapes: frame.blendshapes,
				atMs: frame.timestampMs ?? Date.now(),
			};
		}
		// The box below the chin, for breathing from chest motion (opt-in): every analysed frame,
		// with or without a face (a face gone for over a second drops the motion).
		if (this.opts.chestMotion && frame.data && frame.timestampMs != null)
			this.opts.chestMotion.push(frame, frame.landmarks ?? null);
		// Capture the head box for framing guidance. Wall-clock `atMs` (not the
		// frame's media time) so consumers can age it against Date.now().
		if (frame.landmarks && frame.landmarks.length) {
			const mesh = faceBoxFromLandmarks(frame.landmarks);
			if (mesh) {
				this.lastFaceBox = { box: padFaceBoxToHead(mesh), atMs: Date.now() };
			}
		}
		const now =
			typeof performance !== "undefined" ? performance.now() : Date.now();
		this.frameTimes.push(now);
		if (this.frameTimes.length > 30) this.frameTimes.shift();
		if (this.frameTimes.length >= 2) {
			const dt =
				(this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0]) /
				1000;
			if (dt > 0) this.lastFps = (this.frameTimes.length - 1) / dt;
		}
		const useSkinMask = this.opts.useSkinMask !== false;
		if (this.opts.onRoiSamples && frame.namedRois) {
			const sampler = this.opts.roiPixelSampler ?? ELATA_YCBCR_V1_PIXEL_SAMPLER;
			const samples = Object.entries(frame.namedRois).flatMap(([name, roi]) =>
				roi
					? [
							sampleRppgRoi(
								frame,
								name as keyof typeof frame.namedRois,
								roi,
								this.diagnostics.roiGeometryProfileId,
								sampler,
							),
						]
					: [],
			);
			this.opts.onRoiSamples(samples);
		}
		let rgb = { r: 0, g: 0, b: 0 };
		let skinRatio = 1;
		let clipRatio = 0;
		let intensity = 0;
		let motion = 0;
		let roiSource: DemoRunnerDiagnostics["lastRoiSource"] = null;
		let fusionSamples: FusionSamples | null = null;
		let fusionResult: MultiRoiFusionResult | null = null;

		const rois = frame.rois && frame.rois.length > 0 ? frame.rois : null;
		// No forehead and cheeks this frame: tell the check, so a rate proven on a face
		// does not outlive the face (see FACE_GONE_MS in pulseCheck.ts).
		if (
			this.opts.pulseChecker &&
			(!rois || rois.length < 3) &&
			frame.timestampMs != null
		) {
			this.opts.pulseChecker.faceLost(frame.timestampMs);
		}
		if ((rois || frame.roi) && this.noFaceSinceMs != null) {
			// The face is back. After an absence long enough for the session to have stopped
			// reporting, start the analysis afresh, or the first number back would come from a
			// window still holding the frames before the face was lost.
			if (this.faceAbsentMs() >= FACE_GONE_RESET_MS) {
				this.fuser?.reset();
				(this.processor as { reset?: () => void }).reset?.();
			}
			this.noFaceSinceMs = null;
		}
		// One skin-masked mean per region box and sampler per frame: the aggregate, the fuser and the
		// pulse check read the same boxes (the same pure function on the same pixels gave three equal
		// results, three times the pixel work).
		const sample = frameSampleMemo(frame);
		if (rois) {
			roiSource = "multi_roi";
			this.diagnostics.framesWithMultiRoi += 1;
			const agg = aggregateRgbFromRois(
				frame,
				rois,
				useSkinMask,
				this.opts.roiPixelSampler,
				sample,
			);
			rgb = { r: agg.r, g: agg.g, b: agg.b };
			skinRatio = agg.skinRatio;
			clipRatio = agg.clipRatio;
			intensity = agg.g;
			// Multi-ROI fusion: per-region CHROM blended by in-band SNR. The
			// aggregate above is still computed for diagnostics/onStats and as the
			// fallback if the fuser can't produce a valid frame this tick.
			if (this.fuser && useSkinMask) {
				fusionSamples = this.sampleFusionRegions(frame, rois, sample);
				if (fusionSamples && !this.fixes.realFrameRate) {
					// Switch off: the published path, one fuser step per camera frame, here.
					fusionResult = this.fuser.pushFrame(fusionSamples);
					fusionSamples = null;
				}
			}
			if (
				this.opts.pulseChecker &&
				rois.length >= 3 &&
				frame.timestampMs != null
			) {
				// Same three region boxes and the same skin-masked mean the fuser uses.
				// And a patch of wall beside the face, for the wall check: only its
				// pixels that do not look like skin, so a face edge or an ear in it
				// cannot carry the person's own pulse into the wall.
				const wall = frame.landmarks
					? this.wallTracker.next(frame.landmarks, frame)
					: null;
				this.opts.pulseChecker.push(
					frame.timestampMs,
					rois.slice(0, 3).map((roi) => {
						const c = clampRoiToFrame(roi, frame.width, frame.height);
						return sample(c, undefined);
					}),
					wall?.rgb,
					frame.landmarks && !wall
						? wallMissReason(frame.landmarks, frame.width, frame.height)
						: undefined,
					// The head's position, for the headMotion rule: a rate the head's own
					// movement keeps time with (a nod) is the movement's, not a pulse.
					frame.landmarks ? headCentre(frame.landmarks, frame.width, frame.height) : null,
					// The wall as the camera read it, for its brightness (rule darkWall): the
					// continuous wall above carries a darker patch on at a brighter one's level.
					wall?.raw,
				);
			}
			if (frame.roi) {
				motion = computeMotion(frame.roi, this.lastCenter);
				this.lastCenter = {
					x: frame.roi.x + frame.roi.w * 0.5,
					y: frame.roi.y + frame.roi.h * 0.5,
				};
			}
		} else {
			let roi = this.opts.roi;
			if (typeof roi === "undefined") {
				roi = frame.roi ?? null;
			}
			if (frame.roi) {
				this.diagnostics.framesWithFaceRoi += 1;
				roiSource = "face_roi";
			}
			if (
				!roi &&
				(frame.width <= 0 || frame.height <= 0 || !frame.data.length)
			) {
				this.recordDrop("frame_invalid");
				return;
			}
			if (!roi && this.opts.requireFace && this.fixes.noFaceNoReading) {
				this.noFaceSinceMs ??= frame.timestampMs ?? Date.now();
				this.noFaceLastMs = frame.timestampMs ?? Date.now();
				this.recordDrop("no_face");
				return;
			}
			if (!roi) {
				roi = {
					x: Math.floor((frame.width - 100) / 2),
					y: Math.floor((frame.height - 100) / 2),
					w: 100,
					h: 100,
				};
				this.diagnostics.framesWithFallbackRoi += 1;
				roiSource = "fallback_roi";
			}
			const clamped = clampRoiToFrame(roi, frame.width, frame.height);
			const smoothed = smoothRoi(
				this.smoothedRoi,
				clamped,
				this.opts.roiSmoothingAlpha,
			);
			const smoothedClamped = clampRoiToFrame(
				smoothed,
				frame.width,
				frame.height,
			);
			this.smoothedRoi = smoothedClamped;
			if (useSkinMask) {
				const rgbRes = sampleRgbWithSkinMask(
					frame,
					smoothedClamped,
					this.opts.roiPixelSampler,
				);
				rgb = { r: rgbRes.r, g: rgbRes.g, b: rgbRes.b };
				skinRatio = rgbRes.skinRatio;
				clipRatio = rgbRes.clipRatio;
				intensity = rgbRes.g;
			} else {
				rgb = averageRgbInROI(
					frame,
					smoothedClamped.x,
					smoothedClamped.y,
					smoothedClamped.w,
					smoothedClamped.h,
				);
				intensity = rgb.g;
				skinRatio = 1;
				clipRatio = 0;
			}
			motion = computeMotion(smoothedClamped, this.lastCenter);
			this.lastCenter = {
				x: smoothedClamped.x + smoothedClamped.w * 0.5,
				y: smoothedClamped.y + smoothedClamped.h * 0.5,
			};
		}
		if (!Number.isFinite(intensity)) {
			this.recordDrop("non_finite_intensity");
			return;
		}
		skinRatio = smooth01(
			this.smoothedSkinRatio,
			skinRatio,
			this.opts.skinRatioSmoothingAlpha ?? 0.2,
		);
		this.smoothedSkinRatio = skinRatio;
		const ts = frame.timestampMs ?? Date.now();
		const proc = this.processor as any;
		// A frame that bypasses the grid pushes its own timestamp; the grid restarts after it, or
		// it would later fill times before that timestamp and send the processor samples out of order.
		if (!fusionSamples) this.gridPrev = null;
		try {
			if (fusionSamples) {
				this.pushOnGrid(
					proc,
					{ t: ts, regions: fusionSamples, rgb },
					skinRatio,
					motion,
					clipRatio,
				);
			} else if (
				fusionResult?.valid &&
				typeof proc.pushFusedSample === "function"
			) {
				// realFrameRate off: the published path. Fused pulse already carries the
				// per-region projection + SNR-weighted blending; feed it straight to
				// spectral BPM/HRV, with the fused SNR as quality.
				proc.pushFusedSample(ts, fusionResult.fused, fusionResult.fusedSnr);
				this.diagnostics.lastProcessorMethod = "fused";
				this.diagnostics.framesWithFusion += 1;
				this.diagnostics.lastFusionWeights = fusionResult.weights;
				this.diagnostics.lastFusedSnr = fusionResult.fusedSnr;
			} else if (typeof proc.pushSampleRgbMeta === "function") {
				proc.pushSampleRgbMeta(
					ts,
					rgb.r,
					rgb.g,
					rgb.b,
					skinRatio,
					motion,
					clipRatio,
				);
				this.diagnostics.lastProcessorMethod = "rgb_meta";
			} else if (typeof proc.pushSampleRgb === "function") {
				proc.pushSampleRgb(ts, rgb.r, rgb.g, rgb.b, skinRatio);
				this.diagnostics.lastProcessorMethod = "rgb";
			} else if (typeof proc.pushSample === "function") {
				proc.pushSample(ts, intensity);
				this.diagnostics.lastProcessorMethod = "intensity";
			} else {
				throw new TypeError("processor has no push sample API");
			}
		} catch (error) {
			this.recordDrop("processor_error");
			this.running = false;
			void this.source.stop().catch(() => {});
			this.recordError(error);
			return;
		}
		this.diagnostics.samplesPushed += 1;
		// Once a second, the SDK's own rate to the pulse check, for its opt-in agreement path.
		// Only when that path is on: reading the processor runs its analysis, and an extra read
		// would change what the SDK's own rate does.
		if (
			this.opts.pulseChecker?.agreementOn &&
			(this.lastOpinionMs == null || ts - this.lastOpinionMs >= 1000)
		) {
			this.lastOpinionMs = ts;
			const bpm =
				typeof proc.getMetrics === "function" ? proc.getMetrics()?.bpm : null;
			this.opts.pulseChecker.secondOpinion(bpm ?? null);
		}
		this.diagnostics.lastDropReason = null;
		this.diagnostics.lastTimestampMs = ts;
		this.diagnostics.lastIntensity = intensity;
		this.diagnostics.lastSkinRatio = skinRatio;
		this.diagnostics.lastClipRatio = clipRatio;
		this.diagnostics.lastMotion = motion;
		this.diagnostics.lastRoiSource = roiSource;
		this.emitDiagnostics();
		if (this.opts.onStats) {
			this.opts.onStats({
				intensity,
				skinRatio,
				fps: this.lastFps,
				r: rgb.r,
				g: rgb.g,
				b: rgb.b,
				clipRatio,
				motion,
			});
		}
	}

	/**
	 * Feed the fuser and the processor on the evenly spaced grid they were built
	 * for (`sampleRate`, 30 by default). Both read their input as one sample per
	 * 1/sampleRate seconds, so a camera that delivers fewer frames (15 to 25 a
	 * second on a laptop in dim light) would scale every rate they report by
	 * delivered/assumed. Each grid time between the previous frame and this one
	 * gets the two frames' region means, linearly interpolated, so a slowed
	 * camera reads close to the same rate as a full-rate one. A gap longer than GRID_MAX_GAP_MS is a stall, not a slow camera:
	 * the grid restarts at the new frame instead of drawing a line across it.
	 */
	private pushOnGrid(
		proc: any,
		cur: GridSample,
		skinRatio: number,
		motion: number,
		clipRatio: number,
	) {
		const step = 1000 / (this.opts.sampleRate ?? 30);
		const prev = this.gridPrev;
		const ticks: GridSample[] = [];
		if (!prev || cur.t <= prev.t || cur.t - prev.t > GRID_MAX_GAP_MS) {
			ticks.push(cur);
			this.gridNextT = cur.t + step;
		} else {
			// 1e-6 ms: a grid time that equals the frame time up to float rounding is this frame.
			for (; this.gridNextT <= cur.t + 1e-6; this.gridNextT += step) {
				ticks.push(interpolateGrid(prev, cur, this.gridNextT));
			}
		}
		this.gridPrev = cur;
		for (const tick of ticks) {
			const fused = this.fuser?.pushFrame(tick.regions) ?? null;
			if (fused?.valid && typeof proc.pushFusedSample === "function") {
				// Fused pulse already carries CHROM + SNR-weighted blending; feed it
				// straight to spectral BPM/HRV, with the fused SNR as quality.
				proc.pushFusedSample(tick.t, fused.fused, fused.fusedSnr);
				this.diagnostics.lastProcessorMethod = "fused";
				this.diagnostics.framesWithFusion += 1;
				this.diagnostics.lastFusionWeights = fused.weights;
				this.diagnostics.lastFusedSnr = fused.fusedSnr;
			} else if (typeof proc.pushSampleRgbMeta === "function") {
				proc.pushSampleRgbMeta(
					tick.t,
					tick.rgb.r,
					tick.rgb.g,
					tick.rgb.b,
					skinRatio,
					motion,
					clipRatio,
				);
				this.diagnostics.lastProcessorMethod = "rgb_meta";
			}
		}
	}

	/**
	 * Per-region skin-masked RGB for the fuser. The sub-ROIs arrive ordered as
	 * {@link FUSION_ROIS} (forehead, leftCheek, rightCheek) from
	 * `computeFusionSubRois`; a region with too little skin is skipped by the fuser.
	 */
	private sampleFusionRegions(
		frame: Frame,
		rois: { x: number; y: number; w: number; h: number }[],
		sample: RegionSampler = (c, sampler) => sampleRgbWithSkinMask(frame, c, sampler),
	): FusionSamples | null {
		if (!this.fuser) return null;
		const samples: FusionSamples = {};
		const n = Math.min(FUSION_ROIS.length, rois.length);
		for (let i = 0; i < n; i++) {
			const c = clampRoiToFrame(rois[i]!, frame.width, frame.height);
			const s = sample(c, this.opts.roiPixelSampler);
			samples[FUSION_ROIS[i]!] = {
				r: s.r,
				g: s.g,
				b: s.b,
				skinFraction: s.skinRatio,
			};
		}
		return samples;
	}

	private recordDrop(reason: DemoRunnerDropReason) {
		this.diagnostics.droppedFrames += 1;
		this.diagnostics.lastDropReason = reason;
		this.emitDiagnostics();
	}

	private recordError(cause: unknown) {
		const error: DemoRunnerError = {
			code: "processor_error",
			stage: "processor",
			message:
				cause instanceof Error
					? cause.message
					: "The rPPG processor rejected a frame sample.",
			timestampMs: Date.now(),
			diagnostics: this.getDiagnostics(),
			cause,
		};
		this.lastError = error;
		this.opts.onError?.(error);
	}

	private emitDiagnostics() {
		if (this.opts.onDiagnostics) {
			this.opts.onDiagnostics(this.getDiagnostics());
		}
	}
}

function clampRoiToFrame(
	roi: { x: number; y: number; w: number; h: number },
	width: number,
	height: number,
) {
	const x = Math.max(0, Math.min(width - 1, Math.floor(roi.x)));
	const y = Math.max(0, Math.min(height - 1, Math.floor(roi.y)));
	const w = Math.max(1, Math.min(width - x, Math.floor(roi.w)));
	const h = Math.max(1, Math.min(height - y, Math.floor(roi.h)));
	return { x, y, w, h };
}

function smoothRoi(
	prev: { x: number; y: number; w: number; h: number } | null,
	next: { x: number; y: number; w: number; h: number },
	alpha = 0.2,
) {
	if (!prev) return next;
	const prevCx = prev.x + prev.w * 0.5;
	const prevCy = prev.y + prev.h * 0.5;
	const nextCx = next.x + next.w * 0.5;
	const nextCy = next.y + next.h * 0.5;
	const dx = nextCx - prevCx;
	const dy = nextCy - prevCy;
	const maxDim = Math.max(prev.w, prev.h);
	if (Math.sqrt(dx * dx + dy * dy) > maxDim * 0.35) {
		return next;
	}
	const a = Math.min(0.9, Math.max(0.05, alpha));
	return {
		x: prev.x + (next.x - prev.x) * a,
		y: prev.y + (next.y - prev.y) * a,
		w: prev.w + (next.w - prev.w) * a,
		h: prev.h + (next.h - prev.h) * a,
	};
}

type RegionBox = { x: number; y: number; w: number; h: number };
type RegionSampler = (
	box: RegionBox,
	sampler: RoiPixelSampler | undefined,
) => ReturnType<typeof sampleRgbWithSkinMask>;

/**
 * sampleRgbWithSkinMask for one frame, each (box, sampler) computed once. Samplers are told apart by identity
 * (the default is `undefined`), never by their ids, so no custom sampler can stand in for another.
 */
function frameSampleMemo(frame: Frame): RegionSampler {
	const bySampler = new Map<RoiPixelSampler | undefined, Map<string, ReturnType<typeof sampleRgbWithSkinMask>>>();
	return (c, sampler) => {
		let memo = bySampler.get(sampler);
		if (!memo) bySampler.set(sampler, (memo = new Map()));
		const key = `${c.x},${c.y},${c.w},${c.h}`;
		let v = memo.get(key);
		if (v === undefined) {
			v = sampleRgbWithSkinMask(frame, c, sampler);
			memo.set(key, v);
		}
		return v;
	};
}

function aggregateRgbFromRois(
	frame: Frame,
	rois: { x: number; y: number; w: number; h: number }[],
	useSkinMask: boolean,
	pixelSampler?: RoiPixelSampler,
	sample: RegionSampler = (c, sampler) => sampleRgbWithSkinMask(frame, c, sampler),
) {
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	let sumW = 0; // weight for RGB (skin pixels)
	let sumArea = 0;
	let sumSkinArea = 0;
	let sumClipArea = 0;
	for (const roi of rois) {
		const clamped = clampRoiToFrame(roi, frame.width, frame.height);
		const area = clamped.w * clamped.h;
		sumArea += area;
		if (useSkinMask) {
			const rgbRes = sample(clamped, pixelSampler);
			// Keep ROI contribution from collapsing to near-zero on transient skin-mask misses.
			const weight = area * Math.max(0.15, rgbRes.skinRatio);
			sumR += rgbRes.r * weight;
			sumG += rgbRes.g * weight;
			sumB += rgbRes.b * weight;
			sumW += weight;
			sumSkinArea += rgbRes.skinRatio * area;
			sumClipArea += rgbRes.clipRatio * area;
		} else {
			const rgbRes = averageRgbInROI(
				frame,
				clamped.x,
				clamped.y,
				clamped.w,
				clamped.h,
			);
			sumR += rgbRes.r * area;
			sumG += rgbRes.g * area;
			sumB += rgbRes.b * area;
			sumW += area;
			sumSkinArea += area;
		}
	}
	if (sumW <= 0 || sumArea <= 0) {
		return { r: 0, g: 0, b: 0, skinRatio: 0, clipRatio: 0 };
	}
	return {
		r: sumR / sumW,
		g: sumG / sumW,
		b: sumB / sumW,
		skinRatio: sumSkinArea / sumArea,
		clipRatio: sumClipArea / sumArea,
	};
}

function sampleRgbWithSkinMask(
	frame: Frame,
	roi: { x: number; y: number; w: number; h: number },
	pixelSampler?: RoiPixelSampler,
) {
	if (!pixelSampler) {
		return averageRgbInROIWithSkinMaskStats(frame, roi.x, roi.y, roi.w, roi.h);
	}
	const sample = pixelSampler.sample(frame, roi);
	return {
		r: sample.r,
		g: sample.g,
		b: sample.b,
		skinRatio: sample.effectiveSkinFraction,
		clipRatio: sample.clipRatio,
	};
}

function computeMotion(
	roi: { x: number; y: number; w: number; h: number },
	last: { x: number; y: number } | null,
) {
	if (!last) return 0;
	const cx = roi.x + roi.w * 0.5;
	const cy = roi.y + roi.h * 0.5;
	const dx = cx - last.x;
	const dy = cy - last.y;
	const dist = Math.sqrt(dx * dx + dy * dy);
	const norm = Math.max(1, Math.max(roi.w, roi.h));
	return Math.min(1, dist / norm);
}

function smooth01(prev: number | null, next: number, alpha: number): number {
	const n = Math.max(0, Math.min(1, next));
	if (prev === null || !Number.isFinite(prev)) return n;
	const a = Math.min(0.8, Math.max(0.05, alpha));
	const delta = n - prev;
	const effectiveAlpha = Math.abs(delta) > 0.3 ? a * 0.35 : a;
	return Math.max(0, Math.min(1, prev + delta * effectiveAlpha));
}
