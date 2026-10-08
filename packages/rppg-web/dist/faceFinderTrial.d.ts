import type { FaceLandmarkerLike, FaceLandmarkerResult } from "./mediapipeLoader.js";
/**
 * The face finder on the faster of its two delegates, chosen on the live video, and rebuilt when it dies.
 *
 * MediaPipe's face finder runs on the CPU unless asked for the GPU. Which is faster depends on the device,
 * and only the clock can tell: on a laptop the CPU delegate alone can hold a camera to a few frames a
 * second, below where beat detection goes blind, while under a software GL (headless browsers) the GPU
 * delegate is several times slower than the CPU. So every delegate that builds is tried on the live video
 * for a few calls and the faster is kept.
 *
 * A GPU context can also die, typically while the tab is hidden, and MediaPipe does not rebuild after it: it
 * keeps answering "no face" from a dead context. So a lost context, or a return to the page followed by
 * NO_FACE_AFTER_RETURN_MS without a face, builds a fresh finder of the same delegate.
 *
 * Values chosen by measurement on recorded captures.
 */
export type FinderDelegate = "GPU" | "CPU";
/** GPU first, CPU as the fallback: the order MediaPipe recommends where a GPU exists. */
export declare const FINDER_DELEGATE_ORDER: readonly FinderDelegate[];
export interface FinderCandidate {
    finder: FaceLandmarkerLike;
    delegate: FinderDelegate;
    /** True once this finder's GPU context was lost (absent on CPU). */
    isLost?: () => boolean;
}
/**
 * The calls each candidate gets: the first ones pay one-off costs (shader compilation on the GPU, WASM
 * warm-up on the CPU) and are not counted; ten timed calls tell tens of milliseconds from hundreds.
 */
export declare const FINDER_TRIAL_WARMUP_CALLS = 3;
export declare const FINDER_TRIAL_TIMED_CALLS = 10;
/**
 * How much faster a later candidate must be to displace an earlier one. CPU inference runs on the page's
 * own main thread and competes with every camera frame while the GPU mostly waits, so a CPU that wins a
 * short trial narrowly can still run slower live, with longer stalls; a lead inside 25% is not worth that.
 */
export declare const FINDER_SWITCH_MARGIN = 0.25;
/**
 * After a return from a hidden page, how long without a face before the finder is rebuilt: a dead finder
 * stays dark, while a live one finds a face in its first few calls.
 */
export declare const NO_FACE_AFTER_RETURN_MS = 2000;
export type FaceRebuildReason = "context-lost" | "no-face-after-return";
/** The fastest candidate by mean call time; an earlier one keeps its place unless clearly beaten. */
export declare function pickFastest<T extends {
    delegate: FinderDelegate;
    meanMs: number;
}>(trials: readonly T[]): T | null;
/** Whether to throw the finder away and build a fresh one, and why. */
export declare function faceRebuildReason(args: {
    contextLost: boolean;
    /** When the page last became visible after being hidden, or null once handled. */
    returnedAtMs: number | null;
    lastFaceAtMs: number;
    nowMs: number;
}): FaceRebuildReason | null;
export declare class TrialFaceFinder implements FaceLandmarkerLike {
    private candidates;
    private current;
    private trial;
    private readonly results;
    private readonly now;
    private readonly rebuild?;
    private readonly onEvent?;
    private lastFaceAtMs;
    private returnedAtMs;
    private rebuilding;
    constructor(candidates: readonly FinderCandidate[], opts?: {
        now?: () => number;
        rebuild?: (delegate: FinderDelegate) => Promise<FinderCandidate | null>;
        onEvent?: (event: {
            type: string;
            [k: string]: unknown;
        }) => void;
    });
    /** The delegate answering now. */
    get delegate(): FinderDelegate;
    /** Each tried delegate's mean call time, in the order tried. */
    get trialResults(): readonly {
        delegate: FinderDelegate;
        meanMs: number;
    }[];
    /** The page became visible again after being hidden (see NO_FACE_AFTER_RETURN_MS). */
    noteReturn(atMs?: number): void;
    detectForVideo(input: never, timestampMs: number): FaceLandmarkerResult;
    close(): void;
    private noteTrialCall;
    private startRebuild;
}
//# sourceMappingURL=faceFinderTrial.d.ts.map