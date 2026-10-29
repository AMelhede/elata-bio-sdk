/**
 * What the screen shows from the pulse check's shown numbers, so every app shows the same thing.
 *
 * The structure is Apple's: one number, accuracy chosen over availability, and the latest reading kept on screen with
 * its age when no fresh one comes (Apple, Heart rate, calorimetry and activity on Apple Watch, November 2024; other
 * wearables show the latest value the same way). Where it differs from Apple, it differs on our own measurement: Apple
 * shows the best reading of each 5 s block, and on this check's numbers that shows a value up to 10 s old, which was
 * right (within 5 bpm of a finger reference) 86.1% of the time on recorded webcam captures against 92.3% for the median
 * of the last 5 s updated every second. That median kept the accuracy of the newest number and jumped 3 bpm or more 1.6
 * times a minute, against 2.6 for Apple's block and 7.7 for the raw newest number.
 *
 * Changes no reading: it only decides which of the check's numbers is on screen and how it is labelled.
 */
/** Numbers within this long of the newest one form the median on screen (measured above). */
export const PULSE_DISPLAY_MEDIAN_MS = 5000;
/**
 * A number stays live this long after the newest one, as Apple keeps a value current for its 5 s block. Measured on
 * recorded webcam captures against a finger reference: live for 2 s, a number on 39.3% of seconds, 92.3% within 5 bpm;
 * 5 s, 44.6% and 90.1%; 10 s, 51.1% and 86.8%. 5 s is the longest that keeps 90 of 100 numbers within 5 bpm.
 */
export const PULSE_DISPLAY_LIVE_MS = 5000;
/**
 * Up to this long after the last number the value is shown greyed as recent; after it, as the last reading with its age.
 * At rest a true heart rate (finger reference) stays within 5 bpm of itself for 10 s in 85% of cases and for 30 s in 67%,
 * so past 10 s it is a past reading, not the current rate.
 */
export const PULSE_DISPLAY_RECENT_MS = 10000;
export class PulseDisplay {
    constructor() {
        this.numbers = [];
        this.shown = null;
    }
    /** One read of the check: the number it shows now (shownPulseBpm), or null when it shows none. */
    push(atMs, bpm) {
        if (bpm == null || !Number.isFinite(bpm))
            return;
        this.numbers.push({ atMs, bpm });
        this.numbers = this.numbers.filter((n) => n.atMs > atMs - PULSE_DISPLAY_MEDIAN_MS);
        const sorted = this.numbers.map((n) => n.bpm).sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        this.shown = { atMs, bpm: Math.round(median) };
    }
    view(nowMs) {
        if (!this.shown)
            return { kind: "measuring" };
        const age = nowMs - this.shown.atMs;
        if (age <= PULSE_DISPLAY_LIVE_MS)
            return { kind: "live", bpm: this.shown.bpm };
        const agoS = Math.round(age / 1000);
        return { kind: age <= PULSE_DISPLAY_RECENT_MS ? "recent" : "last", bpm: this.shown.bpm, agoS };
    }
    reset() {
        this.numbers = [];
        this.shown = null;
    }
}
