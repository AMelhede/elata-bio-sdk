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
 * With `sparseFaceFinder` on, the face finder is asked at most this often; the frames in between are
 * read with the last face it found. The finder is the costliest step per frame: an app built on this
 * package measured it at about 20 ms of a 33 ms frame on a laptop, where finding the face on every
 * frame let a 30 fps camera arrive as 8 to 19 frames a second, and asks it at this interval. A still
 * face does not move in a tenth of a second, a moving head is followed within one, and a nod (one or
 * two a second) is still seen five or more times per cycle by the movement rule.
 */
export declare const FACE_FINDER_EVERY_MS = 100;
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
    /** The last answer from the face finder and when it was asked (sparseFaceFinder). */
    private lastFace;
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