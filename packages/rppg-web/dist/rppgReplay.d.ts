export interface ReplayEstimatorSample {
    instantBpm?: number | null;
    acfBpm?: number | null;
    peakConfidence?: number | null;
    acfConfidence?: number | null;
    spectralConfidence?: number | null;
    spectralBpm?: number | null;
    bayesBpm?: number | null;
    bayesConfidence?: number | null;
    finalBpm?: number | null;
    candidateSummary?: string | null;
    cameraConfidence?: number | null;
    snrDb?: number | null;
    motion?: number | null;
    activeReferenceBpm?: number | null;
    /** TradeLock held its output this sample (low quality); `finalBpm` is null. */
    suppressed?: boolean | null;
    /** Pipeline-stage trail, e.g. "acf_doubleFix|snap_manual|bayes". Used to
     *  detect human/manual locks that should be excluded from fair comparison. */
    bpmSource?: string | null;
    /** Whether a snap-to-reference was applied this sample. */
    snapApplied?: boolean | null;
}
export interface ReplaySyncSample {
    epochTs: number;
    sampleRate?: number | null;
    stage?: string;
    peaks?: Array<unknown>;
    filteredWindow?: {
        values?: number[] | null;
    } | null;
    museWindow?: {
        values?: number[] | null;
    } | null;
    estimators?: ReplayEstimatorSample;
    outputs?: {
        signalQuality?: number | null;
    };
}
export interface ReplayPairEvent {
    ts: number;
    referenceBpm: number;
}
export interface ReplayDebugSession {
    syncSamples: ReplaySyncSample[];
    pairEvents?: ReplayPairEvent[];
}
export interface ReplayPoint {
    ts: number;
    stage: string;
    replayBayesBpm: number | null;
    replayBayesConfidence: number;
    recordedBayesBpm: number | null;
    recordedBayesConfidence: number | null;
    recordedFinalBpm: number | null;
    referenceBpm: number | null;
    /** TradeLock emitted a trusted estimate here (not suppressed, finalBpm set).
     *  Comparisons should gate on this — suppressed samples are TradeLock holding
     *  on low quality, not a fair head-to-head with the free-running replay. */
    recordedTrusted: boolean;
    /** TradeLock's output was human/manually locked or snapped this sample, so it
     *  is not algorithm output and should be excluded from fair comparison. */
    recordedManualLock: boolean;
}
export interface ReplayWindowSummary {
    referenceBpm: number;
    pairTs: number;
    windowMs: number;
    points: number;
    recordedBayesMae: number | null;
    replayBayesMae: number | null;
    recordedFinalMae: number | null;
    replayMeanBpm: number | null;
    recordedMeanBpm: number | null;
}
export interface ReplayBayesSessionResult {
    schema: string;
    points: ReplayPoint[];
    pairSummaries: ReplayWindowSummary[];
}
export declare function replayBayesSession(session: ReplayDebugSession, options?: {
    pairWindowMs?: number;
}): ReplayBayesSessionResult;
//# sourceMappingURL=rppgReplay.d.ts.map