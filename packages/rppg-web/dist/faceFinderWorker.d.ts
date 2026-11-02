/**
 * Session option faceFinderWorker (off unless set): the face finder (MediaPipe FaceLandmarker) runs in a Web
 * Worker, so the page's own thread reads every camera frame's face regions instead of waiting on the finder.
 *
 * Why: the finder is the largest share of a page's CPU on a slow device, and a phone that cannot keep up analyses
 * only part of the frames its camera delivers. A frame not analysed is signal lost. With the finder on another core,
 * the regions are placed from the newest landmarks the worker has returned, at most FACE_WORKER_MAX_AGE_MS old (the
 * age the still-face reuse already allows), and the frames between finds reuse them as landmark reuse does today.
 *
 * The worker loads the same tasks-vision bundle, wasm and model as loadFaceLandmarker, from the same URLs, with the
 * same options, so the landmarks are the finder's own; only where it runs changes.
 */
import type { LoadFaceLandmarkerOptions } from "./mediapipeLoader.js";
/** The oldest worker result still used to place the regions, ms: LANDMARK_STILL_REUSE_MAX_MS. */
export declare const FACE_WORKER_MAX_AGE_MS = 300;
export type FaceFinderPoint = {
    x: number;
    y: number;
    z?: number;
};
export type FaceFinderBlendshape = {
    categoryName: string;
    score: number;
};
/** One finder result, on the frame clock of the frame it was asked about. */
export interface FaceFinderResult {
    atMs: number;
    landmarks: FaceFinderPoint[] | null;
    blendshapes?: FaceFinderBlendshape[];
}
/** What the frame source needs of an asynchronous finder (a worker in a browser, a fake in tests). */
export interface AsyncFaceFinder {
    /** True while a frame is with the finder; the source asks again only when it is free. */
    readonly busy: boolean;
    /** Hand the finder one frame. The source calls it only when not busy. */
    request(image: ImageBitmap | HTMLCanvasElement, atMs: number): void;
    /** Results that came back since the last call, oldest first; each is returned once. */
    take(): FaceFinderResult[];
    close(): void;
    /** The last error from the worker, if any (the session falls back to the main-thread finder). */
    readonly error: string | null;
}
/**
 * The worker's own code: a CLASSIC worker. tasks-vision's wasm loader calls importScripts(), which a module worker
 * forbids ("Module scripts don't support importScripts()", Chromium, 2026-11-02), so the worker loads the package's
 * CommonJS bundle (vision_bundle.cjs, the same release as vision_bundle.mjs) with importScripts and a module shim.
 */
export declare function faceWorkerSource(cdn: string, wasmBase: string, modelAssetPath: string): string;
/**
 * A worker-backed finder, or null where a worker cannot be made (no Worker, no Blob URLs, a CSP that forbids
 * it): the session then keeps the main-thread finder, so the option can never leave a page without a face finder.
 * Resolves once the worker has loaded the model, so a failed load also falls back.
 */
export declare function createWorkerFaceFinder(options?: LoadFaceLandmarkerOptions, timeoutMs?: number): Promise<AsyncFaceFinder | null>;
//# sourceMappingURL=faceFinderWorker.d.ts.map