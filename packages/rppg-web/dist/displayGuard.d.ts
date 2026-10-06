/**
 * No-reference display guard for the camera BPM readout.
 *
 * When there is no external reference lock (no headband / finger-count pairing),
 * the displayed BPM can jump to a harmonic — the half-rate sub-harmonic or the
 * double-rate harmonic — of the true pulse. This guard inspects the candidate
 * against the independent estimators (instant peaks, autocorrelation, spectral)
 * and the Bayes tracker, and either lets the candidate through or snaps it back
 * to a stable / corroborated value.
 *
 * Notably, a large jump is *not* "unsupported" when two independent
 * frequency-domain estimators agree on a plausible rate near the candidate:
 * that is a genuine octave recovery and is surfaced as
 * `cluster_corroborated_jump` rather than being reverted.
 */
export interface NoReferenceDisplayGuardDecision {
    bpm: number;
    applied: boolean;
    reason: "none" | "high_harmonic_spike" | "low_harmonic_drop" | "unsupported_large_jump" | "cluster_corroborated_jump";
}
export declare const applyNoReferenceDisplayGuard: (options: {
    hasReferenceLock?: boolean;
    candidateBpm?: number | null;
    smoothedBpm?: number | null;
    trackerBpm?: number | null;
    trackerConfidence?: number;
    instantBpm?: number | null;
    acfBpm?: number | null;
    spectralBpm?: number | null;
    resolutionConfidence?: number;
    estimatorSpread?: number;
}) => NoReferenceDisplayGuardDecision;
/**
 * Whether a large BPM jump should be allowed to reset the display smoothing.
 * Requires a sustained jump streak (`bpmJumpCounter` past `requiredJumpCounter`)
 * and then either a reference lock or a high-confidence tracker that agrees with
 * the candidate. Used alongside the persistent-disagreement catch-up so a steady
 * distant rate can take over the display without waiting on a manual pair.
 */
export declare const shouldAllowDisplayJumpReset: (options: {
    hasReferenceLock?: boolean;
    bpmJumpCounter?: number;
    candidateBpm?: number | null;
    trackerBpm?: number | null;
    trackerConfidence?: number;
    requiredJumpCounter?: number;
}) => boolean;
//# sourceMappingURL=displayGuard.d.ts.map