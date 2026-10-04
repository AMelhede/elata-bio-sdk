import { PulseCheck } from "../pulseCheck";
import { type OwnPulseEstimate, ownPulseVerdict } from "../pulseCheckCore";

// Two rules measured on 19 held-out MCD-rPPG people (never used for tuning), where the check was right
// 89.7% of shown seconds against 99.1% on the recordings it was tuned on.

/** Seconds a number is shown from `fromS` to `toS`, for a pulse at 72 bpm that stops at `stopS`
 * (skin colour then carries sensor noise only), 30 fps, three regions. */
function shownAfterStop(stopS: number, fromS: number, toS: number) {
	const check = new PulseCheck();
	let seed = 7;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	let shown = 0;
	let next = fromS;
	const dt = 1 / 30;
	for (let t = 0; t <= toS; t += dt) {
		const p = t < stopS ? 0.01 * Math.sin(2 * Math.PI * (72 / 60) * t) : 0;
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t * 1000, [region(), region(), region()]);
		if (t >= next) {
			if (check.getState().bpm != null) shown++;
			next += 1;
		}
	}
	return shown;
}

describe("PulseCheck shows a number only while fresh evidence backs it", () => {
	it("stops showing once the newest 8 s no longer carry the pulse", () => {
		// The proven rate averages 8+ windows of 16 s, so it still holds well after the pulse has gone
		// from the newest seconds: before this rule the number stayed on screen until 14 s after the stop.
		expect(shownAfterStop(40, 30, 40)).toBeGreaterThanOrEqual(9);
		expect(shownAfterStop(40, 48, 53)).toBe(0);
	});

});

describe("a window near the bottom of the band needs a clearer signal", () => {
	const est = (bpm: number, snrDb: number): OwnPulseEstimate =>
		({ bpm, bpmFine: bpm, snrDb, agreeing: [0, 1, 2] }) as unknown as OwnPulseEstimate;
	it("does not prove 48 bpm from windows under 0 dB", () => {
		expect(ownPulseVerdict(Array.from({ length: 10 }, () => est(48, -1))).verdict).not.toBe("measured");
	});
	it("still proves 48 bpm from clear windows, and 60 bpm at the usual bar", () => {
		expect(ownPulseVerdict(Array.from({ length: 10 }, () => est(48, 1))).verdict).toBe("measured");
		expect(ownPulseVerdict(Array.from({ length: 10 }, () => est(60, -1))).verdict).toBe("measured");
	});
});
