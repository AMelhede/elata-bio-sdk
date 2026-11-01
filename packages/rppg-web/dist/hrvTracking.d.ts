/** One frame: its time (ms) and the mean R, G, B of the face regions (forehead, left cheek, right cheek). */
export type HrvRegionFrame = {
    t: number;
    regions: readonly {
        r: number;
        g: number;
        b: number;
    }[];
};
export type HrvWindowResult = {
    /** RMSSD (ms) over the window, or null (too few pairs, gated, or too short). */
    rmssdMs: number | null;
    /** SDNN (ms) over the window's kept intervals, or null. */
    sdnnMs: number | null;
    /** The window's median frame SNR (dB) on the rate track, or null without a track frame in it. */
    snrDb: number | null;
    /** The median of the rate track over the window (bpm), or null. */
    centreBpm: number | null;
    /** Intervals in the window, those kept, and the adjacent kept pairs the rMSSD is over. */
    intervals: number;
    kept: number;
    pairs: number;
    /** The window's SNR fell under the gate, so no HRV is given. */
    gated: boolean;
    /** Why there is no HRV when there is none for a reason other than the counts: "short" or "gated". */
    reason: "short" | "gated" | null;
    /** The window, ms, on the de-jittered clock. */
    windowStartMs: number;
    windowEndMs: number;
    /** Every beat found (ms), over the whole input, for research. */
    beatTimesMs: number[];
};
export type HrvWindowOptions = {
    /** Window length, seconds (default 60). */
    windowS?: number;
    /** Window end (ms on the input's clock); default 1 s before the last frame (the filters' edge). */
    windowEndMs?: number;
    /** Window start (ms); default windowEndMs - windowS. */
    windowStartMs?: number;
    /** The analysis grid's rate (Hz); default the frame rate, rounded. */
    sampleRate?: number;
    /** Half-width of the tracking band (Hz), default 0.45. */
    trackHalfHz?: number;
    /** The SNR gate (dB), default HRV_MIN_SNR_DB; -Infinity for none. */
    minSnrDb?: number;
    /** De-jitter the frame clock first (default true). */
    dejitter?: boolean;
};
/** A frame interval longer than this is a gap (normal intervals read 31 to 49 ms on a 16 ms tick at 30 fps). */
export declare const HRV_GAP_MS = 90;
/** The window SNR gate, dB, as the study that measured this timer gated it (see the top of this file). */
export declare const HRV_MIN_SNR_DB = 1;
/** The beat-timing grid, Hz. */
export declare const HRV_UPSAMPLE_HZ = 240;
/** Half-width of the tracking band, Hz: wide enough for breathing's sidebands (to 0.4 Hz). */
export declare const HRV_TRACK_HALF_HZ = 0.45;
/** Lead the frames need before the window: half a rate-track frame, and the filters' settling. */
export declare const HRV_LEAD_S = 4;
/**
 * scipy.interpolate.CubicSpline(t, v) (not-a-knot ends) evaluated at q; t strictly increasing, at least 4 knots
 * (fewer: linear).
 */
export declare function cubicSplineNotAKnot(t: ArrayLike<number>, v: ArrayLike<number>, q: ArrayLike<number>): Float64Array;
/**
 * Digital Butterworth second-order sections, as scipy.signal.butter(order, cutoff, 'low' | 'band', fs=fs,
 * output='sos'): a low-pass for one cutoff (Hz), a band-pass for [low, high]. Rows [b0, b1, b2, 1, a1, a2].
 * The sections are paired differently from scipy's zpk2sos; the cascade (and so any filtfilt through it) is the same.
 */
export declare function butterworthSos(order: number, cutoff: number | readonly [number, number], fs: number): number[][];
/** scipy.signal.sosfiltfilt (odd extension, padlen 3 (2 n_sections + 1), sosfilt_zi states). */
export declare function sosFiltFilt(sos: number[][], xIn: ArrayLike<number>): Float64Array;
/**
 * The frame times on the camera's own steady clock: frames a whole number of periods apart (a dropped frame stays a
 * gap), the period refitted on those counts, plus a slowly varying offset (a 2 s running median of the residual,
 * then its 2 s mean). `fps`: the camera's nominal rate, if known; else the mean of the intervals under HRV_GAP_MS.
 */
export declare function dejitterFrameTimes(timesMs: readonly number[], fps?: number): number[];
/** Spans (ms) between consecutive frames more than HRV_GAP_MS apart. */
export declare function frameGaps(timesMs: readonly number[]): [number, number][];
/**
 * HRV over a window from beat times (ms): intervals 0.3 to 2 s, none touching a gap (within 50 ms of it), each within
 * 20% of the median of the kept intervals among the 11 around it; rMSSD over adjacent kept pairs whose midpoints lie
 * in [w0, w1] (at least 5), SDNN (sample sd) over the kept ones (at least 6).
 */
export declare function hrvFromBeats(beatTimesMs: readonly number[], gapsMs: readonly (readonly [number, number])[], w0: number, w1: number): {
    rmssdMs: number | null;
    sdnnMs: number | null;
    intervals: number;
    kept: number;
    pairs: number;
};
/**
 * HRV (rMSSD, SDNN) over a window from the face regions' colours, by the tracking-band beat timer (see the top of
 * this file). Experimental: not a measurement, and not to be shown to a person.
 */
export declare function hrvFromRegions(frames: readonly HrvRegionFrame[], options?: HrvWindowOptions): HrvWindowResult;
/** How long HrvRegionBuffer keeps frames, seconds: a 60 s window, its 1 s edge guard and HRV_LEAD_S, with room. */
export declare const HRV_KEEP_S = 70;
/** HrvRegionBuffer recomputes at most once per this many ms of frames (a 60 s window moves little in a second). */
export declare const HRV_READ_EVERY_MS = 1000;
/**
 * The newest frames of the three face regions (forehead, left cheek, right cheek) for hrvFromRegions, fed by the
 * session's runner with the regions the pulse check reads; `read()` gives the latest window's HRV, or null before
 * any frame. Experimental (the session's `experimentalHrv: "tracking"`).
 */
export declare class HrvRegionBuffer {
    private readonly keepS;
    private readonly options;
    private frames;
    private last;
    constructor(keepS?: number, options?: HrvWindowOptions);
    get size(): number;
    push(timestampMs: number, regions: readonly {
        r: number;
        g: number;
        b: number;
    }[]): void;
    reset(): void;
    read(): HrvWindowResult | null;
}
//# sourceMappingURL=hrvTracking.d.ts.map