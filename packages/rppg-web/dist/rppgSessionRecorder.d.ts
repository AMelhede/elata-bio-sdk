import type { Metrics } from "./rppgProcessor.js";
import type { ReplayDebugSession } from "./rppgReplay.js";
/**
 * Captures a live rPPG session into the {@link ReplayDebugSession} format that
 * `replayBayesSession` and the replay benchmark consume — closing the loop:
 * record → download → replay → compare.
 *
 * Feed it the processor's per-frame {@link Metrics} via {@link recordMetrics},
 * and (the part that makes comparisons truth-anchored) push a ground-truth
 * reference BPM via {@link recordReference} — e.g. the Muse headband's contact
 * PPG heart rate — which is stored as a `pairEvent`. A recording with frequent,
 * non-locked reference pairings is what lets the benchmark say which pipeline is
 * actually closer to ground truth, not merely how much they diverge.
 *
 * Waveform windows (the bulk of recording size) are omitted by default; enable
 * {@link RppgRecorderOptions.includeWaveform} only when you need the replay's
 * waveform-periodicity path.
 */
export interface RppgRecorderOptions {
    /** Capture filtered/Muse waveform arrays per sample (large). Default false. */
    includeWaveform?: boolean;
    /** Ring-buffer cap on retained sync samples (oldest dropped). Default 50000. */
    maxSamples?: number;
}
export interface RecordMetricsContext {
    /** Sample timestamp (epoch ms). Defaults to `Date.now()`. */
    timestampMs?: number;
    /** Effective sample rate (Hz) of the waveform window, if known. */
    sampleRate?: number | null;
    /** Free-form stage label (mirrors TradeLock's per-sample stage). */
    stage?: string;
    /** Filtered camera waveform values (stored only when includeWaveform). */
    filteredWindow?: number[] | null;
    /** Muse/reference waveform values (stored only when includeWaveform). */
    museWindow?: number[] | null;
    /** Detected peaks for the window (stored as-is). */
    peaks?: unknown[];
}
export declare class RppgSessionRecorder {
    private readonly options;
    private readonly syncSamples;
    private readonly pairEvents;
    private lastReferenceBpm;
    constructor(options?: RppgRecorderOptions);
    /** Append one sync sample built from the processor's current metrics. */
    recordMetrics(metrics: Metrics, context?: RecordMetricsContext): void;
    /**
     * Record a ground-truth reference BPM (e.g. Muse contact-PPG heart rate) as a
     * pair event. Non-finite values are ignored.
     */
    recordReference(referenceBpm: number, timestampMs?: number): void;
    /** Number of captured sync samples. */
    get sampleCount(): number;
    /** Number of recorded reference pair events. */
    get pairCount(): number;
    /** Clear all captured samples and references. */
    reset(): void;
    /** Snapshot the recording as a replayable session (arrays are copied). */
    toSession(): ReplayDebugSession;
    /** Serialize the recording to a JSON string ready to download. */
    toJSON(pretty?: boolean): string;
}
//# sourceMappingURL=rppgSessionRecorder.d.ts.map