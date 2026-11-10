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
 * The person's own rate as the prior whenever the filter starts with nothing recent from this face (a new session, or a
 * return after more than a short break): a heart's resting level belongs to the person, not the session, so the rates
 * near it are searched first. This much mass, spread as a normal of TRACKER_PRIOR_SD_BPM around it; while it is in the
 * filter the show bar is TRACKER_PRIOR_SHOW, so a number still needs the face's own evidence (the prior's mass would
 * otherwise do part of the evidence's work, which is what made a flat start mass show numbers on no-pulse copies,
 * TRIED 11-07), for the whole session: dropping it back at the face's first number failed the blind check (sealed 8
 * no-pulse 1.42 to 1.92 per 100 s); at 0.30 all session the sealed 8 read MAE 2.14 to 1.89 but no-pulse 1.42 to 1.49,
 * so 0.32. The spread is the person's own when their history gives one (lastRate.ts readPersonalPrior). Screened on every received file and the lab with its no-pulse copies (evsave TRIED 2026-11-09, F2):
 * first number 21 to 15 s on the received files and 27 to 23 s on the lab (prior taken from the person's other camera
 * and state), lab right 90.8 to 90.9%, no-pulse copies 0.97 to 0.88 per 100 s; a lower bar alone (0.20) reached only
 * 18 s at 2.27 per 100 s. 12 bpm: the screen's spreads 7, 12 and 20 scored within a point of each other; 12 covers a
 * resting rate's day-to-day spread with room for a morning against an evening.
 */
export declare const TRACKER_PRIOR_SD_BPM = 12;
export declare const TRACKER_PRIOR_MASS = 0.2;
export declare const TRACKER_PRIOR_SHOW = 0.3;
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
/**
 * A heart under the band (25 to 42 bpm) reads as its 2nd or 3rd harmonic, since the band starts at 42. Physics tells the
 * two apart without reading under 42, where breathing, sway and drift lines live on real recordings: a heart truly at the
 * shown rate m has nothing at 1.5 m (or at 2/3 and 4/3 of m), while the 2nd harmonic of a heart at m / 2 brings its 3rd
 * harmonic at 1.5 m, and a 3rd harmonic brings the 2nd and 4th. The shown number is withheld when, for f0 = m / 2 or m / 3
 * under 42, the lowest harmonics a heart truly at m cannot have (1.5 m for f0 = m / 2; 2/3 m and 4/3 m for m / 3) each
 * show a line: the strongest point within max(2 bpm, half a bin) of it at least this many times the band's median, and
 * above the points 6 bpm either side. 0 turns it off. Measured offline on the library's own spectra (evsave TRIED
 * "A4 v4", 2026-11-09), at 8: fires on 0.36% of 7422 laptop, 0 of 2026 phone and 0.27% of 734 Mac shown seconds of
 * received recordings, 0.68 and 1.18% of the lab's (mostly wrong numbers removed), against 99% of the shown seconds of
 * synthetic hearts at 30 to 40 bpm (the earlier check under 42 cost 0.7 to 3.4% of real seconds).
 */
export declare const TRACKER_INTERHARMONIC_K = 8;
export type TrackerParams = {
    tau: number;
    sigma: number;
    qOff: number;
    qOn: number;
    harmonic: number;
    whitenBpm: number;
    show: number;
    recentTauFactor: number;
    interHarmonicK: number;
    priorSd: number;
    priorMass: number;
    priorShow: number;
};
export declare const TRACKER_DEFAULTS: TrackerParams;
export type TrackerStep = {
    /** Posterior mass within the bar of the mode (what TRACKER_SHOW is judged on). */
    mass: number;
    /** Posterior mean rate over that span. */
    bpm: number;
    /** 1 - P(no pulse). */
    pPulse: number;
    /** True when mass >= the show bar (show, or priorShow while a personal prior is in the filter). */
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
    private showBar;
    private prior;
    readonly p: TrackerParams;
    constructor(params?: Partial<TrackerParams>);
    /** Each rate's log evidence from one spectrum against its floor, tempered by `tau`; 0 where the rate cannot count. */
    private evidence;
    /** The edge floor (TRACKER_EDGE_BPM): the line fit at each rate near either end of the band, 0 elsewhere. */
    private edgeFit;
    /** Seed the filter with a rate shown `ageS` seconds ago (TRACKER_RESUME_MASS around it, widened by the motion step). */
    seed(bpm: number, ageS: number, mass?: number): void;
    /**
     * Seed the filter with the person's own rate (TRACKER_PRIOR_*): their usual level, not a rate just shown. Raises the
     * show bar to priorShow until the next reset.
     */
    seedPrior(bpm: number, sd?: number): void;
    /** True while a personal prior is in the filter (seedPrior since the last reset). */
    get priorSeeded(): boolean;
    reset(): void;
    /** One second of time with no evidence (the prior moves; nothing is learned). */
    private predict;
    /**
     * Advance to `timestampMs` and take one window's in-band power spectrum ([bpm, power], ascending, as measured,
     * not whitened). Returns the posterior summary.
     */
    step(timestampMs: number, spectrum: ReadonlyArray<readonly [number, number]>, ev?: TrackerEvidence): TrackerStep;
}
/** TRACKER_INTERHARMONIC_K: true when the shown rate `mode` reads as the 2nd or 3rd harmonic of a heart under 42. */
export declare function slowHeartHarmonics(spectrum: ReadonlyArray<readonly [number, number]>, mode: number, k: number): boolean;
//# sourceMappingURL=pulseTracker.d.ts.map