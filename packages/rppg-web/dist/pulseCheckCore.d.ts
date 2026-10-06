/**
 * Real-pulse check, the estimator. Pure: it takes the per-frame mean colour of three skin
 * regions (forehead, left cheek, right cheek), optionally with a patch of wall beside the
 * face, and returns per-region estimates and a verdict. No DOM and no SDK state, so it runs
 * the same in a browser, in unit tests and offline. See pulseCheck.ts for how the SDK uses it.
 *
 * Each region's pulse is read with POS (Wang et al., IEEE TBME 2017). A pulse is the one
 * rhythm all three regions share; noise is not shared, so the check asks the regions to agree
 * on one rate, clearly above the noise, over consecutive windows before it reports anything.
 * The thresholds below were chosen by measurement on recorded captures against a reference
 * pulse sensor; the measurement notes are kept in the source repository, not in this package.
 */
/**
 * [timestampMs, foreheadR, G, B, leftCheekR, G, B, rightCheekR, G, B], optionally followed by
 * the wall beside the face [wallR, G, B] (NaN when it was not visible in that frame).
 */
export type RawRoiSample = [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    ...number[]
];
/** Analysis sample rate: above twice the 3 Hz band edge, below any camera. */
export declare const OWN_PULSE_FS = 20;
/** Heart-rate band, Hz: 42 to 180 bpm, the SDK's own limits. */
export declare const OWN_PULSE_BAND_HZ: readonly [number, number];
/**
 * Window, seconds. Spectral resolution is 60/window bpm: 16 s gives 3.75 bpm,
 * enough to separate cheeks that agree from cheeks that do not, and short
 * enough that a 60 s capture yields several independent verdicts.
 */
export declare const OWN_PULSE_WINDOW_S = 16;
/** Two regions agreeing within this many bpm counts as agreement (one bin + a half). */
export declare const OWN_PULSE_AGREE_BPM = 6;
export type RegionName = "forehead" | "leftCheek" | "rightCheek";
export declare const REGIONS: readonly RegionName[];
export interface RegionEstimate {
    region: RegionName;
    bpm: number;
    /** de Haan SNR, dB: power within 0.1 Hz of the peak and its harmonic over the rest of the band. */
    snrDb: number;
    /** Mean R, G, B over the window, for the saturation check. */
    meanRgb: [number, number, number];
}
export interface OwnPulseEstimate {
    windowS: number;
    frames: number;
    fps: number;
    regions: RegionEstimate[];
    /** Regions whose own peak sits within OWN_PULSE_AGREE_BPM of the combined line. */
    agreeing: RegionName[];
    /** The line in the three regions' combined spectrum, or null when there is no line. */
    bpm: number | null;
    /** That line's SNR in the combined spectrum, dB, or null. */
    snrDb: number | null;
    /**
     * The same line's rate estimated between bins (fineBpm), for the rate the
     * app REPORTS. Everything that decides (agreement, streaks, holds) stays on
     * `bpm`, the bin. Optional so a hand-built estimate need not carry it.
     */
    bpmFine?: number | null;
    /** How the pulse was read from the colours this window (see OWN_PULSE_COLOUR_DAMAGE). */
    method?: "pos" | "greenMinusWall";
    /** The colour-damage measure this window (see OWN_PULSE_COLOUR_DAMAGE), or null. */
    colourDamage?: number | null;
    /** Whether the wall beside the face was seen through the whole window. */
    wallSeen?: boolean;
}
export declare function resample(t: number[], v: number[], from: number, to: number): number[];
/**
 * Remove drift slower than the band: subtract a 2 s TRIANGULAR moving mean
 * (a 2 s moving mean applied twice).
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
/**
 * The high-pass before the pulse is read: a double moving mean this many
 * seconds wide.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_DETREND_S = 1.5;
export declare function detrend(x: number[], seconds?: number): number[];
/** Hann-windowed power spectrum over the band and a little either side. */
export declare function spectrum(x: number[]): Array<[number, number]>;
/**
 * Weight of a line's second harmonic when choosing the line (harmonic
 * summation, as in pitch detection). A heartbeat is not a sine: its sharp
 * upstroke puts a line at twice the rate, which the band-floor noise that
 * fooled the estimator in poor light does not have.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_HARMONIC_WEIGHT = 0.5;
/**
 * The strongest in-band LINE of a spectrum and its de Haan SNR. NaN when the
 * maximum is not a local peak. With `harmonicWeight`, the line is chosen on
 * its power plus that share of its second harmonic's; the SNR is unchanged.
 */
export declare function peakOfSpectrum(P: Array<[number, number]>, harmonicWeight?: number, 
/** The spectrum as measured, when `P` is a reshaped copy of it (whitenedSpectrum). */
measured?: Array<[number, number]>): {
    bpm: number;
    snrDb: number;
};
/**
 * The rate of the line at `bpm` estimated between bins: a Gaussian (log-parabolic) fit through
 * the line's bin and its two neighbours, the standard fit for a Hann-windowed line. A 16 s
 * window has 3.75 bpm bins, so the bin centre alone can be up to 1.9 bpm from the line. Used for
 * the reported rate only; every decision stays on the bins.
 */
