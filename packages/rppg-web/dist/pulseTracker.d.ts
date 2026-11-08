/**
 * Rule tracker: one model for "is there a pulse, and at what rate", in place of the streak rules.
 *
 * A forward hidden Markov filter over heart-rate bins (TRACKER_LO_BPM..TRACKER_HI_BPM, 1 bpm) plus one no-pulse
 * state, stepped once per window (Rabiner 1989; the same structure as wrist-PPG trackers such as BeliefPPG, Bieri
 * 2023, and TROIKA, Zhang 2015, with a no-pulse state added so a weak or absent pulse withholds instead of holding).
 *
 * - Evidence: each rate's band power plus TRACKER_HARMONIC of the power at twice the rate, against its noise floor: the
 *   higher of the median power within TRACKER_WHITEN_BPM of that rate and the band's median (slow drift rises toward
 *   low rates while a pulse is a narrow line, so a drift line at the band's bottom is not mistaken for a pulse, the
 *   general form of rule driftLine; the band's median keeps a local floor that reads low by chance from making noise
 *   look like a line). Its log is tempered by TRACKER_TAU, since windows a second apart share most of their samples.
 * - Motion: within a pulse, the rate moves by a normal step of TRACKER_SIGMA_BPM per second. A heart does not drop
 *   70 bpm in 2 s, so a jump to half or double the rate can only happen by leaving through the no-pulse state
 *   (TRACKER_Q_OFF per second) and entering again (TRACKER_Q_ON, spread evenly over the rates: no prior that would
 *   bend a slow or fast heart toward the middle).
 * - Shown: the posterior mass within the bar (5 bpm or 10%) of its mode, at TRACKER_SHOW or more; the rate
 *   shown is the posterior mean over that span.
 *
 * Values chosen by measurement on recorded captures against a reference pulse, with their no-pulse copies.
 */
export declare const TRACKER_LO_BPM = 42;
export declare const TRACKER_HI_BPM = 180;
export declare const TRACKER_HARMONIC = 0;
export declare const TRACKER_WHITEN_BPM = 39;
export declare const TRACKER_TAU = 4;
export declare const TRACKER_SIGMA_BPM = 3;
export declare const TRACKER_Q_OFF = 0.05;
export declare const TRACKER_Q_ON = 0.02;
export declare const TRACKER_SHOW = 0.25;
/**
 * Within this many bpm of either end of the band the median window is one-sided and reads below a drift that rises
 * toward the edge, so there the floor is also a straight-line fit of log power over the neighbours (TRACKER_FIT_GAP_BPM
 * and more away, so a rate's own line does not lift its floor), plus Euler's constant (for noise of mean m, the mean
 * log power is log m - 0.577); the higher of the two counts.
 */
export declare const TRACKER_EDGE_BPM = 6;
export declare const TRACKER_FIT_GAP_BPM = 6;
/**
 * A rate shown before a break (a camera restart, the page left and come back) seeds the filter after it: this much
 * posterior mass around that rate, widened by the motion step for the time since. Below TRACKER_SHOW on purpose: the
 * seed is a prior and never shows by itself; the face's own windows confirm it within seconds, or wear it away.
 */
export declare const TRACKER_RESUME_MASS = 0.2;
/**
 * Belief in a pulse when the filter starts or resets, spread evenly over the rates (the rest on no pulse). 0 starts every
 * session and every return from all-no-pulse, so belief can only enter at TRACKER_Q_ON a second; the filter's own
 * stationary mix, TRACKER_Q_ON / (TRACKER_Q_ON + TRACKER_Q_OFF), is the textbook start. Under test (scratchpad tracker/p0).
 */
export declare const TRACKER_START_MASS = 0;
/**
 * How wide the prior after a break is: a heart rate drifts back toward its own level rather than walking, so over a gap
 * of D s its change has a spread of TRACKER_SEED_SD_BPM x sqrt(1 - exp(-D / TRACKER_SEED_TAU_S)), never below the motion
 * step. Measured on a lab finger reference (5 s median): spread 3.1, 4.5, 5.4, 5.8, 6.7 bpm at gaps
 * of 5, 10, 20, 30, 60 s, where the walk gives 6.7, 9.5, 13.4, 16.4, 23.2; 7 bpm and 20 s fit it. Infinity keeps the
 * walk (sigma x sqrt(D)). Under test (scratchpad tracker/a3).
 */
