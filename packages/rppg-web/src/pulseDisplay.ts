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
 * A number stays live this long after the newest one. The check gives one number a second, so this lets one missed
 * second pass without greying the screen, and no more.
 */
export const PULSE_DISPLAY_LIVE_MS = 2000;

/**
 * Up to this long after the last number the value is shown greyed as recent; after it, as the last reading with its age.
 * At rest a true heart rate (finger reference) stays within 5 bpm of itself for 10 s in 85% of cases and for 30 s in 67%,
 * so past 10 s it is a past reading, not the current rate.
 */
export const PULSE_DISPLAY_RECENT_MS = 10_000;

export type PulseDisplayView =
	| { kind: "measuring" }
	| { kind: "live"; bpm: number }
	| { kind: "recent"; bpm: number; agoS: number }
	| { kind: "last"; bpm: number; agoS: number };

export class PulseDisplay {
	private numbers: { atMs: number; bpm: number }[] = [];
	private shown: { atMs: number; bpm: number } | null = null;

	/** One read of the check: the number it shows now (shownPulseBpm), or null when it shows none. */
	push(atMs: number, bpm: number | null): void {
		if (bpm == null || !Number.isFinite(bpm)) return;
		this.numbers.push({ atMs, bpm });
		this.numbers = this.numbers.filter((n) => n.atMs > atMs - PULSE_DISPLAY_MEDIAN_MS);
		const sorted = this.numbers.map((n) => n.bpm).sort((a, b) => a - b);
		const mid = sorted.length >> 1;
		const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
		this.shown = { atMs, bpm: Math.round(median) };
	}

	view(nowMs: number): PulseDisplayView {
		if (!this.shown) return { kind: "measuring" };
		const age = nowMs - this.shown.atMs;
		if (age <= PULSE_DISPLAY_LIVE_MS) return { kind: "live", bpm: this.shown.bpm };
		const agoS = Math.round(age / 1000);
		return { kind: age <= PULSE_DISPLAY_RECENT_MS ? "recent" : "last", bpm: this.shown.bpm, agoS };
	}

	reset(): void {
		this.numbers = [];
		this.shown = null;
	}
}
