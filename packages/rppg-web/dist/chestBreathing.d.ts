import type { FaceLandmarkPoint, Frame } from "./frameSource.js";
/**
 * Breathing rate from chest and shoulder motion, read in a box below the chin.
 *
 * Why motion and not the face's colour: on recorded captures against a finger-sensor breathing
 * reference, breathing read from the face pulse missed by more than always saying the median, while the
 * vertical motion of a box below the chin agreed within 2 breaths a minute in most windows. The same
 * principle is what a cleared product reads (FaceHeart FH Vitals SDK-RR, FDA K243966, April 2025:
 * chest-wall movement on video, spot checks of a still adult, RMSE 1.2 breaths a minute), and optical
 * flow on the chest reached a bias of -0.03 +- 1.38 breaths a minute in a 24-volunteer study (Massaroni
 * et al., Sensors 2021). Wang and den Brinker (Physiol. Meas. 2022) benchmark the motion estimators this
 * rests on. Box, window, band and filter: value chosen by measurement on recorded captures against a
 * reference breathing rate.
 *
 * Experimental: off unless an app asks for it, and not validated beyond the numbers above.
 */
/** The box: centred under the face, this many face widths wide (as measured). */
export declare const CHEST_BOX_WIDTH = 1.6;
/** From this many face heights below the chin ... */
export declare const CHEST_BOX_TOP = 0.15;
/** ... to this many. */
export declare const CHEST_BOX_BOTTOM = 1.15;
/** The box is anchored on the first face and moves only when the face moves this many face widths. */
export declare const CHEST_BOX_REANCHOR = 0.5;
/** The rate is read over this window, resampled at this rate, in this band (6 to 36 breaths a minute). */
export declare const CHEST_BREATH_WINDOW_S = 32;
export declare const CHEST_BREATH_FS = 4;
export declare const CHEST_BREATH_BAND_HZ: readonly [0.1, 0.6];
/** The rate's line: power within this many hertz of the peak, as a share of the band's (the Hann main lobe of 32 s). */
export declare const CHEST_BREATH_SHARE_HALF_HZ = 0.05;
/** scipy.signal.filtfilt(BP_B, BP_A, x) with its defaults. Null when x is too short to pad. */
export declare function bandPass(x: readonly number[]): number[] | null;
/** One sample: the frame's time (ms) and the box's vertical shift since the frame before, in face heights. */
export type ChestSample = [timestampMs: number, shift: number];
/**
 * The breathing rate over the window ending at `atMs`: the shifts added up into the box's position,
 * resampled at CHEST_BREATH_FS, its straight-line trend removed, band-passed, and the strongest line of a
 * Hann-windowed spectrum in the band. `share` is that line's power over the band's (1 for a pure
 * rhythm, near 0 for noise). Null when the window is not covered.
 */
export declare function breathingFromMotion(samples: readonly ChestSample[], atMs: number, windowS?: number): {
    rate: number;
    share: number;
} | null;
/**
 * The box's vertical shift between two grey images of the same size, in pixels (positive: the image
 * content moved down): a single-parameter Lucas-Kanade fit, -sum(Iy It) / sum(Iy^2), with Iy the central
 * difference of the two frames' mean. Null when the box has no vertical texture.
 */
export declare function verticalShift(prev: Float32Array, cur: Float32Array, w: number, h: number): number | null;
/** The box below the chin, in pixels, from the face's landmarks; null when it does not fit the frame. */
export declare function chestBox(landmarks: readonly FaceLandmarkPoint[], width: number, height: number): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    faceWidth: number;
    faceHeight: number;
} | null;
/** The box as grey (BT.601 luma) at half size, each output pixel the mean of a 2x2 block. */
export declare function greyHalf(frame: Pick<Frame, "data" | "width">, box: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}): {
    data: Float32Array;
    w: number;
    h: number;
};
/**
 * Follows the box below the chin frame by frame. The box is anchored on the first face and kept still
 * (a box that followed every small head movement would carry the head's motion into the chest's); it is
 * re-anchored, and the motion so far dropped, when the face moves CHEST_BOX_REANCHOR face widths or is
 * gone for over a second.
 */
export declare class ChestMotion {
    private box;
    private prev;
    private lastFaceMs;
    private samples;
    push(frame: Pick<Frame, "data" | "width" | "height" | "timestampMs">, landmarks: readonly FaceLandmarkPoint[] | null | undefined): void;
    /** The rate over the latest window, or null. */
    rate(atMs?: number): {
        rate: number;
        share: number;
    } | null;
    /** The motion kept (for recording and replay). */
    getSamples(): readonly ChestSample[];
    reset(): void;
}
//# sourceMappingURL=chestBreathing.d.ts.map