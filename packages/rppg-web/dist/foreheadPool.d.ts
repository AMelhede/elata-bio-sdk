/** Skin fraction below which a patch is dropped for the next second (the antimode of the measured histogram). */
export declare const FOREHEAD_TAU_SKIN = 0.5;
/** Relative swing above which a patch is dropped (a far outlier fence; it rarely fires). */
export declare const FOREHEAD_TAU_SWING = 15.751094366933657;
/** Share of the remaining patches pruned for movement. */
export declare const FOREHEAD_PRUNE: number;
/** One frame of the pool's patches: per patch the skin-masked mean R, G, B (0..255), the skin and pixel counts. */
export type PoolFrame = {
    t: number;
    mean: Float64Array;
    skin: Float64Array;
    n: Float64Array;
};
/**
 * The pool for one region. `push` takes each face frame's patches (in time order) and returns the region's colour on
 * the library's 0..1 scale, or null before it has one (the caller keeps the box then). `fpsOverride` exists only for
 * offline replay of a recording made at a known rate; live, the rate is measured from the frames.
 */
export declare class ForeheadPool {
    private readonly patches;
    private readonly fpsOverride?;
    /** Frames of the last WIN_MS + 1 s: the weights read the window ending at the last whole second. */
    private rows;
    /** Index into rows of the oldest frame inside the running mean's window. */
    private winStart;
    private sum;
    private cnt;
    private weights;
    private weightSecond;
    private last;
    constructor(patches: number, fpsOverride?: number | undefined);
    reset(): void;
    push(frame: PoolFrame): {
        r: number;
        g: number;
        b: number;
    } | null;
    /** D3 weights from the frames in (s - 16 s, s]; null (equal weights) under 2 s of frames. */
    private weightsAt;
}
//# sourceMappingURL=foreheadPool.d.ts.map