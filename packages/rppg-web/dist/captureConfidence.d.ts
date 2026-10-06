import { type FaceBox } from "./faceFraming.js";
/**
 * Capture-confidence score for rPPG.
 *
 * rPPG is fragile: motion artifacts and bad lighting silently wreck the signal,
 * and the classic failure mode is a calibration bar that freezes with no
 * explanation (the user stares at a number that won't move). This module turns
 * that fragility into honest UX by emitting a 0..1 confidence in the *capture
 * environment* — separate from the pulse-domain `confidence`/`signal_quality` —
 * plus the limiting factor ("motion" vs "lighting") so the host can say exactly
 * what to fix and gate calibration on it.
 *
 * Provenance — the motion half ports the open features from Arevalillo-Herráez
 * et al., "Motion-Based Confidence Score to Support the Practical Application of
 * rPPG Methods in Health Monitoring", J. Med. Syst. (2026) 50:82:
 *   - TI  — Temporal Perceptual Information (ITU-T Rec. P.910): the std of the
 *           frame-to-frame luminance difference, taken as the window max (eq. 1).
 *   - FMX/FMY — mean per-landmark absolute x/y displacement (eqs. 2–3).
 *   - FSM — Face Size Motion: mean relative change in ROI pixel count (eq. 4),
 *           i.e. the z-axis / distance term.
 * The four features are combined via a noisy-OR whose per-feature reliabilities
 * are the paper's *published* Pearson correlations (Table 4) — a transparent,
 * citable rule, NOT a trained model. The paper's headline classifier (bagged
 * trees) is deliberately not reproduced here; that trained IP stays out of the
 * SDK.
 *
 * The paper is motion-only and names lighting as future work; we add a
 * lighting term (clipping / brightness / skin exposure) as that extension,
 * clearly separated so `motion` and `lighting` are reported independently and
 * the overall `score` is governed by the worse (limiting) of the two.
 *
 * Pure and frame-driven (plain numbers, no MediaPipe/DOM import): push one
 * sample per processed frame; the caller owns frame decoding and any UI.
 */
/** One processed frame's worth of capture cues. Every field is optional — the
 *  scorer degrades to whatever the host can supply (landmarks → face box →
 *  coarse motion scalar; explicit luminance → coarse motion scalar). */
export interface CaptureFrameSample {
    /** Normalized (0..1) face landmarks — the richest input for FMX/FMY. */
    landmarks?: {
        x: number;
        y: number;
    }[] | null;
    /** Normalized head/face box; fallback for FMX/FMY (center) and FSM (area). */
    faceBox?: FaceBox | null;
    /** Paper's N_i — pixel count of the skin ROI, the most faithful FSM input. */
    roiPixelCount?: number | null;
    /** Per-frame TI term: std (0..1) of the luminance frame-difference. */
    luminanceDiffStd?: number | null;
    /** Coarse 0..1 motion scalar (e.g. `motion_mean`); fallback for TI. */
    motion?: number | null;
    /** Mean pixel clipping fraction (0..1); overexposure washes out the pulse. */
    clipRatio?: number | null;
    /** Skin-pixel fraction of the ROI (0..1); low ⇒ poor lighting/framing. */
    skinRatio?: number | null;
    /** Mean ROI luminance (0..1); too dark or too bright both hurt. */
    meanLuma?: number | null;
}
export interface CaptureConfidenceConfig {
    /** Rolling window length in frames (≈1.5 s at 30 fps). */
    windowFrames: number;
    /** Frames required before `ready` flips true. */
    minSamples: number;
    /** Above this overall score there is no actionable limiting factor. */
    okThreshold: number;
    /** Feature value that maps to fully "bad" (badness = 1). Tune on-device. */
    tiBadAt: number;
    faceMotionBadAt: number;
    faceSizeMotionBadAt: number;
    clipBadAt: number;
    /** Usable luminance band; outside it darkness/brightness counts against. */
    lumaLow: number;
    lumaHigh: number;
    /** Skin fraction at/below which lighting/framing is fully penalized. */
    skinMin: number;
}
export declare const DEFAULT_CAPTURE_CONFIDENCE_CONFIG: CaptureConfidenceConfig;
export declare const CAPTURE_MOTION_RELIABILITY: {
    readonly ti: number;
    readonly fmx: number;
    readonly fmy: number;
    readonly fsm: number;
};
export type CaptureLimiting = "motion" | "lighting" | null;
export interface CaptureConfidenceResult {
    /** Overall 0..1 capture confidence = min(motion, lighting). */
    score: number;
    /** 0..1 motion-only confidence (the paper's contribution). */
    motion: number;
    /** 0..1 lighting-only confidence (the SDK's extension). */
    lighting: number;
    /** Raw windowed features, for telemetry/debug. */
    features: {
        ti: number;
        fmx: number;
        fmy: number;
        fsm: number;
    };
    /** Which dimension is holding the score down, or null when fine. */
    limiting: CaptureLimiting;
    /** Actionable reason codes (e.g. "high_ti", "clipping", "low_light"). */
    reasons: string[];
    /** False until the window has `minSamples` frames. */
    ready: boolean;
}
export interface CaptureFeatureInputs {
    /** Window max of the per-frame luminance-diff std (or motion fallback). */
    ti: number;
    /** Mean per-landmark |Δx| over the window (face-diagonal units). */
    fmx: number;
    /** Mean per-landmark |Δy| over the window (face-diagonal units). */
    fmy: number;
    /** Mean relative |ΔN| of the ROI area/pixel-count over the window. */
    fsm: number;
    /** Latest lighting cues (any may be null/unknown → not penalized). */
    clipRatio?: number | null;
    skinRatio?: number | null;
    meanLuma?: number | null;
}
/**
 * Pure scorer over already-extracted features — the math, isolated from frame
 * accumulation so it can be unit-tested directly.
 */
export declare function scoreCaptureFeatures(f: CaptureFeatureInputs, cfg?: CaptureConfidenceConfig): Omit<CaptureConfidenceResult, "ready">;
/**
 * Stateful, frame-driven capture-confidence scorer. Push one
 * {@link CaptureFrameSample} per processed frame; `push` returns the current
 * {@link CaptureConfidenceResult} over the rolling window.
 */
export declare class CaptureConfidenceScorer {
    private readonly cfg;
    private readonly tiBuf;
    private readonly fmxBuf;
    private readonly fmyBuf;
    private readonly fsmBuf;
    private prevLandmarks;
    private prevBox;
    private prevRoi;
    private clipRatio;
    private skinRatio;
    private meanLuma;
    private frames;
    constructor(cfg?: Partial<CaptureConfidenceConfig>);
    reset(): void;
    push(sample: CaptureFrameSample): CaptureConfidenceResult;
    private pushBuf;
}
//# sourceMappingURL=captureConfidence.d.ts.map