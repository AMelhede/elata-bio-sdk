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
/** smallFinderInput: the widest picture the face finder is given (same aspect as the analysed frame). */
export declare const FINDER_INPUT_WIDTH = 320;
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
    /** smallFinderInput: the finder's smaller copy of the analysed frame (made on first use). */
    private finderCanvas;
    private finderCtx;
    constructor(video: HTMLVideoElement, faceLandmarker: FaceLandmarkerLike, fps?: number, roiGeometryProfile?: RoiGeometryProfile, fixes?: RppgFixesOption);
    start(): Promise<void>;
    stop(): Promise<void>;
    getLastError(): FrameSourceError | null;
    /** Switches this source honours (analysisWidth). */
    readonly fixes: ResolvedRppgFixSwitches;
    /** Canvas size for a video size: capped at MAX_ANALYSIS_WIDTH with analysisWidth on, else full size as published. */
    private frameSize;
    /** What the face finder reads: the live video (analysisWidth off, as published), the analysed frame, or with
     *  smallFinderInput a copy of it at most FINDER_INPUT_WIDTH wide. Landmarks are proportions of the picture, so
     *  they place the regions on the analysed frame the same way whichever picture the finder read. */
    private finderInput;
    private detectAndEmit;
    private landmarksToROI;
    private smoothRoi;
    private reportError;
}
//# sourceMappingURL=mediaPipeFaceFrameSource.d.ts.map