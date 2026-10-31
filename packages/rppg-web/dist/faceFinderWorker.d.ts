import type { FaceLandmarkerPoint, LoadFaceLandmarkerOptions } from "./mediapipeLoader.js";
/** Cores (navigator.hardwareConcurrency) below which the worker is not started: with one core it bought nothing. */
export declare const FINDER_WORKER_MIN_CORES = 4;
/**
 * The oldest worker landmarks a frame uses. The face regions are already smoothed with a lag of about 270 ms (alpha
 * 0.25 at 15 frames a second), and on received phone sessions a head moves a median 0.46% of the face's width in 250 ms
 * (95th percentile 7.6%; evidence repo tools/headstep.mjs), so landmarks this old sit inside the lag the regions have.
 */
export declare const WORKER_LANDMARK_MAX_MS = 300;
export type FaceFinderWorkerBlendshape = {
    categoryName: string;
    score: number;
};
/** What the frame source needs from the worker. */
export type FaceFinderWorker = {
    /** The model is loaded and frames can be sent. */
    readonly ready: boolean;
    /** A frame is being found; the next one waits. */
    readonly busy: boolean;
    /** The newest landmarks and when their frame was taken (frame clock), or null. */
    readonly latest: {
        landmarks: FaceLandmarkerPoint[] | null;
        atMs: number;
    } | null;
    /** Send one frame (transferred); ignored while busy or not ready. */
    submit(image: ImageBitmap, atMs: number): void;
    /** The blendshapes of the newest result, once: a frame takes them so a blink score is never counted twice. */
    takeBlendshapes(): FaceFinderWorkerBlendshape[] | null;
    close(): void;
};
/**
 * Start the face finder in a worker, or null where that cannot help or cannot run (fewer than FINDER_WORKER_MIN_CORES
 * cores, no Worker, no createImageBitmap, no Blob URLs). Loads the same tasks-vision bundle, wasm and model as
 * loadFaceLandmarker, from the same options.
 */
export declare function startFaceFinderWorker(options?: LoadFaceLandmarkerOptions, env?: {
    navigator?: {
        hardwareConcurrency?: number;
    };
    Worker?: unknown;
    createImageBitmap?: unknown;
    URL?: unknown;
    Blob?: unknown;
    location?: {
        href: string;
    };
}): FaceFinderWorker | null;
//# sourceMappingURL=faceFinderWorker.d.ts.map