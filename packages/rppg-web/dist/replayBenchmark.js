import { replayBayesSession, } from "./rppgReplay.js";
function emptyAcc() {
    return { sumAbs: 0, count: 0 };
}
function addAbs(acc, a, b) {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b))
        return;
    acc.sumAbs += Math.abs(a - b);
    acc.count += 1;
}
/** Re-pool a window's already-averaged MAE by weighting it back up by its point count. */
function addPooledMae(acc, mae, points) {
    if (mae == null || !Number.isFinite(mae) || points <= 0)
        return;
    acc.sumAbs += mae * points;
    acc.count += points;
}
function mergeAcc(into, from) {
    into.sumAbs += from.sumAbs;
    into.count += from.count;
}
/** Mean absolute error from an accumulator, or null when nothing contributed. */
export function maeOf(acc) {
    return acc.count > 0 ? acc.sumAbs / acc.count : null;
}
/** Compare one recorded session: SDK replay vs TradeLock recorded (+ reference). */
export function summarizeReplaySession(session, options) {
    const result = replayBayesSession(session, options);
    const agreementBayes = emptyAcc();
    const agreementFinal = emptyAcc();
    const cleanAgreementFinal = emptyAcc();
    let cleanPointCount = 0;
    for (const point of result.points) {
        addAbs(agreementBayes, point.replayBayesBpm, point.recordedBayesBpm);
        addAbs(agreementFinal, point.replayBayesBpm, point.recordedFinalBpm);
        if (point.recordedTrusted && !point.recordedManualLock) {
            cleanPointCount += 1;
            addAbs(cleanAgreementFinal, point.replayBayesBpm, point.recordedFinalBpm);
        }
    }
    const referenceReplayBayes = emptyAcc();
    const referenceRecordedBayes = emptyAcc();
    const referenceRecordedFinal = emptyAcc();
    for (const summary of result.pairSummaries) {
        addPooledMae(referenceReplayBayes, summary.replayBayesMae, summary.points);
        addPooledMae(referenceRecordedBayes, summary.recordedBayesMae, summary.points);
        addPooledMae(referenceRecordedFinal, summary.recordedFinalMae, summary.points);
    }
    return {
        syncSampleCount: session.syncSamples.length,
        pointCount: result.points.length,
        pairCount: result.pairSummaries.length,
        cleanPointCount,
        agreementBayes,
        agreementFinal,
        cleanAgreementFinal,
        referenceReplayBayes,
        referenceRecordedBayes,
        referenceRecordedFinal,
    };
}
/** Pool per-session comparisons into one corpus-level result. */
export function aggregateComparisons(sessions) {
    const corpus = {
        sessionCount: sessions.length,
        sessionsWithReference: 0,
        totalSyncSamples: 0,
        totalPairs: 0,
        totalCleanPoints: 0,
        agreementBayes: emptyAcc(),
        agreementFinal: emptyAcc(),
        cleanAgreementFinal: emptyAcc(),
        referenceReplayBayes: emptyAcc(),
        referenceRecordedBayes: emptyAcc(),
        referenceRecordedFinal: emptyAcc(),
    };
    for (const session of sessions) {
        corpus.totalSyncSamples += session.syncSampleCount;
        corpus.totalPairs += session.pairCount;
        corpus.totalCleanPoints += session.cleanPointCount;
        if (session.pairCount > 0)
            corpus.sessionsWithReference += 1;
        mergeAcc(corpus.agreementBayes, session.agreementBayes);
        mergeAcc(corpus.agreementFinal, session.agreementFinal);
        mergeAcc(corpus.cleanAgreementFinal, session.cleanAgreementFinal);
        mergeAcc(corpus.referenceReplayBayes, session.referenceReplayBayes);
        mergeAcc(corpus.referenceRecordedBayes, session.referenceRecordedBayes);
        mergeAcc(corpus.referenceRecordedFinal, session.referenceRecordedFinal);
    }
    return corpus;
}
