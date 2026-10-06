/**
 * Monotonic baseline calibration.
 *
 * Captures a stable resting baseline (bpm + HRV) from a stream of per-frame
 * readings without the progress ever retreating — the failure mode of a
 * settle-style ring that *backs off* when the signal gets jittery, which reads
 * as the percentage going backwards and is disturbing to watch.
 *
 *   - progress = acceptedSamples / neededSamples, so it only ever climbs;
 *   - a jittery / out-of-range frame is *rejected* (doesn't add), never
 *     subtracted — progress pauses instead of retreating;
 *   - early-exit once the recent samples converge (low stdDev) → jump to 100%;
 *   - the final baseline is a trimmed median (drop the tails).
 *
 * Pure and frame-driven: push one reading per poll. The caller owns the gating
 * (only push when a face is in frame with a good signal — see the gating /
 * framing helpers) and any UI smoothing; this class makes no assumptions about
 * poll cadence, the DOM, or a rendering layer.
 */
export interface BaselineCalibratorConfig {
    /** Accepted samples for a full (non-early) calibration. */
    neededSamples: number;
    /** Reject a reading this many bpm off the running average (anti-spike). */
    outlierBpm: number;
    /** Minimum accepted samples before the convergence early-exit can fire. */
    minForStability: number;
    /** Window (most-recent N) used for the convergence stdDev check. */
    stabilityWindow: number;
    /** Below this bpm stdDev over the window, we call it converged → 100%. */
    stabilityStdDev: number;
    /** Fraction of each tail dropped before the median (per side). */
    trimFraction: number;
    /**
     * When a per-push capture confidence is supplied, readings below this score
     * are rejected — progress *pauses* (it never retreats) instead of folding a
     * motion/lighting-corrupted reading into the baseline. The reason is exposed
     * via {@link BaselineCalibrator.stallReason} so the UI can say what to fix
     * rather than leave the user staring at a frozen percentage.
     */
    minCaptureConfidence: number;
}
export declare const DEFAULT_BASELINE_CALIBRATOR_CONFIG: BaselineCalibratorConfig;
export interface BaselineCalibrationResult {
    bpm: number | null;
    hrv: number | null;
}
/** The capture-confidence snapshot a caller may attach to each push. */
export interface CalibrationCaptureGate {
    /** 0..1 overall capture confidence (see CaptureConfidenceScorer). */
    score: number;
    /** Limiting dimension, surfaced as the stall reason when gating. */
    limiting?: "motion" | "lighting" | null;
    /** Actionable reason codes, surfaced as the stall reason when gating. */
    reasons?: string[];
}
/** Why calibration progress is currently paused, for actionable UI. */
export interface CalibrationStall {
    limiting: "motion" | "lighting" | null;
    reasons: string[];
}
export declare class BaselineCalibrator {
    private readonly cfg;
    private bpm;
    private hrv;
    private rejectStreak;
    private rejected;
    private qualitySum;
    private gatedByCapture;
    private lastStall;
    constructor(cfg?: BaselineCalibratorConfig);
    /**
     * Offer one reading (with its 0..1 signal quality). Outliers are rejected —
     * they don't advance progress and they count against the confidence score.
     *
     * When `capture` is supplied and its `score` is below
     * `cfg.minCaptureConfidence`, the reading is gated out: progress pauses and
     * {@link stallReason} reports the limiting motion/lighting factor. Omitting
     * `capture` preserves the original BPM-outlier-only behaviour.
     */
    push(bpm: number, hrv: number | null, quality?: number, capture?: CalibrationCaptureGate): void;
    get sampleCount(): number;
    /** Count of readings dropped because capture confidence was too low. */
    get captureGatedCount(): number;
    /**
     * Why progress is currently paused due to poor capture, or null when the
     * most recent reading was not capture-gated. Drives actionable UI (e.g.
     * "Too much motion — hold still" / "Increase lighting").
     */
    get stallReason(): CalibrationStall | null;
    /** True once the recent window has converged to a stable bpm. */
    private get converged();
    /** 0..1, monotonic. Reaches 1 at the needed count or on convergence. */
    get progress(): number;
    get isComplete(): boolean;
    /**
     * 0..1 trust in this calibration, for gating downstream scores/insights.
     * Blends: tightness of the accepted bpm spread, sample sufficiency, how few
     * frames were rejected as outliers, and mean signal quality. Low trust =
     * don't show a hard score or feed it into the baseline.
     */
    get confidence(): number;
    /** Trimmed-median baseline over the accepted samples. */
    result(): BaselineCalibrationResult;
    reset(): void;
}
//# sourceMappingURL=baselineCalibrator.d.ts.map