import { advanceLineTrack, type LineTrack, PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules, trackedLine } from "../pulseCheck";

// A whitened band from 42 to 180 bpm in 3.75 bpm bins: a floor of 1 and lines of given heights.
const bins = Array.from({ length: 37 }, (_, i) => 42 + 3.75 * i);
const band = (lines: Array<[number, number]>) =>
	bins.map((b) => [b, 1 + lines.reduce((s, [at, h]) => s + h * Math.exp(-(((b - at) / 2.5) ** 2)), 0)] as [number, number]);
const strongest = (bd: Array<[number, number]>) => bd.reduce((a, x) => (x[1] > a[1] ? x : a))[0];
function run(windows: Array<Array<[number, number]>>): number[] {
	let tr: LineTrack | null = null;
	return windows.map((bd, i) => {
		tr = advanceLineTrack(tr, bd, i * 1000);
		return trackedLine(tr, bd).bpm;
	});
}

describe("rule trackLine", () => {
	it("is off unless true, and is a named rule", () => {
		expect(resolvePulseCheckRules().trackLine).toBe(false);
		expect(resolvePulseCheckRules({ trackLine: true }).trackLine).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("trackLine");
	});
	it("a window where a spurious 50 bpm line is strongest: the window alone reads 50, the track stays on 72", () => {
		const w = [...Array(12).fill(band([[72, 6]])), band([[72, 3], [50, 9]])];
		expect(Math.abs(strongest(w[12]) - 50)).toBeLessThan(2.5);
		expect(Math.abs(run(w)[12] - 72)).toBeLessThan(2.5);
	});
	it("favours no rate: a heart at 45 and one at 170 are tracked where they are", () => {
		for (const hr of [45, 170]) expect(Math.abs(run(Array(10).fill(band([[hr, 6]])))[9] - hr)).toBeLessThan(2.5);
	});
	it("follows a heart that changes 1 bpm a second (recovering after exercise)", () => {
		const w = Array.from({ length: 40 }, (_, i) => band([[120 - i, 6]]));
		const out = run(w);
		expect(Math.abs(out[39] - 81)).toBeLessThan(4);
	});
	it("a line that stays strongest for good is taken over within a few windows", () => {
		const w = [...Array(10).fill(band([[72, 6]])), ...Array(10).fill(band([[96, 12], [72, 1]]))];
		expect(Math.abs(run(w)[19] - 96)).toBeLessThan(2.5);
	});
	it("a gap longer than TRACK_RESET_MS starts again from the window", () => {
		let tr = advanceLineTrack(null, band([[72, 6]]), 0);
		tr = advanceLineTrack(tr, band([[110, 6]]), 10_000);
		expect(Math.abs(trackedLine(tr, band([[110, 6]])).bpm - 110)).toBeLessThan(2.5);
	});
});