export declare function fineBpm(P: Array<[number, number]>, bpm: number): number;
export declare function peakAndSnr(x: number[]): {
    bpm: number;
    snrDb: number;
};
/**
 * The three regions' spectra, each normalised to unit in-band power, summed.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare function combinedSpectrum(spectra: Array<Array<[number, number]>>): Array<[number, number]>;
/**
 * The combined spectrum judged against its LOCAL noise floor.
 *
 * It chooses the line and fits its rate; the line's SNR is still judged on
 * the spectrum as measured, so every bar keeps the meaning it was set with.
 * Judging the SNR on the whitened spectrum instead moved the bars under the
 * lines and lost real pulses.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_WHITEN_HALF_HZ = 0.65;
export declare const OWN_PULSE_WHITEN_POWER = 0.4;
export declare function whitenedSpectrum(P: Array<[number, number]>): Array<[number, number]>;
/** POS (Wang 2017): temporally normalised RGB, S1 = G - B, S2 = G + B - 2R, h = S1 + alpha S2, 1.6 s sliding windows, overlap-added. */
export declare function pos(R: number[], G: number[], B: number[]): number[];
/**
 * When the camera's colour channels are too damaged for POS, read the pulse from green minus
 * what the wall beside the face shares with it.
 *
 * POS compares the three colour channels, which cancels changes of light and movement, but
 * only while each channel is clean: a near-dead channel (a dark camera's blue reading 4 to 20
 * of 255) has rounding noise that POS's per-channel normalisation multiplies, and video
 * compression (a phone streaming as a webcam) discards colour detail first. Green alone
 * survives both but follows the room light; the wall carries the room light and never the
 * pulse, so subtracting the share of green that the wall explains leaves the pulse.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_COLOUR_DAMAGE = 50;
/**
 * The colour-damage level at which the live check switches from POS to green minus the wall.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_COLOUR_SWITCH = 20;
/** Green minus the share of it the wall's brightness explains (least squares), sign as POS. */
export declare function greenMinusWall(G: number[], wall: number[]): number[];
/**
 * Estimate over the most recent `windowS` seconds of raw samples. Returns null
 * when the window is not yet full or the frame rate is too low to resolve the
 * band (below 2x the band edge, i.e. 6 fps).
 */
export declare function estimateOwnPulse(samples: readonly RawRoiSample[], windowS?: number, 
/** The instant to judge at; defaults to the last sample. A window whose newest sample is older than 1 s is stale and yields null. */
atMs?: number, 
/** Colour damage at which green minus the wall replaces POS (OWN_PULSE_COLOUR_SWITCH). */
colourSwitch?: number): OwnPulseEstimate | null;
/**
 * Walk a whole recording in `stepS` steps and return the estimate at each
 * step: what the app would have concluded, second by second, offline.
 */
