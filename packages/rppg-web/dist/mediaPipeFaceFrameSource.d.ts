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
 * (measured 2026-10-02, owner's laptop and a 1280x960 test feed alike).
 */
export declare const MAX_ANALYSIS_WIDTH = 640;
/**
 * The face finder runs at most once per this much VIDEO time; frames in between are sampled
 * at the last landmarks. Every frame's colour is a sample of the pulse, so dropping frames
 * costs signal; the face's position changes far more slowly (a head turning steadily moves a
 * few percent of a face-width per 33 ms frame), so ~16 position updates a second keep the
 * regions on the face. Before this the face finder ran on every frame and was the costliest
 * step: on the owner's laptop 30 frames a second arrived and ~23 were analysed (2026-10-02).
 * Video time, not wall time, so a slowed replay sees the same head motion per update as live.
 */
export declare const FACE_DETECT_EVERY_MS = 60;
/** Analysis frame size for a video size: same aspect, at most MAX_ANALYSIS_WIDTH wide. */
export declare function analysisSize(videoWidth: number, videoHeight: number): {
    width: number;
    height: number;
};
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
    constructor(video: HTMLVideoElement, faceLandmarker: FaceLandmarkerLike, fps?: number, roiGeometryProfile?: RoiGeometryProfile, fixes?: RppgFixesOption);
    start(): Promise<void>;
    stop(): Promise<void>;
    getLastError(): FrameSourceError | null;
    /** The last face-finder result and the video time it was found at (FACE_DETECT_EVERY_MS). */
    private lastDetect;
    /** Switches this source honours (analysisWidth, faceFinderInterval). */
    readonly fixes: ResolvedRppgFixSwitches;
    /** Canvas size for a video size: capped at MAX_ANALYSIS_WIDTH with analysisWidth on, else full size as published. */
    private frameSize;
    private detectAndEmit;
    private landmarksToROI;
    private smoothRoi;
    private reportError;
}
//# sourceMappingURL=mediaPipeFaceFrameSource.d.ts.map