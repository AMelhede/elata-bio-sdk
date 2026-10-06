import { type ReplayDebugSession } from "./rppgReplay.js";
/**
 * Comparison harness for recorded debug sessions (TradeLock's
 * `ReplayDebugSession` format). Re-runs the SDK's Bayes tracker over a recorded
 * session via {@link replayBayesSession} and measures it against the outputs
 * TradeLock recorded on the *same* samples, giving an apples-to-apples
 * SDK-vs-TradeLock comparison on real data with no cross-repo dependency.
 *
 * Two families of metric:
 *  - **Agreement** (`agreement*`): mean |SDK replay BPM − TradeLock recorded BPM|
 *    over every point. Needs no reference, so it covers every session; it flags
 *    divergence between the two pipelines on identical input.
 *  - **Reference MAE** (`reference*`): mean abs error vs the Muse reference, from
 *    the pair-event windows. Tells you which pipeline is actually *closer* to
 *    ground truth, but only on sessions that recorded reference pairings.
 */
/** Running sum of absolute errors + the count contributing to it. */
export interface AbsErrorAccumulator {
    sumAbs: number;
    count: number;
}
export interface SessionComparison {
    syncSampleCount: number;
    pointCount: number;
    pairCount: number;
    /** Points where TradeLock emitted a trusted, non-manually-locked estimate. */
    cleanPointCount: number;
    /** |SDK replay Bayes − TradeLock recorded Bayes| over all points. */
    agreementBayes: AbsErrorAccumulator;
    /** |SDK replay Bayes − TradeLock recorded final| over all points. */
    agreementFinal: AbsErrorAccumulator;
    /**
     * |SDK replay Bayes − TradeLock recorded final|, but ONLY over samples
     * TradeLock trusted (not suppressed) and did not manually lock/snap. This is
     * the fair head-to-head: it excludes the 70–90% of samples TradeLock held on
     * low quality and any human-pinned output. Prefer this over `agreement*`.
     */
    cleanAgreementFinal: AbsErrorAccumulator;
    /** SDK replay Bayes MAE vs reference, pooled over pair windows. */
    referenceReplayBayes: AbsErrorAccumulator;
    /** TradeLock recorded Bayes MAE vs reference, pooled over pair windows. */
    referenceRecordedBayes: AbsErrorAccumulator;
    /** TradeLock recorded final MAE vs reference, pooled over pair windows. */
    referenceRecordedFinal: AbsErrorAccumulator;
}
export interface CorpusComparison {
    sessionCount: number;
    sessionsWithReference: number;
    totalSyncSamples: number;
    totalPairs: number;
    totalCleanPoints: number;
    agreementBayes: AbsErrorAccumulator;
    agreementFinal: AbsErrorAccumulator;
    cleanAgreementFinal: AbsErrorAccumulator;
    referenceReplayBayes: AbsErrorAccumulator;
    referenceRecordedBayes: AbsErrorAccumulator;
    referenceRecordedFinal: AbsErrorAccumulator;
}
/** Mean absolute error from an accumulator, or null when nothing contributed. */
export declare function maeOf(acc: AbsErrorAccumulator): number | null;
/** Compare one recorded session: SDK replay vs TradeLock recorded (+ reference). */
export declare function summarizeReplaySession(session: ReplayDebugSession, options?: {
    pairWindowMs?: number;
}): SessionComparison;
/** Pool per-session comparisons into one corpus-level result. */
export declare function aggregateComparisons(sessions: SessionComparison[]): CorpusComparison;
//# sourceMappingURL=replayBenchmark.d.ts.map