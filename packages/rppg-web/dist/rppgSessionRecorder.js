function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export class RppgSessionRecorder {
    constructor(options = {}) {
        this.syncSamples = [];
        this.pairEvents = [];
        this.lastReferenceBpm = null;
        this.options = {
            includeWaveform: options.includeWaveform ?? false,
            maxSamples: options.maxSamples ?? 50000,
        };
    }
    /** Append one sync sample built from the processor's current metrics. */
    recordMetrics(metrics, context = {}) {
        const finalBpm = num(metrics.bpm);
        const sample = {
            epochTs: context.timestampMs ?? Date.now(),
            sampleRate: context.sampleRate ?? null,
            stage: context.stage ?? "recorded",
            estimators: {
                instantBpm: num(metrics.peaks_bpm) ?? finalBpm,
                acfBpm: num(metrics.acf_bpm),
                spectralBpm: num(metrics.spectral_bpm),
                bayesBpm: num(metrics.bayes_bpm),
                bayesConfidence: num(metrics.bayes_confidence),
                finalBpm,
                cameraConfidence: num(metrics.confidence),
                snrDb: num(metrics.snr),
                motion: num(metrics.motion_mean),
                activeReferenceBpm: this.lastReferenceBpm,
                // The replay/benchmark gate on these: suppressed = held this frame,
                // bpmSource carries the evidence trail (no manual lock from the SDK).
                suppressed: finalBpm == null,
                bpmSource: metrics.winning_sources && metrics.winning_sources.length
                    ? metrics.winning_sources.join("|")
                    : (metrics.fused_source ?? null),
            },
            outputs: {
                signalQuality: metrics.signal_quality != null
                    ? metrics.signal_quality * 100
                    : null,
            },
        };
        if (context.peaks)
            sample.peaks = context.peaks;
        if (this.options.includeWaveform) {
            if (context.filteredWindow) {
                sample.filteredWindow = { values: context.filteredWindow };
            }
            if (context.museWindow) {
                sample.museWindow = { values: context.museWindow };
            }
        }
        this.syncSamples.push(sample);
        if (this.syncSamples.length > this.options.maxSamples) {
            this.syncSamples.shift();
        }
    }
    /**
     * Record a ground-truth reference BPM (e.g. Muse contact-PPG heart rate) as a
     * pair event. Non-finite values are ignored.
     */
    recordReference(referenceBpm, timestampMs) {
        if (!Number.isFinite(referenceBpm))
            return;
        this.lastReferenceBpm = referenceBpm;
        this.pairEvents.push({
            ts: timestampMs ?? Date.now(),
            referenceBpm,
        });
    }
    /** Number of captured sync samples. */
    get sampleCount() {
        return this.syncSamples.length;
    }
    /** Number of recorded reference pair events. */
    get pairCount() {
        return this.pairEvents.length;
    }
    /** Clear all captured samples and references. */
    reset() {
        this.syncSamples.length = 0;
        this.pairEvents.length = 0;
        this.lastReferenceBpm = null;
    }
    /** Snapshot the recording as a replayable session (arrays are copied). */
    toSession() {
        return {
            syncSamples: this.syncSamples.slice(),
            pairEvents: this.pairEvents.slice(),
        };
    }
    /** Serialize the recording to a JSON string ready to download. */
    toJSON(pretty = false) {
        return JSON.stringify(this.toSession(), null, pretty ? 2 : 0);
    }
}
