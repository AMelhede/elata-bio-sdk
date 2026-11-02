import {
	type ResolvedRppgFixSwitches,
	type RppgFixesOption,
	resolveFixSwitches,
} from "./fixSwitches";
import {
	type FaceLandmarkPoint,
	Frame,
	type FrameBlendshape,
	FrameSource,
	type FrameSourceError,
	ROI,
} from "./frameSource";
import type { FaceLandmarkerLike } from "./mediapipeLoader";
import {
	ELATA_FACE_YCBCR_V1_PROFILE,
	FUSION_ROI_NAMES,
	type RoiGeometryProfile,
} from "./roiProfile";

/**
 * Frame source backed by MediaPipe FaceLandmarker (tasks-vision). Each frame
 * carries the face ROI + forehead/cheek sub-ROIs (for rPPG) plus the raw
 * landmarks and blendshape coefficients (for affect / valence-arousal).
 *
 * Unlike the legacy FaceMesh (async send/onResults), FaceLandmarker.detectForVideo
 * is synchronous, so detection happens inline in the capture loop.
 */
/**
 * Widest frame the pipeline reads, in pixels. The pulse is the mean colour of a skin patch,
 * and camera noise in that mean falls with the square root of the pixel count, so past a few
 * thousand pixels per patch more resolution buys nothing: at 640 wide a cheek patch still
 * averages thousands of pixels, putting sensor noise far under a 0.5% pulse. Every later step
 * (skin mask, region means, fusion, the pulse check) costs time in proportion to pixels, so
 * reading a 1280x960 camera at full size cut the analysed frame rate to ~7 per second
 * (measured 2026-10-02, a laptop webcam and a 1280x960 test feed alike).
 */
export const MAX_ANALYSIS_WIDTH = 640;

/** Analysis frame size for a video size: same aspect, at most MAX_ANALYSIS_WIDTH wide. */
export function analysisSize(
	videoWidth: number,
	videoHeight: number,
): { width: number; height: number } {
	const scale = Math.min(1, MAX_ANALYSIS_WIDTH / videoWidth);
	return {
		width: Math.max(1, Math.round(videoWidth * scale)),
		height: Math.max(1, Math.round(videoHeight * scale)),
	};
}

/**
 * Fix landmarkEveryOther: how many frames in a row reuse the last landmarks (the finder runs on every third frame), and
 * the oldest landmarks ever reused. Throttled 3x on a generated face (testbed bench/ka-cost.mjs, three runs each,
 * 2026-10-30): every third frame analysed a mean 8.5 frames a second against 7.1 for every other and showed a number
 * on 28 of 45 s in every run (6 to 20 for every other); every fourth was faster on average but collapsed in one run.
 * On received sessions a head moves a median 0.2% of the face's width in 133 ms (95th percentile under 5%; evidence
 * repo tools/headstep.mjs), inside the regions' own smoothing, so two reused frames keep the regions on the same skin.
 * 150 ms is two frames at 15 a second, the slowest the testers' laptops ran.
 */
export const LANDMARK_REUSE_FRAMES = 2;
export const LANDMARK_REUSE_MAX_MS = 150;
/**
 * A still face is reused for longer: once two finder runs in a row put the face within LANDMARK_STILL_SHIFT of its width
 * when projected over LANDMARK_STILL_REUSE_MAX_MS, up to LANDMARK_STILL_REUSE_FRAMES frames reuse it, none older than
 * that. The finder is about 71% of the page's CPU at every third frame (Chromium profile, 4x slowed, 2026-10-31), so
 * this hands frames back where most reading time is spent. A moving face keeps the limits above. Measured 2026-10-31:
 * on received sessions a face moves a median 0.5% of its width in 300 ms (90th percentile 3 to 6%, when people move, the
 * case this excludes); a moving face with a planted 72 bpm pulse, CPU slowed 2x: 8.4 frames analysed a second against 13.1
 * and 14.9 with the finder on every sixth frame, the same seconds with a rate (40/41 against 39/41) and error (0.4 against
 * 0.5 bpm); the generated no-pulse face made up no number in 4 runs each, with the blink gate on or off.
 */
