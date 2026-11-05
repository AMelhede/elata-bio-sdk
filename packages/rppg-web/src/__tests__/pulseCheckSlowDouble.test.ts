import { estimateOwnPulse, SLOW_DOUBLE_HZ, type RawRoiSample } from "../pulseCheckCore";
import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// Three regions at 30 fps. A heart at `bpm` whose waveform is a fundamental plus a second harmonic of `harm` times its
// size (a pulse is not a sine: Allen 2007, Physiol Meas 28:R1). Under the band the fundamental is out of reach, so the
// band sees the harmonic, at twice the heart's rate.
function capture(bpm: number, harm: number) {
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
	const rows: RawRoiSample[] = [];
	for (let t = 0; t <= 20000; t += 1000 / 30) {
		const w = (2 * Math.PI * bpm * t) / 60000;
		const p = 0.006 * (Math.sin(w) + harm * Math.sin(2 * w));
		const region = () => [150 * (1 - 0.3 * p) + noise(), 110 * (1 - p) + noise(), 90 * (1 - 0.6 * p) + noise()];
		rows.push([t, ...region(), ...region(), ...region(), 180, 175, 170] as unknown as RawRoiSample);
	}
	return rows;
}
const at = (rows: RawRoiSample[], rule: boolean) =>
	estimateOwnPulse(rows, 16, rows[rows.length - 1][0], undefined, undefined, false, true, rule)?.bpm ?? null;

describe("rule slowDouble", () => {
	it("is on unless false, and is a named rule", () => {
		expect(resolvePulseCheckRules().slowDouble).toBe(true);
		expect(resolvePulseCheckRules({ slowDouble: false }).slowDouble).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("slowDouble");
		expect(SLOW_DOUBLE_HZ).toEqual([0.5, 0.78]);
	});
	it("off: a 38 bpm heart reads as its double", () => {
		const bpm = at(capture(38, 0.4), false);
		expect(bpm).not.toBeNull();
		expect(Math.abs((bpm as number) - 76)).toBeLessThan(6);
	});
	it("on: the double is withheld", () => {
		expect(at(capture(38, 0.4), true)).toBeNull();
	});
	it("on: a 70 bpm heart is read as before", () => {
		expect(Math.abs((at(capture(70, 0.3), true) as number) - 70)).toBeLessThan(4);
	});
	it("on: a 48 bpm heart, whose rate the band reads, is read as before", () => {
		expect(Math.abs((at(capture(48, 0.3), true) as number) - 48)).toBeLessThan(6);
	});
});
