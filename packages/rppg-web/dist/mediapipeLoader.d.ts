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
    detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
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
//# sourceMappingURL=mediapipeLoader.d.ts.map