import { type WaveformPeriodicityProfile } from "./rppgDiagnostics.js";
export type HarmonicRelation = "fundamental" | "half" | "double";
export type PulseWindowSample = {
    timestampMs: number;
    intensity: number;
    skinRatio: number;
    motion: number;
    clipRatio: number;
};
export type PulseEstimatorResult = {
    bpm: number;
    confidence: number;
};
export type PulseAcfResult = PulseEstimatorResult & {
    harmonicRelation?: HarmonicRelation;
};
export type PulsePeak = {
    value: number;
    time: number;
};
export type PulseWindowAnalysis = {
    spectral: PulseEstimatorResult | null;
    acf: PulseAcfResult | null;
    peaks: PulseEstimatorResult | null;
    waveformProfile: WaveformPeriodicityProfile | null;
    respiration: number | null;
    /** Confidence (0..1) of the respiration estimate; null when no estimate. */
    respirationConfidence: number | null;
    hrvRmssd: number | null;
    quality: number;
    snrDb: number;
    nowMs: number;
    motionMean: number;
};
export type PulseAnalysisOptions = {
    /**
     * The published rule that replaces the strongest rate with twice that rate (see
     * {@link estimateDominantBpm}). Off (false) by default in this build: fix 5, switch
     * `noRateDoubling`.
     */
    doublingRule?: boolean;
};
export declare function analyzePulseWindow(samples: PulseWindowSample[], options?: PulseAnalysisOptions): PulseWindowAnalysis | null;
export declare function estimateDominantBpm(data: number[], sampleRate: number, minHz: number, maxHz: number, options?: PulseAnalysisOptions): PulseEstimatorResult | null;
export declare function calculateBpmViaAutocorrelation(data: number[], fps: number, bpmHint: number | null): PulseAcfResult | null;
export declare function detectPeaks(data: PulsePeak[], bpmHint: number | null): PulsePeak[];
/**
 * Estimate the true vertex of a peak by fitting a parabola through the peak
 * sample and its two neighbours. Returns the interpolated time (and value at
 * that time). Falls back to the centre sample when the three points are
 * collinear or the vertex would land outside the neighbour interval, which can
 * happen on noisy or clipped signals.
 */
export declare function refinePeakByInterpolation(prev: PulsePeak, curr: PulsePeak, next: PulsePeak): PulsePeak;
export declare function bpmFromPeaks(peaks: PulsePeak[]): PulseEstimatorResult | null;
/**
 * Cleaned NN intervals (in ms) suitable for time-domain HRV metrics such as
 * SDNN and mean NN. Peak times are already sub-sample refined by
 * {@link detectPeaks}; this additionally drops artifact intervals.
 */
export declare function cleanNnIntervalsMs(peaks: PulsePeak[]): number[];
export declare function rmssdFromPeaks(peaks: PulsePeak[]): number | null;
export declare function temporalNormalize(data: number[]): number[];
/**
 * Standard time-domain RMSSD (ms) over an inter-beat-interval series (ms):
 * RMSSD = sqrt( mean of squared *successive* differences ). Returns null for
 * fewer than two intervals. This computes RMSSD directly from an interval
 * series; {@link rmssdFromPeaks} is the peak-based path with ectopic-beat
 * rejection — they share this same underlying formula.
 */
export declare function computeRmssdMs(ibisMs: number[]): number | null;
export interface HilbertBeatOptions {
    /** Sample rate (Hz); when given, a zero-phase bandpass narrowbands the cardiac fundamental. */
    sampleRate?: number;
    /** Bandpass edges in Hz (default 0.7-3.5, i.e. ~42-210 bpm). */
    lowHz?: number;
    highHz?: number;
    /**
     * Locked/known heart rate (bpm). When given, the bandpass is centered on it
     * (± bandMarginBpm) instead of the wide default, so the analytic phase
     * advances at the true fundamental and rejects the every-other-beat
     * sub-harmonic that otherwise corrupts beat-to-beat HRV. The margin stays
     * wide enough (~±25 bpm) that genuine beat-to-beat variation still passes.
     */
    centerBpm?: number | null;
    /** Half-width of the adaptive band around centerBpm, in bpm (default 25). */
    bandMarginBpm?: number;
    /** Drop the first/last beat to avoid DFT edge artifacts (default true). */
    trimEdges?: boolean;
}
export interface HilbertBeatResult {
    /** Continuous-time beat instants (same units as input `time`, i.e. ms). */
    beatTimesMs: number[];
    /** Successive inter-beat intervals (ms). */
    ibisMs: number[];
    /** Unwrapped instantaneous phase, for diagnostics/plots. */
    unwrappedPhase: number[];
}
/**
 * The imaginary part of the analytic signal (the Hilbert transform): DFT, keep DC (and Nyquist for
 * even N) as is, double the positive frequencies, zero the negative ones, inverse DFT. Through an
 * O(N log N) FFT of any length: it was a direct O(N^2) DFT, two thirds of the analysis's time at a
 * 45 s window (66 of 94 ms), and the result equals it to about 1e-12 of the signal (pinned by a test).
 */
export declare function hilbertImag(x: number[]): number[];
/**
 * Estimate beat instants from the analytic-signal phase of a pulse waveform.
 * `data` is the conditioned rPPG trace as {value, time(ms)} samples — the same
 * shape consumed by {@link detectPeaks}.
 */
export declare function detectBeatsViaHilbertPhase(data: PulsePeak[], options?: HilbertBeatOptions): HilbertBeatResult;
//# sourceMappingURL=pulseAnalysis.d.ts.map