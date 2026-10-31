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
export declare const LANDMARK_STILL_REUSE_FRAMES = 5;
export declare const LANDMARK_STILL_REUSE_MAX_MS = 300;
export declare const LANDMARK_STILL_SHIFT = 0.02;
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
    /** The two finder runs in a row put the face still (LANDMARK_STILL_SHIFT), so its landmarks may be reused for longer. */
    private faceStill;
    /**
     * Whether the check's blink gate is satisfied (PulseCheck.blinkGateOpen, wired by DemoRunner): the longer reuse
     * waits for it, so the finder samples the eyes at least every LANDMARK_REUSE_MAX_MS until the gate has its blink (a
     * blink lasts about 100 to 400 ms; sampling every 200 ms held the gate for 11 and 15 s in 2 of 4 runs, and a private
     * blink detector in this source disagreed with the check's and held it for 27 s, 2026-10-31). A photo never blinks,
     * so it never gets the longer reuse. Without a check, never.
     */
    blinkGateOpen: () => boolean;
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