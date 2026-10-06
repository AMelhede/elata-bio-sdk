/**
 * Always-live BPM readout smoothing.
 *
 * The trusted/gated BPM that feeds baseline and state should change slowly and
 * only when confidence is high — but a UI readout that goes blank or freezes
 * whenever the gate suppresses a frame looks broken. {@link DisplayBpmTracker}
 * maintains a number that keeps moving every cycle:
 *
 *  - a short **median window** rejects single-frame harmonic flips,
 *  - a light **EMA** keeps it visually smooth,
 *  - **jump protection** ignores a >30 bpm jump from the smoothed value unless a
 *    sustained, self-consistent distant rate is seen for several cycles
 *    (persistent-disagreement catch-up) or a high-confidence tracker / reference
 *    allows it — this frees the display from a wrong initial seed without
 *    chasing transient artifacts, and
 *  - {@link hold} keeps the readout live (preferring the tracker estimate, else
 *    the last shown value) on cycles the caller suppresses entirely.
 *
 * Callers decide whether to render the value dimmed (e.g. when the trusted gate
 * is failing); the tracker only supplies the live number.
 */
export interface DisplayBpmOptions {
    /** Below/above this range a candidate is ignored entirely (default 40/180). */
    minBpm?: number;
    maxBpm?: number;
    /** Median window length in cycles (default 24 ≈ 4 s at ~6 Hz analysis). */
    medianWindow?: number;
    /** EMA weight on the new median (default 0.12 ≈ 1.5 s time constant). */
    emaAlpha?: number;
    /** A jump beyond this many bpm from the smoothed value triggers protection (default 30). */
    jumpThresholdBpm?: number;
    /** Consecutive self-consistent distant cycles required to adopt a jump (default 8). */
    catchupFrames?: number;
    /** Tolerance (bpm) for a distant rate to count as "the same" across cycles (default 12). */
    catchupToleranceBpm?: number;
    /** Upper bound for accepting a tracker estimate during {@link hold} (default 200). */
    holdMaxBpm?: number;
}
export type DisplayBpmStatus = "tracking" | "jump_adopted" | "jump_rejected" | "out_of_range";
export interface DisplayBpmUpdateContext {
    trackerBpm?: number | null;
    trackerConfidence?: number;
    hasReferenceLock?: boolean;
    /** Running count of consecutive large beat-to-beat jumps (panic/sprint). */
    bpmJumpCounter?: number;
}
export interface DisplayBpmUpdate {
    /** Live value to render (unchanged from last cycle when a jump is rejected). */
    displayBpm: number | null;
    /** The smoothed value (same as displayBpm unless out of range / rejected). */
    smoothedBpm: number | null;
    /** The rounded raw candidate that was fed in. */
    rawBpm: number | null;
    status: DisplayBpmStatus;
}
export declare class DisplayBpmTracker {
    private readonly minBpm;
    private readonly maxBpm;
    private readonly medianWindow;
    private readonly emaAlpha;
    private readonly jumpThresholdBpm;
    private readonly catchupFrames;
    private readonly catchupToleranceBpm;
    private readonly holdMaxBpm;
    private history;
    private smoothedVal;
    private catchupRef;
    private catchupCount;
    private lastDisplay;
    constructor(options?: DisplayBpmOptions);
    get displayBpm(): number | null;
    get smoothedBpm(): number | null;
    reset(): void;
    /**
     * Feed the resolved camera BPM for this cycle and get the value to display.
     * A rejected jump leaves the display unchanged; an adopted jump or a normal
     * cycle advances the median + EMA.
     */
    update(candidateBpm: number, ctx?: DisplayBpmUpdateContext): DisplayBpmUpdate;
    /**
     * Keep the readout live on a cycle the caller suppressed (no trusted BPM):
     * prefer the tracker estimate when plausible, otherwise hold the last shown
     * value. Does not touch the smoothed state.
     */
    hold(ctx?: {
        trackerBpm?: number | null;
    }): number | null;
}
//# sourceMappingURL=displayBpm.d.ts.map