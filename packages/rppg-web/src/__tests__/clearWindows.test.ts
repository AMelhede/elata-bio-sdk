import { CLEAR_MARGIN_DB, CLEAR_RUNNER_UP_BPM, lineMargin } from "../pulseCheckCore";
import { buildingRate, resolvePulseCheckRules } from "../pulseCheck";
import { PULSE_DISPLAY_RECENT_MS, PulseDisplay } from "../pulseDisplay";

// Rule clearWindows: the building number counts only windows that clearly pick one rate.

function spectrum(peaks: [number, number][]): [number, number][] {
	// 0.5 to 3.5 Hz in 1/60 Hz steps, a flat floor of 1 and the given (bpm, power) peaks.
	const P: [number, number][] = [];
	for (let k = 30; k <= 210; k++) P.push([k / 60, 1]);
	for (const [bpm, p] of peaks) P[Math.round(bpm) - 30][1] = p;
	return P;
}

describe("lineMargin", () => {
	it("is the line's power over the strongest other peak 15 bpm or more away, in dB", () => {
		expect(lineMargin(spectrum([[100, 10], [62, 5]]), 100)).toBeCloseTo(10 * Math.log10(2), 6);
	});
	it("ignores a peak nearer than 15 bpm (the same rate's shoulder)", () => {
		expect(lineMargin(spectrum([[100, 10], [100 - CLEAR_RUNNER_UP_BPM + 1, 9], [62, 2]]), 100)).toBeCloseTo(10 * Math.log10(5), 6);
	});
	it("is infinite with no other peak in the band", () => {
		expect(lineMargin(spectrum([[100, 10]]).map(([f, p]) => [f, f * 60 === 100 ? p : 1 + f]) as [number, number][], 100)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("buildingRate with clearWindows", () => {
	const v = { verdict: "not-measured", streak: 5, streakBpm: 62, streakSnrDb: -2, clearStreak: 1, clearBpm: 62, clearSnrDb: -2 };
	it("shows nothing when too few of the streak's windows are clear", () => {
		expect(buildingRate(v, false, 4, false)).toBe(62);
		expect(buildingRate(v, false, 4, true)).toBeNull();
	});
	it("shows the clear windows' own rate once enough of them agree", () => {
		expect(buildingRate({ ...v, clearStreak: 4, clearBpm: 101.5, clearSnrDb: -1 }, false, 4, true)).toBe(101.5);
	});
	it("is on unless set to false, with the 3 dB margin", () => {
		expect(resolvePulseCheckRules().clearWindows).toBe(true);
		expect(CLEAR_MARGIN_DB).toBe(3);
	});
});

describe("PulseDisplay recentMs", () => {
	it("keeps a number as recent for recentMs, the default unchanged", () => {
		const a = new PulseDisplay();
		const b = new PulseDisplay({ recentMs: 20_000 });
		a.push(0, 80);
		b.push(0, 80);
		expect(a.view(PULSE_DISPLAY_RECENT_MS + 1000).kind).toBe("last");
		expect(b.view(15_000).kind).toBe("recent");
		expect(b.view(21_000).kind).toBe("last");
	});
});

import { SHORT_BUILDING_STREAK, buildingStreak } from "../pulseCheck";

describe("rule shortStreak", () => {
	it("asks the building number for 2 windows, whatever else is on, and is off unless set", () => {
		expect(SHORT_BUILDING_STREAK).toBe(2);
		expect(buildingStreak(resolvePulseCheckRules({ coherentFusion: true, shortStreak: true }))).toBe(2);
		expect(buildingStreak(resolvePulseCheckRules({ foreheadPool: true, shortStreak: true }))).toBe(2);
		expect(buildingStreak(resolvePulseCheckRules({ coherentFusion: true }))).toBe(3);
		expect(resolvePulseCheckRules().shortStreak).toBe(false);
	});
});
