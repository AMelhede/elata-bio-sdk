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
export declare const PULSE_DISPLAY_MEDIAN_MS = 5000;
/**
 * A number stays live this long after the newest one, as Apple keeps a value current for its 5 s block. Measured on
 * recorded webcam captures against a finger reference: live for 2 s, a number on 39.3% of seconds, 92.3% within 5 bpm;
 * 5 s, 44.6% and 90.1%; 10 s, 51.1% and 86.8%. 5 s is the longest that keeps 90 of 100 numbers within 5 bpm.
 */
export declare const PULSE_DISPLAY_LIVE_MS = 5000;
/** With `follow`, how recent the number on screen must be to be followed from: 15 s, three refreshes of 5 s. */
export declare const PULSE_DISPLAY_FOLLOW_FRESH_MS = 15000;
/**
 * With `hystBpm`: a change smaller than hystBpm shows once the new number has differed from the one on screen in the
 * same direction for this long, so a steady heart does not flicker by 1 bpm and a slow true drift still reaches the screen.
 */
export declare const PULSE_DISPLAY_HYST_HOLD_MS = 3000;
/**
 * Up to this long after the last number the value is shown greyed as recent; after it, as the last reading with its age.
 * At rest a true heart rate (finger reference) stays within 5 bpm of itself for 10 s in 85% of cases and for 30 s in 67%,
 * so past 10 s it is a past reading, not the current rate.
 */
export declare const PULSE_DISPLAY_RECENT_MS = 10000;
/**
 * How often the number on screen may change, as Apple Heart Rate updates while it measures. Replayed on real-device
 * recordings (the 30 s recent stage): changes of the number per minute on a laptop 8.2 to 4.1 and a phone 8.9 to 4.2,
 * seconds with a number and error against typed watch readings unchanged; on recorded lab webcam sessions 6.79 to 6.88 bpm
 * against a finger. Off (0) unless set: `new PulseDisplay({ showEveryMs: PULSE_DISPLAY_SHOW_EVERY_MS })`.
 */
export declare const PULSE_DISPLAY_SHOW_EVERY_MS = 5000;
/**
 * The display settings the received phone, laptop and Mac recordings chose (2026-10-30 and 31): a number on screen
 * changes at most every 5 s (as Apple Heart Rate updates while it measures), stays greyed as recent for 30 s after the
 * newest (more seconds with a number at an unchanged error against watch readings), and moves 60% of the way to each
 * new median (fewer jumps over 5 bpm on every device, every watch reading still within the bar). An app passes it as
 * is: `new PulseDisplay(PULSE_DISPLAY_RECOMMENDED)`. The constructor's own defaults stay the plain behaviour.
 */
export declare const PULSE_DISPLAY_RECOMMENDED: Readonly<{
    recentMs: 30000;
    showEveryMs: 5000;
    follow: 0.6;
}>;
export type PulseDisplayView = {
    kind: "measuring";
} | {
    kind: "live";
    bpm: number;
} | {
    kind: "recent";
    bpm: number;
    agoS: number;
} | {
    kind: "last";
    bpm: number;
    agoS: number;
};
export declare class PulseDisplay {
    private numbers;
    private shown;
    private readonly recentMs;
    private readonly showEveryMs;
    private lastRefreshMs;
    private readonly follow;
    private readonly medianMs;
    private readonly hystBpm;
    /** With `hystBpm`: since when, and in which direction, the new number has differed by less than hystBpm, or null. */
    private hystPending;
    private last;
    /**
     * `recentMs`: how long a number stays on screen as recent after the newest, PULSE_DISPLAY_RECENT_MS by default. With
     * rule clearWindows the recent stage held 20 s on recorded lab webcam sessions at an error no higher than 10 s without
     * it, with more seconds on screen and fewer numbers on no-pulse copies.
     */
    /**
     * `follow`: at each refresh the shown number moves this share of the way from the number on screen to the new median
     * (1, the default, goes straight there). A smoothed number, as wearables show: with 0.6 on received recordings and a
     * public lab set with a finger sensor (2026-10-31) updates over 5 bpm fell from 23% to 10% on a Mac, 6% to 2% on laptops, 7% to 0% on
     * phones and 10.8% to 6.0% in the lab, every watch reference staying within the bar and lab within-bar 80.8% to 80.4%.
     * A number older than PULSE_DISPLAY_FOLLOW_FRESH_MS is not followed from: the median shows as it is.
     */
    /**
     * `medianMs`: the numbers within this long of the newest form the median, PULSE_DISPLAY_MEDIAN_MS by default; 0 shows
     * the newest number alone (for a check whose own tracker already smooths). `hystBpm`: at a refresh the number on
     * screen changes only when the new one differs from it by hystBpm or more, or has differed by less for
     * PULSE_DISPLAY_HYST_HOLD_MS in the same direction; 0, the default, is off. Both change nothing unless set.
     */
    constructor(options?: {
        recentMs?: number;
        showEveryMs?: number;
        follow?: number;
        medianMs?: number;
        hystBpm?: number;
    });
    /** One read of the check: the number it shows now (shownPulseBpm), or null when it shows none. */
    push(atMs: number, bpm: number | null): void;
    /**
     * `hystBpm`: the number a refresh puts on screen, given the one it would put there without the option. A smaller
     * change waits until it has held PULSE_DISPLAY_HYST_HOLD_MS in the same direction; a change of direction starts over.
     */
    private hysteresis;
    /**
     * The person's last reading from before this session (RppgSession.getLastReading), on the same clock as push and
     * view. Until this session shows a number of its own, the view is that reading with its age, as Apple's Heart Rate
     * app shows the latest reading and when it was taken while it measures. Null clears it.
     */
    setLast(last: {
        bpm: number;
        atMs: number;
    } | null): void;
    view(nowMs: number): PulseDisplayView;
    reset(): void;
}
//# sourceMappingURL=pulseDisplay.d.ts.map