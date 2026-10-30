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
	it("asks the building number for 2 windows, whatever else is on, and is on unless set to false", () => {
		expect(SHORT_BUILDING_STREAK).toBe(2);
		expect(buildingStreak(resolvePulseCheckRules({ coherentFusion: true, shortStreak: true }))).toBe(2);
		expect(buildingStreak(resolvePulseCheckRules({ foreheadPool: true, shortStreak: true }))).toBe(2);
		expect(buildingStreak(resolvePulseCheckRules({ coherentFusion: true, shortStreak: false }))).toBe(3);
		expect(resolvePulseCheckRules().shortStreak).toBe(true);
	});
});

import { countingStreak } from "../pulseCheck";

describe("countingStreak", () => {
	it("is the clear windows' run under clearWindows, so progress cannot run ahead of the number", () => {
		const v = { streak: 5, clearStreak: 1 };
		expect(countingStreak(v, { clearWindows: true })).toBe(1);
		expect(countingStreak(v, { clearWindows: false })).toBe(5);
		expect(countingStreak({ streak: 3 }, { clearWindows: true })).toBe(3);
	});
});

import { STEADY_LIGHT_MAX_STEPS, steadyLightAllows } from "../pulseCheck";

describe("rule steadyLight", () => {
	it("holds the building number while its window has 3 or more light steps, on unless false", () => {
		expect(STEADY_LIGHT_MAX_STEPS).toBe(3);
		const on = resolvePulseCheckRules();
		expect(on.steadyLight).toBe(true);
		expect(steadyLightAllows(2, on)).toBe(true);
		expect(steadyLightAllows(3, on)).toBe(false);
		expect(steadyLightAllows(null, on)).toBe(true);
		expect(steadyLightAllows(8, resolvePulseCheckRules({ steadyLight: false }))).toBe(true);
	});
});

import { PULSE_DISPLAY_SHOW_EVERY_MS } from "../pulseDisplay";

describe("PulseDisplay showEveryMs", () => {
	it("changes the number at most every 5 s, its age following the newest number; off by default", () => {
		expect(PULSE_DISPLAY_SHOW_EVERY_MS).toBe(5000);
		const d = new PulseDisplay({ showEveryMs: PULSE_DISPLAY_SHOW_EVERY_MS });
		d.push(0, 70);
		d.push(1000, 74);
		expect(d.view(1000)).toEqual({ kind: "live", bpm: 70 });
		d.push(5000, 75);
		expect(d.view(5000)).toEqual({ kind: "live", bpm: 75 });
		expect(d.view(12000)).toEqual({ kind: "recent", bpm: 75, agoS: 7 });
		const plain = new PulseDisplay();
		plain.push(0, 70);
		plain.push(1000, 74);
		expect(plain.view(1000)).toEqual({ kind: "live", bpm: 72 });
	});
});

import { pulseProgress } from "../pulseCheck";

describe("pulseProgress", () => {
	const rules = resolvePulseCheckRules({ moreReadings: true, shortStreak: true });
	const base = { verdict: "not-measured" as const, bpm: null, snrDb: null, streak: 0, wallMatch: false };
	it("fills with the first window, then with the counting streak, both ways; 1 with a number", () => {
		expect(pulseProgress({ ...base, collecting: true, windowFill: 0.5 }, rules)).toBe(0.25);
		expect(pulseProgress({ ...base, collecting: false, countingStreak: 0, streak: 4 }, rules)).toBe(0.5);
		expect(pulseProgress({ ...base, collecting: false, countingStreak: 1 }, rules)).toBe(0.75);
		expect(pulseProgress({ ...base, collecting: false, countingStreak: 2 }, rules)).toBe(0.95);
		expect(pulseProgress({ ...base, collecting: false, buildingBpm: 70 }, rules)).toBe(1);
	});
});
