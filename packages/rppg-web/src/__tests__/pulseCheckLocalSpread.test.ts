import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";
import { coherentSpectrum, overLocalSpread, LOCAL_SPREAD_FLOOR } from "../pulseCheckCore";

// A fixed pseudo-random source, so the known answer is the same on every run.
function noise(seed: number) {
	let s = seed >>> 0;
	const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), (s + 0.5) / 4294967296);
	return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
// 16 s at 20 Hz (the coherent line's own rate): a weak 72 bpm pulse under white noise, the same on every one of 12
// lines apart from each line's own noise. With `burst`, seconds 6 to 9 carry 4 times the shared noise (a head turn:
// the added noise is shared by the whole face and roughly white, evsave TRIED gap-movement and ML4).
function lines(burst: boolean, pulse = 0.25, seed = 7) {
	const n = 320, g = noise(seed);
	const shared = Array.from({ length: n }, (_, k) => g() * (burst && k >= 120 && k < 180 ? 4 : 1));
	return Array.from({ length: 12 }, () =>
		Array.from({ length: n }, (_, k) => pulse * Math.sin((2 * Math.PI * 1.2 * k) / 20) + shared[k] + 0.5 * g()),
	);
}
// The line at 72 bpm against the median of the band (0.7 to 3 Hz), in dB.
function over(spec: Array<[number, number]>) {
	const band = spec.filter(([f]) => f >= 0.7 && f <= 3).map(([, p]) => p).sort((a, b) => a - b);
	const at = Math.max(...spec.filter(([f]) => Math.abs(f - 1.2) <= 0.07).map(([, p]) => p));
	return 10 * Math.log10(at / band[band.length >> 1]);
}

describe("rule localSpread", () => {
	it("is off unless true, and is a named rule", () => {
		expect(resolvePulseCheckRules().localSpread).toBe(false);
		expect(resolvePulseCheckRules({ localSpread: true }).localSpread).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("localSpread");
	});
	it("a burst of noise inside the window costs less of the pulse's line with the rule than without", () => {
		let gain = 0;
		for (let seed = 1; seed <= 12; seed++) {
			const x = lines(true, 0.25, seed);
			gain += over(coherentSpectrum(x, true)) - over(coherentSpectrum(x, false));
		}
		expect(gain / 12).toBeGreaterThan(2);
	});
	it("a steady window reads the same line with the rule", () => {
		let diff = 0;
		for (let seed = 1; seed <= 12; seed++) {
			const x = lines(false, 0.25, seed);
			diff += over(coherentSpectrum(x, true)) - over(coherentSpectrum(x, false));
		}
		expect(Math.abs(diff / 12)).toBeLessThan(0.5);
	});
	// Noise alone. A burst makes the plain spectrum the burst's own (3 s of it: few independent bins, so a low strongest
	// line); the rule makes the window even again, so its strongest line is that of an even window of noise, never more.
	it("noise alone gains no line: with the rule a burst window's strongest line is no higher than an even window's", () => {
		const top = (spec: Array<[number, number]>) => {
			const band = spec.filter(([f]) => f >= 0.7 && f <= 3).map(([, p]) => p);
			const sorted = [...band].sort((a, b) => a - b);
			return 10 * Math.log10(Math.max(...band) / sorted[sorted.length >> 1]);
		};
		let diff = 0, same = 0;
		for (let seed = 1; seed <= 24; seed++) {
			diff += top(coherentSpectrum(lines(true, 0, seed), true)) - top(coherentSpectrum(lines(false, 0, seed), false));
			same += top(coherentSpectrum(lines(false, 0, seed), true)) - top(coherentSpectrum(lines(false, 0, seed), false));
		}
		expect(diff / 24).toBeLessThan(0.5);
		expect(Math.abs(same / 24)).toBeLessThan(0.5);
	});
	it("a silent stretch is not blown up: the divisor never falls under its floor", () => {
		const x = Array.from({ length: 320 }, (_, k) => (k >= 100 && k < 200 ? 0 : Math.sin((2 * Math.PI * 1.2 * k) / 20)));
		const y = overLocalSpread(x);
		expect(Math.max(...y.map(Math.abs))).toBeLessThan(1 / LOCAL_SPREAD_FLOOR);
		expect(overLocalSpread(new Array(320).fill(0))).toEqual(new Array(320).fill(0));
	});
});
