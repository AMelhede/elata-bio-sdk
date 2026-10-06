import { shouldAllowDisplayJumpReset } from "./displayGuard.js";
export class DisplayBpmTracker {
    constructor(options = {}) {
        this.history = [];
        this.smoothedVal = null;
        this.catchupRef = null;
        this.catchupCount = 0;
        this.lastDisplay = null;
        this.minBpm = options.minBpm ?? 40;
        this.maxBpm = options.maxBpm ?? 180;
        this.medianWindow = Math.max(1, options.medianWindow ?? 24);
        this.emaAlpha = options.emaAlpha ?? 0.12;
        this.jumpThresholdBpm = options.jumpThresholdBpm ?? 30;
        this.catchupFrames = Math.max(1, options.catchupFrames ?? 8);
        this.catchupToleranceBpm = options.catchupToleranceBpm ?? 12;
        this.holdMaxBpm = options.holdMaxBpm ?? 200;
    }
    get displayBpm() {
        return this.lastDisplay;
    }
    get smoothedBpm() {
        return this.smoothedVal == null ? null : Math.round(this.smoothedVal);
    }
    reset() {
        this.history = [];
        this.smoothedVal = null;
        this.catchupRef = null;
        this.catchupCount = 0;
        this.lastDisplay = null;
    }
    /**
     * Feed the resolved camera BPM for this cycle and get the value to display.
     * A rejected jump leaves the display unchanged; an adopted jump or a normal
     * cycle advances the median + EMA.
     */
    update(candidateBpm, ctx = {}) {
        if (!Number.isFinite(candidateBpm) ||
            candidateBpm <= this.minBpm ||
            candidateBpm >= this.maxBpm) {
            return {
                displayBpm: this.lastDisplay,
                smoothedBpm: this.smoothedBpm,
                rawBpm: null,
                status: "out_of_range",
            };
        }
        let status = "tracking";
        if (this.smoothedVal !== null &&
            Math.abs(candidateBpm - this.smoothedVal) > this.jumpThresholdBpm) {
            // Track a *steady* distant rate: consecutive cycles whose value is
            // self-consistent. A sustained, self-consistent rate is a real change,
            // not a transient artifact, so adopt it even without a reference lock.
            if (this.catchupRef != null &&
                Math.abs(candidateBpm - this.catchupRef) <= this.catchupToleranceBpm) {
                this.catchupCount++;
            }
            else {
                this.catchupCount = 1;
            }
            this.catchupRef = candidateBpm;
            const persistentCatchup = this.catchupCount >= this.catchupFrames;
            const allow = persistentCatchup ||
                shouldAllowDisplayJumpReset({
                    hasReferenceLock: ctx.hasReferenceLock,
                    bpmJumpCounter: ctx.bpmJumpCounter,
                    candidateBpm,
                    trackerBpm: ctx.trackerBpm,
                    trackerConfidence: ctx.trackerConfidence,
                });
            if (allow) {
                this.smoothedVal = candidateBpm; // reset smoothing to catch up
                this.catchupCount = 0;
                status = "jump_adopted";
            }
            else {
                return {
                    displayBpm: this.lastDisplay,
                    smoothedBpm: this.smoothedBpm,
                    rawBpm: Math.round(candidateBpm),
                    status: "jump_rejected",
                };
            }
        }
        // Once the display agrees with the live rate again, clear catch-up tracking.
        if (this.smoothedVal !== null &&
            Math.abs(candidateBpm - this.smoothedVal) <= this.jumpThresholdBpm) {
            this.catchupCount = 0;
            this.catchupRef = null;
        }
        this.history.push(candidateBpm);
        if (this.history.length > this.medianWindow)
            this.history.shift();
        const sorted = [...this.history].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        if (this.smoothedVal === null) {
            this.smoothedVal = median;
        }
        else {
            this.smoothedVal =
                this.smoothedVal * (1 - this.emaAlpha) + median * this.emaAlpha;
        }
        const finalSmoothed = Math.round(this.smoothedVal);
        this.lastDisplay = finalSmoothed;
        return {
            displayBpm: finalSmoothed,
            smoothedBpm: finalSmoothed,
            rawBpm: Math.round(candidateBpm),
            status,
        };
    }
    /**
     * Keep the readout live on a cycle the caller suppressed (no trusted BPM):
     * prefer the tracker estimate when plausible, otherwise hold the last shown
     * value. Does not touch the smoothed state.
     */
    hold(ctx = {}) {
        const t = ctx.trackerBpm;
        if (t != null && Number.isFinite(t) && t > this.minBpm && t < this.holdMaxBpm) {
            this.lastDisplay = Math.round(t);
        }
        return this.lastDisplay;
    }
}
