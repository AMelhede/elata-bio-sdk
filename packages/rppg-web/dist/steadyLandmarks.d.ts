/**
 * Face points that glide instead of snapping (session option `steadyLandmarks`, off unless set).
 *
 * The face finder returns each landmark with its own frame-to-frame jitter, and every region, the forehead pool and the
 * wall are cut from those points, so each new find moves the region edges over the skin. On received files the forehead
 * colour changed 0.82% between frames where the finder re-found the face against 0.49% where it kept the box (laptops;
 * phones 2.50% against 1.99%), the largest noise source left on laptops. The fix the field uses for exactly this is the
 * One Euro filter (Casiez, Roussel and Vogel, CHI 2012, doi 10.1145/2207676.2208639), a low-pass whose cutoff rises
 * with speed: steady points at rest, little lag when the head moves. MediaPipe smooths its own landmarks the same way.
 *
 * One cutoff for the whole face, from the speed of its centre in face widths a second: a single point's speed is
 * mostly its own jitter, the centre's is the head. Pure apart from its state, so it is testable without a camera.
 */
export interface SteadyLandmarksOptions {
    /** Cutoff at rest, Hz. */
    readonly minCutoffHz?: number;
    /** Added cutoff per face width a second of head speed, Hz. */
    readonly beta?: number;
}
/**
 * Defaults. 0.5 Hz at rest passes a slow drift and cuts jitter at a resting pulse (1 to 1.5 Hz) to under half; 40 Hz
 * per face width a second raises it to about 4.5 Hz at 0.1 face widths a second, a quick head turn.
 */
export declare const STEADY_MIN_CUTOFF_HZ = 0.5;
export declare const STEADY_BETA = 40;
/** Cutoff of the speed estimate itself, Hz (the paper's d_cutoff). */
export declare const STEADY_SPEED_CUTOFF_HZ = 1;
/** A gap longer than this starts the filter again (a lost face, a paused camera), ms. */
export declare const STEADY_RESET_MS = 500;
type Point = {
    x: number;
    y: number;
    z?: number;
};
export declare class SteadyLandmarks {
    private prev;
    private prevMs;
    private centre;
    private speed;
    readonly minCutoffHz: number;
    readonly beta: number;
    constructor(o?: SteadyLandmarksOptions);
    reset(): void;
    /** The filtered points for a new find at `tMs` (a new array; the input is not changed). */
    filter<P extends Point>(points: readonly P[], tMs: number): P[];
}
export {};
//# sourceMappingURL=steadyLandmarks.d.ts.map