import { type ResolvedRppgFixSwitches, type RppgFixesOption } from "./fixSwitches.js";
import { Frame, FrameSource, type FrameSourceError } from "./frameSource.js";
import type { FaceLandmarkerLike } from "./mediapipeLoader.js";
import { type RoiGeometryProfile } from "./roiProfile.js";
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
export declare const MAX_ANALYSIS_WIDTH = 640;
/** Analysis frame size for a video size: same aspect, at most MAX_ANALYSIS_WIDTH wide. */
export declare function analysisSize(videoWidth: number, videoHeight: number): {
    width: number;
    height: number;
};
/**
 * Fix landmarkEveryOther: how many frames in a row reuse the last landmarks (the finder runs on every third frame), and
 * the oldest landmarks ever reused. Throttled 3x on a generated face (testbed bench/ka-cost.mjs, three runs each,
 * 2026-10-30): every third frame analysed a mean 8.5 frames a second against 7.1 for every other and showed a number
 * on 28 of 45 s in every run (6 to 20 for every other); every fourth was faster on average but collapsed in one run.
 * On received sessions a head moves a median 0.2% of the face's width in 133 ms (95th percentile under 5%; evidence
 * repo tools/headstep.mjs), inside the regions' own smoothing, so two reused frames keep the regions on the same skin.
 * 150 ms is two frames at 15 a second, the slowest the testers' laptops ran.
 */
export declare const LANDMARK_REUSE_FRAMES = 2;
export declare const LANDMARK_REUSE_MAX_MS = 150;
export declare class MediaPipeFaceFrameSource implements FrameSource {
    private video;
    private faceLandmarker;
    private fps;
    private roiGeometryProfile;
    onFrame: ((frame: Frame) => void) | null;
    onError: ((error: FrameSourceError) => void) | null;
    private running;
    private canvas;
    private ctx;
    private vfcHandle;
    private smoothedFaceRoi;
    private lastError;
    /** Fix landmarkEveryOther: the last landmarks the face finder found and when, and how many frames in a row have reused them since. */
    private lastFound;
    private reuseRun;
    constructor(video: HTMLVideoElement, faceLandmarker: FaceLandmarkerLike, fps?: number, roiGeometryProfile?: RoiGeometryProfile, fixes?: RppgFixesOption);
    start(): Promise<void>;
    stop(): Promise<void>;
    getLastError(): FrameSourceError | null;
    /** Switches this source honours (analysisWidth). */
    readonly fixes: ResolvedRppgFixSwitches;
    /** Canvas size for a video size: capped at MAX_ANALYSIS_WIDTH with analysisWidth on, else full size as published. */
    private frameSize;
    private detectAndEmit;
    private landmarksToROI;
    private smoothRoi;
    private reportError;
}
//# sourceMappingURL=mediaPipeFaceFrameSource.d.ts.map