export const LANDMARK_STILL_REUSE_FRAMES = 5;
export const LANDMARK_STILL_REUSE_MAX_MS = 300;
export const LANDMARK_STILL_SHIFT = 0.02;

/** Centre and width of a set of landmarks, in the landmarks' own (normalised) units. */
function faceSpan(lm: readonly { x: number; y: number }[]): { x: number; y: number; w: number } {
	let sx = 0, sy = 0, lo = Infinity, hi = -Infinity;
	for (const p of lm) { sx += p.x; sy += p.y; if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x; }
	return { x: sx / lm.length, y: sy / lm.length, w: Math.max(1e-6, hi - lo) };
}

export class MediaPipeFaceFrameSource implements FrameSource {
	public onFrame: ((frame: Frame) => void) | null = null;
	public onError: ((error: FrameSourceError) => void) | null = null;
	private running = false;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private vfcHandle: number | null = null;
	private smoothedFaceRoi: ROI | null = null;
	private lastError: FrameSourceError | null = null;
	/** Fix landmarkEveryOther: the last landmarks the face finder found and when, and how many frames in a row have reused them since. */
	private lastFound: { landmarks: FaceLandmarkPoint[]; atMs: number } | null = null;
	private reuseRun = 0;
	/** The two finder runs in a row put the face still (LANDMARK_STILL_SHIFT), so its landmarks may be reused for longer. */
	private faceStill = false;
	/**
	 * Whether the check's blink gate is satisfied (PulseCheck.blinkGateOpen, wired by DemoRunner): the longer reuse
	 * waits for it, so the finder samples the eyes at least every LANDMARK_REUSE_MAX_MS until the gate has its blink (a
	 * blink lasts about 100 to 400 ms; sampling every 200 ms held the gate for 11 and 15 s in 2 of 4 runs, and a private
	 * blink detector in this source disagreed with the check's and held it for 27 s, 2026-10-31). A photo never blinks,
	 * so it never gets the longer reuse. Without a check, never.
	 */
	public blinkGateOpen: () => boolean = () => false;

	constructor(
		private video: HTMLVideoElement,
		private faceLandmarker: FaceLandmarkerLike,
		private fps = 30,
		private roiGeometryProfile: RoiGeometryProfile = ELATA_FACE_YCBCR_V1_PROFILE,
		fixes?: RppgFixesOption,
	) {
		this.fixes = resolveFixSwitches(fixes);
		this.canvas = document.createElement("canvas") as HTMLCanvasElement;
		const size = this.frameSize(
			video.videoWidth || (video as any).width || 320,
			video.videoHeight || (video as any).height || 240,
		);
		this.canvas.width = size.width;
		this.canvas.height = size.height;
		const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("2D context unavailable");
		this.ctx = ctx;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		const interval = 1000 / this.fps;
		const vfc = (this.video as any).requestVideoFrameCallback;
		if (typeof vfc === "function") {
			const cb = (now: number, metadata: any) => {
				if (!this.running) return;
				this.detectAndEmit(now, metadata);
				this.vfcHandle = (this.video as any).requestVideoFrameCallback(cb);
			};
			this.vfcHandle = (this.video as any).requestVideoFrameCallback(cb);
		} else {
			const tick = () => {
				if (!this.running) return;
				// performance.now(), the clock requestVideoFrameCallback gives: every frame time in the library is on it.
				// Date.now() here froze the page where the callback is missing (Safari before 15.4, Firefox before 132).
				this.detectAndEmit(performance.now(), null);
				setTimeout(tick, interval);
			};
			tick();
		}
	}

	async stop(): Promise<void> {
		this.running = false;
		this.smoothedFaceRoi = null;
		this.lastFound = null;
		this.reuseRun = 0;
		this.faceStill = false;
		const cancel = (this.video as any).cancelVideoFrameCallback;
		if (this.vfcHandle !== null && typeof cancel === "function") {
			cancel.call(this.video, this.vfcHandle);
			this.vfcHandle = null;
		}
	}