export declare function ownPulseSeries(samples: readonly RawRoiSample[], windowS?: number, stepS?: number): Array<{
    tS: number;
    est: OwnPulseEstimate | null;
}>;
/**
 * The verdict over time: one agreeing window is not a pulse; the same rate
 * held across consecutive windows is.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_STREAK = 8;
export declare const OWN_PULSE_MIN_SNR_DB = -3;
/**
 * A strong line is proven sooner than a weak one.
 *
 * The streak above is a fixed wait: eight windows whatever their strength, so
 * a clear pulse in good light waited as long as a marginal one. A sequential
 * stop (Wald's sequential probability ratio test) spends evidence instead of
 * time: at least OWN_PULSE_STRONG_STREAK agreeing windows whose SNR above the
 * bar (OWN_PULSE_MIN_SNR_DB) sums to OWN_PULSE_STRONG_EXCESS_DB, which for
 * four windows is a mean of 0 dB, 3 dB above the ordinary bar.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_STRONG_STREAK = 4;
export declare const OWN_PULSE_STRONG_EXCESS_DB = 12;
/**
 * Below this rate a line counts only when all three regions see it.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_LOW_BAND_BPM = 58;
/**
 * Below this delivered frame rate the camera has slowed itself to lengthen its exposure: it is
 * telling us the light is low. Cameras typically run near 16.6 fps when exposure-limited and
 * 20 to 30 when not; 18 sits in the gap.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_SLOW_CAMERA_FPS = 18;
/**
 * The bottom of that exposure-limited band: a lower rate is frames being dropped, not light.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_SLOW_CAMERA_MIN_FPS = 15;
/**
 * The SNR a window from a camera slowed for light needs to count.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_SLOW_CAMERA_MIN_SNR_DB = -2;
/**
 * In the dark, a longer agreement stands in for a stronger window.
 *
 * A camera slowed for light (OWN_PULSE_SLOW_CAMERA_*) whose windows each fall
 * under the slowed bar can still confirm on OWN_PULSE_DARK_STREAK windows in a
 * row agreeing on one rate, at a mean SNR of OWN_PULSE_DARK_MIN_SNR_DB, none
 * under OWN_PULSE_DARK_FLOOR_DB. Evidence that is weak per window but steady
 * over time: a chance line does not hold for sixteen seconds.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_DARK_STREAK = 16;
export declare const OWN_PULSE_DARK_MIN_SNR_DB = -4.5;
/** No single dark window below this counts (the sweep's floor). */
export declare const OWN_PULSE_DARK_FLOOR_DB = -7;
/**
 * The regions themselves must see a dark line: every window at least one region on it alone,
 * and on average OWN_PULSE_DARK_MEAN_AGREEING over the streak. SNR alone cannot separate a
 * weak real pulse from a combined-spectrum line the regions do not carry; agreement does.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_DARK_MIN_AGREEING = 1;
export declare const OWN_PULSE_DARK_MEAN_AGREEING = 1.5;
/**
 * The bar a dark pulse is HELD at, once the dark entry has confirmed it.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_DARK_HOLD_SNR_DB = -5.5;
/**
 * Regions that must carry a window's line for it to count, outside the dark
 * (the dark path keeps its own rule, OWN_PULSE_DARK_MIN_AGREEING).
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_MIN_AGREEING = 2;
/**
 * The bottom of the band (OWN_PULSE_BAND_HZ, 42 bpm) is where slow drift that every region shares (room
 * light, exposure, a slowly moving head) piles up, and all three regions can agree on it. Below
 * OWN_PULSE_EDGE_BPM a window counts only at OWN_PULSE_EDGE_MIN_SNR_DB or more.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_EDGE_BPM = 52;
export declare const OWN_PULSE_EDGE_MIN_SNR_DB = 0;
/**
 * Once measured, the verdict HOLDS while at least this many of the last
 * OWN_PULSE_STREAK windows still agree with the held rate.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_HOLD_MIN = 6;
export type OwnPulseVerdict = "measured" | "not-measured" | "unknown";
export declare function ownPulseVerdict(history: readonly (OwnPulseEstimate | null)[], 
/** The rate the previous verdict was measured at, if it was; enables the hold. */
held?: number | null): {
    verdict: OwnPulseVerdict;
    bpm: number | null;
    snrDb: number | null;
    streak: number;
};
/**
 * A strong pulse in good light, confirmed from 12 s: the beat intervals and the
 * spectrum agree.
 *
 * The ordinary verdict needs a full 16 s window and then agreement over time,
 * which is why a capture took 25 s at the fastest. Two independent readings of
 * the same seconds are faster evidence than one reading repeated: the time
 * between beats (peaks of the POS signal, as a contact PPG counts) and the
 * spectrum's line. On a pulse they agree; on noise the peaks fall where the
 * noise puts them.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_EARLY_FROM_S = 12;
/** Spectrum and beat rate within this many bpm. */
export declare const OWN_PULSE_EARLY_AGREE_BPM = 3;
/**
 * Beat-interval coefficient of variation below this: steady beats, not noise
 * peaks.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_EARLY_MAX_CV = 0.18;
/**
 * How long an early confirmation stands in for the ordinary verdict, from the
 * moment it fired.
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const OWN_PULSE_EARLY_HOLD_S = 8;
/** Beat rate from the peaks of the three regions' POS signals, summed; null when too few beats. */
export declare function beatRate(samples: readonly RawRoiSample[], fromMs: number, toMs: number): {
    bpm: number;
    cv: number;
} | null;
/**
 * The early confirmation over a capture's own samples (first sample = the
 * press), judged at `atMs` on the trailing OWN_PULSE_EARLY_FROM_S seconds: a
 * rate, or null. Never before that much signal exists, and never from a
 * camera slowed for light, where the sweep had no evidence it holds.
 */
export declare function earlyPulse(samples: readonly RawRoiSample[], atMs: number): number | null;
/**
 * A second way to a number, for when the check's own streak falls short: the SDK's own rate (a
 * different estimator on the same face) and the check's window rate agree for AGREE_SECONDS
 * running, within AGREE_BPM, with the window line at AGREE_MIN_SNR_DB or stronger and the rate
 * at OWN_PULSE_LOW_BAND_BPM or above. Opt-in (`pulseCheckAgreement`).
 *
 * Value chosen by measurement on recorded captures against a reference pulse.
 */
export declare const AGREE_SECONDS = 8;
export declare const AGREE_BPM = 3;
export declare const AGREE_MIN_SNR_DB = -4;
export type AgreementSecond = {
    sdk: number | null;
    win: number | null;
    winSnr: number | null;
};
/** The SDK's rate when the last AGREE_SECONDS seconds all agree (see AGREE_SECONDS), else null. */
export declare function agreementRate(seconds: readonly AgreementSecond[]): number | null;
//# sourceMappingURL=pulseCheckCore.d.ts.map