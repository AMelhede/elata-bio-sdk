/** Per-region pulse projection. POS by default: see {@link PosPulseModel} for the evidence. */
export type FusionProjection = "pos" | "chrom";
/**
 * Multi-ROI rPPG fusion.
 *
 * Instead of reading the pulse from a single forehead patch, this runs CHROM +
 * bandpass independently on several face regions (forehead + both cheeks) and
 * blends them with weights proportional to each region's in-band spectral SNR.
 * The cleanest region dominates moment-to-moment, so local glare, hair, glasses
 * glint, or partial occlusion on any one ROI no longer poisons the estimate.
 *
 * Per-ROI CHROM is self-normalizing (it divides by each channel's temporal
 * mean), so the raw skin-masked ROI averages can be fed directly — no shared
 * AGC across regions, which would be incorrect.
 */
export type FusionRoiName = "forehead" | "leftCheek" | "rightCheek";
export declare const FUSION_ROIS: readonly FusionRoiName[];
export interface RoiRgbSample {
    r: number;
    g: number;
    b: number;
    /** 0..1 fraction of the ROI that read as skin; low-skin ROIs are skipped. */
    skinFraction?: number;
}
export interface MultiRoiFusionResult {
    /** Fused bandpassed pulse value for this frame (push to the analysis buffer). */
    fused: number;
    /** Whether at least one ROI contributed this frame. */
    valid: boolean;
    /** Per-ROI fusion weights (sum to 1), SNR-driven and EMA-smoothed. */
    weights: Record<FusionRoiName, number>;
    /** Per-ROI in-band spectral SNR (linear) from the last weight update. */
    snr: Record<FusionRoiName, number>;
    /**
     * In-band spectral SNR (linear) of the *fused* signal — the quality scalar
     * that should gate HR/HRV display. ~1 means no usable pulse.
     */
    fusedSnr: number;
}
export declare class MultiRoiRppgFuser {
    private readonly fs;
    private readonly chrom;
    private readonly band;
    private buf;
    private fusedBuf;
    private weights;
    private snr;
    private fusedSnr;
    private frame;
    private readonly bufLimit;
    private readonly minSamples;
    private readonly updateEvery;
    private readonly weightEma;
    constructor(fs?: number, windowSeconds?: number, updateEverySeconds?: number, projection?: FusionProjection);
    private makeRecord;
    reset(): void;
    pushFrame(samples: Partial<Record<FusionRoiName, RoiRgbSample>>): MultiRoiFusionResult;
    private updateWeights;
}
//# sourceMappingURL=multiRoiFusion.d.ts.map