	getLastError(): FrameSourceError | null {
		return this.lastError;
	}

	/** Switches this source honours (analysisWidth). */
	readonly fixes: ResolvedRppgFixSwitches;

	/** Canvas size for a video size: capped at MAX_ANALYSIS_WIDTH with analysisWidth on, else full size as published. */
	private frameSize(w: number, h: number): { width: number; height: number } {
		return this.fixes.analysisWidth
			? analysisSize(w, h)
			: { width: w, height: h };
	}

	private detectAndEmit(now: number, metadata: any) {
		// Resize canvas if the video dimensions became known after construction.
		if (this.video.videoWidth) {
			const size = this.frameSize(
				this.video.videoWidth,
				this.video.videoHeight,
			);
			if (
				this.canvas.width !== size.width ||
				this.canvas.height !== size.height
			) {
				this.canvas.width = size.width;
				this.canvas.height = size.height;
			}
		}

		// Draw the frame once at analysis size, then find the face in THAT image: the face
		// finder scales its input to ~256 px internally, so the full camera frame only cost it
		// a larger copy (measured 2026-10-02: ~62 ms of a ~77 ms frame at 1280x960), and the
		// landmarks now come from exactly the pixels the regions are sampled from, not from a
		// live video frame that may have advanced in between.
		try {
			this.ctx.drawImage(
				this.video as CanvasImageSource,
				0,
				0,
				this.canvas.width,
				this.canvas.height,
			);
		} catch (error) {
			this.reportError("capture_failed", "capture", error);
			return;
		}

		let landmarks: FaceLandmarkPoint[] | null = null;
		let blendshapes: FrameBlendshape[] | undefined;
		// Fix landmarkEveryOther: the LANDMARK_REUSE_FRAMES frames after a found face reuse its landmarks while fresh.
		const longer = this.faceStill && this.blinkGateOpen();
		const maxFrames = longer ? LANDMARK_STILL_REUSE_FRAMES : LANDMARK_REUSE_FRAMES;
		const maxMs = longer ? LANDMARK_STILL_REUSE_MAX_MS : LANDMARK_REUSE_MAX_MS;
		const reuse =
			this.fixes.landmarkEveryOther &&
			this.lastFound != null &&
			this.reuseRun < maxFrames &&
			now - this.lastFound.atMs <= maxMs;
		if (reuse && this.lastFound) {
			landmarks = this.lastFound.landmarks;
			this.reuseRun += 1;
		} else try {
			this.reuseRun = 0;
			const result = this.faceLandmarker.detectForVideo(
				this.fixes.analysisWidth ? this.canvas : this.video,
				now,
			);
			landmarks = result?.faceLandmarks?.[0] ?? null;
			const prev = this.lastFound;
			if (landmarks && landmarks.length && prev && now > prev.atMs) {
				const a = faceSpan(prev.landmarks), b = faceSpan(landmarks);
				const perMs = Math.hypot(b.x - a.x, b.y - a.y) / b.w / (now - prev.atMs);
				this.faceStill = perMs * LANDMARK_STILL_REUSE_MAX_MS < LANDMARK_STILL_SHIFT;
			} else this.faceStill = false;
			this.lastFound = landmarks ? { landmarks, atMs: now } : null;
			const categories = result?.faceBlendshapes?.[0]?.categories;
			if (categories && categories.length) {
				blendshapes = categories.map((c) => ({
					categoryName: c.categoryName,
					score: c.score,
				}));
			}
		} catch (error) {
			this.reportError("face_mesh_failed", "face_mesh", error);
		}

		try {
			const img = this.ctx.getImageData(
				0,
				0,
				this.canvas.width,
				this.canvas.height,
			);
			const ts =
				typeof metadata?.mediaTime === "number" && metadata.mediaTime > 0
					? metadata.mediaTime * 1000
					: now;
			const frame: Frame = {
				data: img.data,
				width: this.canvas.width,
				height: this.canvas.height,
				timestampMs: ts,
			};
			if (landmarks) {
				const raw = this.landmarksToROI(landmarks, frame.width, frame.height);
				const roi = this.smoothRoi(raw, frame.width, frame.height);
				frame.roi = roi;
				// Forehead/cheek sub-ROIs come from the shared overlay geometry, so the
				// pixels sampled for the pulse are exactly the boxes drawn by
				// drawFaceOverlay (single source of truth for ROI placement).
				frame.namedRois = this.roiGeometryProfile.compute(
					landmarks,
					frame.width,
					frame.height,
				);
				frame.rois = FUSION_ROI_NAMES.flatMap((name) =>
					frame.namedRois?.[name] ? [frame.namedRois[name]!] : [],
				);
				frame.landmarks = landmarks;
			}
			if (blendshapes) frame.blendshapes = blendshapes;
			if (this.onFrame) this.onFrame(frame);
		} catch (error) {
			this.reportError("capture_failed", "capture", error);
		}
	}