export declare const TRACKER_SEED_SD_BPM: number;
export declare const TRACKER_SEED_TAU_S = 20;
/**
 * The newest TRACKER_RECENT_S seconds as a second source of evidence (a moving heart shows there before the full window
 * catches up), tempered by TRACKER_TAU times this; Infinity leaves it out.
 */
export declare const TRACKER_RECENT_S = 8;
export declare const TRACKER_RECENT_TAU_FACTOR: number;
/** Before a full window, the tracker reads the window there is, from this many seconds (the growing window). */
export declare const TRACKER_FIRST_WINDOW_S = 6;
/**
 * Seconds after a start or reset that the tracker's window leaves out (the camera settles its exposure and white balance
 * there): a 7 s window ending 7 to 10 s into a received file is within 5 bpm of the file's 16 s line 44% of the time, the
 * same window from 30 s on 74% (tracker/a3/shortwin.mjs, 2026-11-07). 2 s, against 0, on the 8 sealed lab people (blind, once):
 * shown 54.9 to 53.7%, error 2.55 to 2.15 bpm, over 10 off 4.1 to 3.0%, made-up numbers on no-pulse copies 1.72 to 1.42 per
 * 100 s; the same direction on the open lab (stage 2). Fewer wrong numbers for 1 point of shown seconds: a wrong number costs far more than a missing one.
 */
export declare const TRACKER_SETTLE_S = 2;
export type TrackerParams = {
    tau: number;
    sigma: number;
    qOff: number;
    qOn: number;
    harmonic: number;
    whitenBpm: number;
    show: number;
    recentTauFactor: number;
};
export declare const TRACKER_DEFAULTS: TrackerParams;
export type TrackerStep = {
    /** Posterior mass within the bar of the mode (what TRACKER_SHOW is judged on). */
    mass: number;
    /** Posterior mean rate over that span. */
    bpm: number;
    /** 1 - P(no pulse). */
    pPulse: number;
    /** True when mass >= show. */
    shown: boolean;
};
export type TrackerEvidence = {
    /** Highest rate the window can carry (rule fpsCeiling's 0.4 x frame rate), or null for the whole band. */
    capBpm?: number | null;
    /** Rates the window's evidence must not count: a non-pulse source (the wall, the room, the head) carries them. */
    suppressBpm?: readonly number[];
    /** The window is not evidence at all (a held picture, a stepping light): time passes, nothing is learned. */
    none?: boolean;
    /** The newest TRACKER_RECENT_S seconds' in-band spectrum, as measured (second evidence; see TRACKER_RECENT_TAU_FACTOR). */
    recent?: ReadonlyArray<readonly [number, number]> | null;
};
export declare class PulseTracker {
    readonly rates: number[];
    private readonly K;
    private readonly near;
    private a;
    private aN;
    private lastMs;
    readonly p: TrackerParams;
    constructor(params?: Partial<TrackerParams>);
    /** Each rate's log evidence from one spectrum against its floor, tempered by `tau`; 0 where the rate cannot count. */
    private evidence;
    /** The edge floor (TRACKER_EDGE_BPM): the line fit at each rate near either end of the band, 0 elsewhere. */
    private edgeFit;
    /** Seed the filter with a rate shown `ageS` seconds ago (TRACKER_RESUME_MASS around it, widened by the motion step). */
    seed(bpm: number, ageS: number, mass?: number): void;
    reset(): void;
    /** One second of time with no evidence (the prior moves; nothing is learned). */
    private predict;
    /**
     * Advance to `timestampMs` and take one window's in-band power spectrum ([bpm, power], ascending, as measured,
     * not whitened). Returns the posterior summary.
     */
    step(timestampMs: number, spectrum: ReadonlyArray<readonly [number, number]>, ev?: TrackerEvidence): TrackerStep;
}
//# sourceMappingURL=pulseTracker.d.ts.map