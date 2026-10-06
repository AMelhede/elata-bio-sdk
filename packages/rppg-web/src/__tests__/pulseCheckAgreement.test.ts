import { agreementRate, AGREE_SECONDS } from "../pulseCheckCore";

// The second way to a number: the SDK's own (fixed) rate and the check's own window rate, two
// different estimators on the same face, agree within 3 bpm for 8 seconds running, the window
// line at least -4 dB, the rate at least 58 bpm. Measured on five sets (MCD-rPPG three cameras and
// side-camera re-records, UBFC-rPPG 42 people): +4 recordings with a number, +93 right seconds,
// 0 wrong; no number on any no-pulse video.

const second = (sdk: number | null, win: number | null, winSnr: number | null) => ({ sdk, win, winSnr });
const run = (n: number, s = second(80, 81, -3.5)) => Array.from({ length: n }, () => s);

describe("agreementRate", () => {
	it("gives the SDK's rate after 8 agreeing seconds", () => {
		expect(AGREE_SECONDS).toBe(8);
		expect(agreementRate(run(8))).toBe(80);
	});
	it("gives nothing after 7", () => {
		expect(agreementRate(run(7))).toBeNull();
	});
	it("needs every one of the last 8 seconds to agree", () => {
		expect(agreementRate([...run(7), second(80, 90, -3.5), second(80, 81, -3.5)])).toBeNull();
	});
	it("needs the two within 3 bpm", () => {
		expect(agreementRate(run(8, second(80, 83, -3.5)))).toBe(80);
		expect(agreementRate(run(8, second(80, 83.5, -3.5)))).toBeNull();
	});
	it("needs the window line at -4 dB or stronger", () => {
		expect(agreementRate(run(8, second(80, 81, -4.1)))).toBeNull();
	});
	it("never gives a rate under 58 bpm (the low line both estimators can share)", () => {
		expect(agreementRate(run(8, second(55, 55.5, -2)))).toBeNull();
	});
	it("gives nothing when either estimator has no rate", () => {
		expect(agreementRate(run(8, second(null, 81, -2)))).toBeNull();
		expect(agreementRate(run(8, second(80, null, null)))).toBeNull();
	});
});

import { PulseCheck } from "../pulseCheck";

/** A pulse at 75 in the forehead only, noise in both cheeks: the check's own streak needs two
 * regions agreeing, so it cannot prove this; the window line still reads 75. */
function oneRegion(check: PulseCheck, opinion: number | null) {
	let seed = 3;
	const n = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.8;
	const states = [];
	let next = 20000;
	for (let t = 0; t <= 60000; t += 1000 / 30) {
		const p = 0.004 * Math.sin((2 * Math.PI * 75 * t) / 60000);
		const pulse = { r: 150 * (1 - 0.3 * p) + n(), g: 120 * (1 - p) + n(), b: 100 * (1 - 0.6 * p) + n() };
		const flat = () => ({ r: 150 + n(), g: 120 + n(), b: 100 + n() });
		check.push(t, [pulse, flat(), flat()]);
		if (t >= next) {
			check.secondOpinion(opinion);
			states.push(check.getState());
			next += 1000;
		}
	}
	return states;
}

describe("PulseCheck with agreement on", () => {
	it("shows the rate when the SDK agrees with the window, and says so", () => {
		const shown = oneRegion(new PulseCheck({ agreement: true }), 75).filter((s) => s.verdict === "measured");
		expect(shown.length).toBeGreaterThan(20);
		expect(shown.every((s) => s.via === "agreement" && Math.abs(s.bpm! - 75) < 1)).toBe(true);
	});
	it("shows nothing when the SDK disagrees", () => {
		expect(oneRegion(new PulseCheck({ agreement: true }), 95).some((s) => s.verdict === "measured")).toBe(false);
	});
	it("shows nothing with agreement off (the default), whatever the SDK says", () => {
		expect(oneRegion(new PulseCheck(), 75).some((s) => s.verdict === "measured")).toBe(false);
	});
});
