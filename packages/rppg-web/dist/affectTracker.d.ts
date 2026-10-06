import { type AffectState, type FaceBlendshapeCategory } from "./affect.js";
/**
 * Stateful affect estimator: combines face blendshapes (valence + face arousal)
 * with rPPG physiology (arousal from HR elevation / HRV suppression vs a resting
 * baseline). Valence comes from the face; arousal is physiology-primary, fused
 * with face arousal and each gated by confidence. Builds the resting baseline
 * automatically from the first N stable physiology samples.
 */
export type AffectBaseline = {
    bpm: number;
    rmssd: number;
};
export type AffectTrackerOptions = {
    /** Physiology samples to average into the resting baseline (default 60). */
    baselineSamples?: number;
    /** Face affect older than this (ms) is ignored when fusing (default 1500). */
    faceStaleMs?: number;
    /** Fallback RMSSD if none observed during baseline (default 50 ms). */
    defaultRmssd?: number;
};
export declare class AffectTracker {
    private lastFaceValence;
    private lastFaceArousal;
    private lastFaceAtMs;
    private baseline;
    private calibBpm;
    private calibRmssd;
    private readonly baselineSamples;
    private readonly faceStaleMs;
    private readonly defaultRmssd;
    constructor(options?: AffectTrackerOptions);
    reset(): void;
    getBaseline(): AffectBaseline | null;
    setBaseline(baseline: AffectBaseline | null): void;
    /** Feed face blendshapes; stores valence + face arousal with a timestamp. */
    observeFace(blendshapes: FaceBlendshapeCategory[] | null | undefined, nowMs?: number): void;
    /** Feed physiology; accumulates the resting baseline until enough samples seen. */
    observePhysiology(bpm: number | null, rmssd: number | null): void;
    /** Compute the current fused affect state. */
    compute(input: {
        bpm: number | null;
        rmssd: number | null;
        physioConfidence?: number;
        faceConfidence?: number;
        nowMs?: number;
    }): AffectState;
}
//# sourceMappingURL=affectTracker.d.ts.map