import { type FinderCandidate, type FinderDelegate, TrialFaceFinder } from "./faceFinderTrial.js";
export type FaceLandmarkerPoint = {
    x: number;
    y: number;
    z?: number;
};
export type FaceLandmarkerResult = {
    faceLandmarks: FaceLandmarkerPoint[][];
    faceBlendshapes?: Array<{
        categories: Array<{
            categoryName: string;
            score: number;
        }>;
    }>;
};
/** Minimal surface of MediaPipe's FaceLandmarker used by the frame source (mockable in tests). */
export type FaceLandmarkerLike = {
    detectForVideo(image: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): FaceLandmarkerResult;
    close?: () => void;
};
export type LoadFaceLandmarkerOptions = {
    /** Base URL for the tasks-vision ESM bundle (vision_bundle.mjs lives here). */
    visionCdnBase?: string;
    /** Base URL for the tasks-vision WASM fileset. Defaults to `${visionCdnBase}/wasm`. */
    wasmBase?: string;
    /** URL of the face_landmarker.task model asset. */
    modelAssetPath?: string;
};
/**
 * Load a FaceLandmarker (with blendshape output) from CDN. Returns null when
 * face tracking is disabled or unavailable so callers can fall back to the
 * plain video-frame source.
 */
export declare function loadFaceLandmarker(options?: LoadFaceLandmarkerOptions): Promise<FaceLandmarkerLike | null>;
/**
 * Every delegate that builds, in `order` (GPU first, then CPU), each with what TrialFaceFinder needs:
 * the GPU one draws on a canvas made here, so its context loss can be seen (MediaPipe draws on its own
 * OffscreenCanvas unless handed one, and does not rebuild after losing it). A delegate that throws is
 * simply absent; none at all is empty. `delegates` restricts the order (for tests and diagnostics).
 */
export declare function loadFaceFinderCandidates(options?: LoadFaceLandmarkerOptions, delegates?: readonly FinderDelegate[]): Promise<FinderCandidate[]>;
/** One finder on `delegate`, with its own canvas on the GPU (Safari: MediaPipe's own choice). */
export declare function buildFinder(mod: any, fileset: unknown, modelAssetPath: string, delegate: FinderDelegate): Promise<FinderCandidate | null>;
/**
 * The face finder on the faster delegate for this device, chosen on the live video, and rebuilt when it
 * dies (TrialFaceFinder). Null when no delegate builds or face tracking is disabled.
 */
export declare function loadTrialFaceFinder(options?: LoadFaceLandmarkerOptions, onEvent?: (event: {
    type: string;
    [k: string]: unknown;
}) => void): Promise<TrialFaceFinder | null>;
//# sourceMappingURL=mediapipeLoader.d.ts.map