	private landmarksToROI(
		landmarks: FaceLandmarkPoint[],
		width: number,
		height: number,
	): ROI {
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const p of landmarks) {
			const x = (p.x ?? 0) * width;
			const y = (p.y ?? 0) * height;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
		const padX = Math.max(4, Math.floor((maxX - minX) * 0.15));
		const padY = Math.max(4, Math.floor((maxY - minY) * 0.15));
		const x = Math.max(0, Math.floor(minX - padX));
		const y = Math.max(0, Math.floor(minY - padY));
		const w = Math.min(width - x, Math.ceil(maxX - minX + 2 * padX));
		const h = Math.min(height - y, Math.ceil(maxY - minY + 2 * padY));
		return { x, y, w, h };
	}

	private smoothRoi(next: ROI, width: number, height: number): ROI {
		const prev = this.smoothedFaceRoi;
		if (!prev) {
			const init = clampRoi(next, { x: 0, y: 0, w: width, h: height });
			this.smoothedFaceRoi = init;
			return init;
		}
		const prevCx = prev.x + prev.w * 0.5;
		const prevCy = prev.y + prev.h * 0.5;
		const nextCx = next.x + next.w * 0.5;
		const nextCy = next.y + next.h * 0.5;
		const dx = nextCx - prevCx;
		const dy = nextCy - prevCy;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const maxDim = Math.max(prev.w, prev.h);
		const jump = dist > maxDim * 0.35;
		const alpha = jump ? 0.65 : 0.22;
		const blended: ROI = {
			x: prev.x + (next.x - prev.x) * alpha,
			y: prev.y + (next.y - prev.y) * alpha,
			w: prev.w + (next.w - prev.w) * alpha,
			h: prev.h + (next.h - prev.h) * alpha,
		};
		const clamped = clampRoi(blended, { x: 0, y: 0, w: width, h: height });
		this.smoothedFaceRoi = clamped;
		return clamped;
	}

	private reportError(
		code: FrameSourceError["code"],
		stage: FrameSourceError["stage"],
		cause: unknown,
	) {
		const message =
			cause instanceof Error
				? cause.message
				: stage === "face_mesh"
					? "FaceLandmarker failed while processing a browser video frame."
					: "Failed to capture a browser video frame.";
		const error: FrameSourceError = {
			code,
			stage,
			message,
			timestampMs: Date.now(),
			cause,
		};
		this.lastError = error;
		this.onError?.(error);
	}
}

function clampRoi(roi: ROI, bounds: ROI): ROI {
	const x = Math.max(bounds.x, Math.min(bounds.x + bounds.w - 1, roi.x));
	const y = Math.max(bounds.y, Math.min(bounds.y + bounds.h - 1, roi.y));
	const w = Math.max(1, Math.min(bounds.x + bounds.w - x, roi.w));
	const h = Math.max(1, Math.min(bounds.y + bounds.h - y, roi.h));
	return { x, y, w, h };
}
