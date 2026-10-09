import { type BpmEvidenceQualityProvider, type BpmTrackerConfigV1 } from "./bpmBayesTracker.js";
import { type HarmonicRelation } from "./pulseAnalysis.js";
import { type ResolvedRppgFixSwitches, type RppgFixesOption } from "./fixSwitches.js";
import { type CaptureConfidenceConfig, type CaptureConfidenceResult, type CaptureFrameSample } from "./captureConfidence.js";
export type Backend = {
    newPipeline: (sampleRate: number, windowSec: number) => any;
};
export type BpmEvidenceSource = "backend" | "spectral" | "acf" | "peaks" | "calibrated";
export type FusionSource = "camera" | "muse" | "blend" | "none";
export type BpmEvidence = {
    source: BpmEvidenceSource;
    bpm: number;
    confidence: number;
    harmonicRelation?: HarmonicRelation;
};
export type BpmResolutionDebugEntry = BpmEvidence & {
    score: number;
    sameSupport: number;
    aliasSupport: number;
    ratioToHistory: number | null;
};
export type BpmResolutionResult = {
    bpm: number | null;
    confidence: number;
    winningSources: BpmEvidenceSource[];
    aliasFlag: boolean;
    debug: {
        candidates: BpmResolutionDebugEntry[];
        historyMedian: number | null;
        winner: BpmResolutionDebugEntry | null;
    };
};
export type Metrics = {
    /** Recommended display field. Final fused/calibrated BPM estimate. Null during warmup (~10s) or when backend is unavailable. */
    bpm?: number | null;
    /** 0–1 confidence score. Gate your UI on this — only show BPM when above your threshold (e.g. 0.5). */
    confidence: number;
    /** 0–1 raw signal quality based on skin ratio, motion, and clipping. Low values mean the camera signal is poor regardless of algorithm state. */
    signal_quality: number;
    /** Agreement between spectral and ACF estimators (0–1). Higher = the two methods agree on the same BPM. */
    agreement?: number;
    /** Debug codes explaining the current confidence level (e.g. "low_skin_ratio", "high_motion"). */
    reason_codes?: string[];
    /** Signal-to-noise ratio of the rPPG waveform. */
    snr?: number;
    /** Fraction of ROI pixels classified as skin (0–1). Low values indicate poor face framing or lighting. */
    skin_ratio_mean?: number;
    /** Mean motion level in the ROI. High values indicate the subject is moving too much for reliable estimation. */
    motion_mean?: number;
    /** Mean pixel clipping level. High values indicate overexposure washing out the rPPG signal. */
    clip_mean?: number;
    /** Intermediate: frequency-domain (FFT) BPM estimate. One of the two primary estimators. */
    spectral_bpm?: number | null;
    /** Intermediate: autocorrelation BPM estimate. One of the two primary estimators. */
    acf_bpm?: number | null;
    /** Intermediate: peak-detection BPM estimate. */
    peaks_bpm?: number | null;
    /** Intermediate: blended spectral+ACF estimate before Bayesian tracking. */
    resolved_bpm?: number | null;
    /** Confidence of the resolved (pre-Bayes) estimate. */
    resolved_confidence?: number;
    /** Which estimators contributed to the resolved estimate. */
    winning_sources?: BpmEvidenceSource[];
    /** Whether harmonic aliasing was detected in the frequency spectrum. */
    alias_flag?: boolean;
    /** Bayesian tracker output — temporally smoothed BPM with continuity across frames. */
    bayes_bpm?: number | null;
    /** Confidence of the Bayesian tracker output. */
    bayes_confidence?: number;
    bayes_ambiguity?: number;
    bayes_tracker_config_id?: string;
    bayes_quality_provider_id?: string | null;
    /** Bayesian BPM after online calibration model correction. Used as the basis for `bpm`. */
    calibrated_bpm?: number | null;
    /** Final fused estimate combining camera rPPG with an optional external BPM reference (e.g. Muse headband). Same as `bpm` when no external source is active. */
    fused_bpm?: number | null;
    /** Which source drove the fused estimate: `"camera"`, `"muse"`, `"blend"`, or `"none"`. */
    fused_source?: FusionSource;
    /** Whether the online calibration model has accumulated enough data to correct estimates. */
    calibration_trained?: boolean;
    /** Rolling baseline BPM for relative-change calculations. */
    baseline_bpm?: number | null;
    /** Current BPM delta from the rolling baseline. Positive = elevated above resting rate. */
    baseline_delta?: number | null;
    /** Heart rate variability (RMSSD in ms). Experimental — requires sufficient window length. */
    hrv_rmssd?: number | null;
    /** Estimated respiration rate (breaths/min) derived from the rPPG waveform. Experimental. */
    respiration_rate?: number | null;
    /** Confidence (0..1) of `respiration_rate`; null when no estimate is available. */
    respiration_confidence?: number | null;
    /**
     * 0..1 confidence in the *capture environment* (motion + lighting), distinct
     * from `confidence`/`signal_quality`. Present only when the host feeds frames
     * via {@link RppgProcessor.pushCaptureFrame}. Gate calibration on this and
     * surface `capture_limiting` so the user knows what to fix.
     */
    capture_confidence?: number;
    /** Motion-only component of `capture_confidence` (0..1). */
    capture_motion?: number;
    /** Lighting-only component of `capture_confidence` (0..1). */
    capture_lighting?: number;
    /** Which dimension is holding capture confidence down, or null when fine. */
    capture_limiting?: "motion" | "lighting" | null;
    /** Actionable capture reason codes (e.g. "high_ti", "clipping", "low_light"). */
    capture_reasons?: string[];
};
export type RppgDebugIssueCode = "no_samples_yet" | "insufficient_window" | "no_bpm_yet" | "low_signal_quality" | "low_confidence" | "low_skin_ratio" | "excessive_motion" | "high_clipping";
export type RppgDebugSnapshot = {
    totalSamplesReceived: number;
    windowSampleCount: number;
    windowDurationMs: number;
    lastSampleTimestampMs: number | null;
    lastSampleAgeMs: number | null;
    lastSample: {
        intensity: number;
        r: number;
        g: number;
        b: number;
        skinRatio: number;
        motion: number;
        clipRatio: number;
    } | null;
    backendMetrics: Metrics;
    issues: RppgDebugIssueCode[];
};
export type RppgProcessorBackendFailure = {
    operation: string;
    message: string;
};
export type RppgTracePoint = {
    timestampMs: number;
    intensity: number;
    r: number;
    g: number;
    b: number;
    skinRatio: number;
    motion: number;
    clipRatio: number;
};
export type RppgTraceSnapshot = {
    sampleRate: number;
    windowSec: number;
    totalSamplesReceived: number;
    windowSampleCount: number;
    windowDurationMs: number;
    durationSec: number;
    points: RppgTracePoint[];
    lastSample: RppgDebugSnapshot["lastSample"];
    backendFailure: RppgProcessorBackendFailure | null;
};
/** The samples the processor keeps for its window analysis (heart rate, HRV, breathing), in ms. */
export declare const SAMPLE_HISTORY_MS = 45000;
export declare function museStyleFilter(samples: number[], sampleRate: number): number[];
export declare class MuseCalibrationModel {
    private weights;
    private learningRate;
    private trained;
    isTrained(): boolean;
    predict(spectralBpm: number, acfBpm: number): number;
    train(spectralBpm: number, acfBpm: number, trueBpm: number): void;
    reset(): void;
    getSnapshot(): {
        weights: {
            spectral: number;
            acf: number;
            bias: number;
        };
        trained: boolean;
        learningRate: number;
    };
    loadSnapshot(snapshot: unknown): void;
}
export declare class MuseFusionCalibrator {
    private bias;
    private lastMuseBpm;
    private lastMuseQuality;
    private lastMuseTs;
    private updateCount;
    updateMuse(bpm: number | null, quality?: number | null, timestampMs?: number): void;
    updateCamera(cameraBpm: number | null, cameraQuality?: number | null, timestampMs?: number): void;
    fuse(cameraBpm: number | null, cameraQuality?: number | null, timestampMs?: number): {
        bpm: number | null;
        source: FusionSource;
        bias: number;
    };
    private isMuseFresh;
    getReference(nowMs?: number): {
        bpm: number;
        strength: number;
    } | null;
    getSnapshot(): {
        bias: number;
        updateCount: number;
    };
    loadSnapshot(snapshot: unknown): void;
}
export declare class RppgProcessor {
    private backend;
    private pipeline;
    private readonly samples;
    private readonly bpmHistory;
    private readonly cameraCalibration;
    private readonly fusion;
    private readonly bayesTracker;
    private readonly channelGain;
    private readonly chromPulse;
    private fusedQuality;
    private captureScorer;
    private lastCapture;
    private baselineBpm;
    private baselineDeviationStartMs;
    private lastBayesUpdateMs;
    /** The last analysis and the sample time it ran at (switch steadyAnalysis); null forces the next read to analyse. */
    private analysed;
    /**
     * The window analysis of the samples as they stand. It is a pure function of them, so a second analysis of the
     * same samples (steadyAnalysis' second pass, or two reads with no sample between) reuses it; any change to the
     * samples bumps samplesVersion and the next analysis computes afresh.
     */
    private windowAnalysis;
    private samplesVersion;
    private totalSamplesReceived;
    private failedBackendError;
    private failedOperation;
    private disposed;
    private readonly sampleRate;
    private readonly windowSec;
    /** The fix switches this processor applies (colourProjectionFix, noRateDoubling). */
    readonly fixes: ResolvedRppgFixSwitches;
    constructor(backend: Backend, sampleRate?: number, windowSec?: number, options?: {
        bpmTrackerConfig?: BpmTrackerConfigV1;
        bpmEvidenceQualityProvider?: BpmEvidenceQualityProvider;
        /** Fix switches, all on unless set to false (see fixSwitches.ts). */
        fixes?: RppgFixesOption;
    });
    enableTracker(minBpm?: number, maxBpm?: number, numParticles?: number): void;
    /**
     * Feed one frame's capture cues (motion + lighting). Returns the current
     * capture-confidence result, which is also folded into `getMetrics()` as the
     * `capture_*` fields. Optional and independent of the RGB/pulse path — hosts
     * that don't call this simply get no `capture_*` metrics. Pass `config` on
     * the first call to tune the scorer.
     */
    pushCaptureFrame(sample: CaptureFrameSample, config?: Partial<CaptureConfidenceConfig>): CaptureConfidenceResult;
    /** Latest capture-confidence result, or null if no frames have been fed. */
    getCaptureConfidence(): CaptureConfidenceResult | null;
    isBackendFailed(): boolean;
    getBackendFailure(): RppgProcessorBackendFailure | null;
    dispose(): void;
    pushSample(timestampMs: number, intensity: number): void;
    /**
     * Push a pre-extracted, fused pulse value from the multi-ROI fuser
     * ({@link MultiRoiRppgFuser}). The fuser already ran CHROM + bandpass per face
     * region and blended them by in-band spectral SNR, so we feed the fused pulse
     * through the intensity path for spectral BPM/HRV and carry the fuser's
     * `fusedSnr` as the quality scalar — the backend's RGB-derived signal_quality
     * doesn't apply once its CHROM stage is bypassed.
     */
    pushFusedSample(timestampMs: number, fusedValue: number, fusedSnr: number): void;
    pushSampleRgb(timestampMs: number, r: number, g: number, b: number, skinRatio?: number): void;
    pushSampleRgbMeta(timestampMs: number, r: number, g: number, b: number, skinRatio?: number, motion?: number, clipRatio?: number): void;
    updateMuseMetrics(bpm: number | null, quality?: number, timestampMs?: number): void;
    resetCalibration(): void;
    getStateSnapshot(): {
        baselineBpm: number | null;
        baselineDeviationStartMs: number | null;
        bpmHistory: number[];
        cameraCalibration: {
            weights: {
                spectral: number;
                acf: number;
                bias: number;
            };
            trained: boolean;
            learningRate: number;
        };
        bayesTracker: import("./bpmBayesTracker.js").BpmBayesSnapshot;
        fusion: {
            bias: number;
            updateCount: number;
        };
    };
    loadStateSnapshot(snapshot: unknown): void;
    /**
     * The heart rate and everything derived with it. With the switch steadyAnalysis (on by default) the
     * analysis runs once per ANALYSIS_EVERY_MS of sample time, as the worker's answer did, and reads in between
     * are answered from it, so the answer does not depend on how often it is read. Off, as published: every
     * read analyses again, and the rate tracker takes the same window once per read.
     */
    getMetrics(): Metrics;
    getDebugSnapshot(nowMs?: number): RppgDebugSnapshot;
    getTraceSnapshot(maxPoints?: number): RppgTraceSnapshot;
    private readBackendMetrics;
    private assertBackendHealthy;
    private failBackend;
    private releasePipeline;
    private pushLocalSample;
    private computeLocalRgbIntensity;
    /** analyzePulseWindow over the samples, computed once per set of samples (see windowAnalysis). */
    private analyseWindow;
    private computeAdvancedMetrics;
    private updateBaseline;
}
//# sourceMappingURL=rppgProcessor.d.ts.map