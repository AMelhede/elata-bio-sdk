/**
 * Camera respiration estimation from a single rPPG trace.
 *
 * Breathing modulates the pulse three independent ways, each recoverable from a
 * one-channel camera signal:
 *
 *  - **RIIV** (respiratory-induced *intensity* variation): a low-frequency
 *    baseline wander at the breathing rate. Strong at rest, easily corrupted by
 *    motion/lighting drift.
 *  - **RIAV** (respiratory-induced *amplitude* variation): the breath modulates
 *    pulse *amplitude*, recovered from the cardiac-band envelope. Robust when the
 *    baseline is corrupted.
 *  - **RSA** (respiratory sinus arrhythmia): the breath modulates beat-to-beat
 *    timing, recovered from the inter-beat-interval tachogram. Independent of the
 *    waveform amplitude/baseline entirely.
 *
 * On a clean, still signal all three are resolution-limited and essentially
 * equivalent, so the single-cue legacy estimate was fine. The cues diverge under
 * motion/artifacts: whichever cue a given artifact corrupts, the other two
 * usually survive. This module computes all three and fuses them with a
 * transparent agreement rule — when >=2 cues agree it returns their
 * confidence-weighted mean (and reports higher confidence); otherwise it falls
 * back to the single strongest cue only if it clears a prominence floor, and
 * abstains (null) when nothing is trustworthy.
 *
 * This is standard signal processing (band-limited periodograms over three
 * documented respiration cues + an agreement vote). It deliberately does NOT
 * implement a learned/adaptive fusion model.
 */
export type RespSource = "riiv" | "riav" | "rsa";
export interface RespCueEstimate {
    source: RespSource;
    brpm: number;
    /** In-band spectral prominence of the dominant peak, 0..1. */
    confidence: number;
}
export interface RespirationEstimate {
    /** Fused respiration rate in breaths per minute. */
    brpm: number;
    /** Fused confidence, 0..1. Boosted when multiple cues agree. */
    confidence: number;
    /** Which cues backed the returned value. */
    sources: RespSource[];
    /** True when >=2 independent cues agreed within tolerance. */
    agreement: boolean;
}
export interface RespirationInput {
    /** Conditioned, mean-removed rPPG trace (e.g. temporalNormalize output). */
    signal: number[];
    /** Sample rate of `signal` (Hz). */
    sampleRate: number;
    /** Inter-beat intervals (ms) for the RSA cue. Optional. */
    ibisMs?: number[] | null;
    /** Beat instants (ms) aligned to `ibisMs` for the RSA cue. Optional. */
    beatTimesMs?: number[] | null;
}
/**
 * Find the dominant frequency in [minHz, maxHz] via a Hann-windowed Goertzel
 * scan, returning the peak rate (brpm) and an in-band prominence in 0..1
 * (peak magnitude relative to the band mean). Returns null when the input is
 * too short or has no energy.
 */
export declare function dominantInBand(values: number[], sampleRate: number, minHz?: number, maxHz?: number): {
    brpm: number;
    confidence: number;
} | null;
/**
 * Cardiac-band amplitude envelope (the RIAV carrier): isolate the pulse, rectify,
 * and smooth with a ~1 s moving average. The envelope rises and falls at the
 * breathing rate when respiration modulates pulse amplitude.
 */
export declare function amplitudeEnvelope(signal: number[], sampleRate: number): number[];
/**
 * Resample an inter-beat-interval tachogram onto a uniform grid so its
 * respiratory (RSA) oscillation can be read by a periodogram. Returns null when
 * there are too few beats or too short a span to trust.
 */
export declare function resampleTachogram(ibisMs: number[], beatTimesMs: number[], resampleHz?: number): number[] | null;
/**
 * Estimate respiration rate by fusing the RIIV, RIAV, and RSA cues.
 *
 * - >=2 cues agreeing → confidence-weighted mean, confidence boosted.
 * - otherwise the single strongest cue, but only if it clears SINGLE_CUE_FLOOR.
 * - nothing trustworthy → null (abstain).
 */
export declare function estimateRespiration(input: RespirationInput): RespirationEstimate | null;
//# sourceMappingURL=respirationAnalysis.d.ts.map