// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
import { PulseTracker, slowHeartHarmonics, TRACKER_INTERHARMONIC_K } from "../pulseTracker";

// The band the check hands the tracker: 42 to 180 bpm (OWN_PULSE_BAND_HZ 0.7 to 3.0 Hz), 1 bpm apart.
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function spectrum(r: () => number, lines: Array<[number, number]>): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let b = 42; b <= 180; b++) {
		let p = -Math.log(1 - r());
		for (const [at, h] of lines) p += h * Math.exp(-0.5 * ((b - at) / 2.5) ** 2);
		out.push([b, p]);
	}
	return out;
}
const shownShare = (T: PulseTracker, make: () => Array<[number, number]>) => {
	let n = 0;
	for (let t = 0; t < 60; t++) if (T.step(t * 1000, make()).shown) n++;
	return n / 60;
};

describe("TRACKER_INTERHARMONIC_K: a heart under 42 is not shown as its harmonic", () => {
	test("on by default", () => expect(TRACKER_INTERHARMONIC_K).toBeGreaterThan(0));

	test("a 35 bpm heart's 2nd and 3rd harmonics (70 and 105) are withheld; off, 70 shows", () => {
		const slow = (seed: number) => { const r = rng(seed); return () => spectrum(r, [[70, 40], [105, 25]]); };
		expect(shownShare(new PulseTracker({ interHarmonicK: 0 }), slow(1))).toBeGreaterThan(0.5);
		expect(shownShare(new PulseTracker(), slow(1))).toBeLessThan(0.05);
	});

	test("a 35 bpm heart read as its 3rd harmonic (105, with 70 and 140) is withheld", () => {
		const r = rng(2);
		const third = () => spectrum(r, [[105, 40], [70, 25], [140, 25]]);
		expect(new PulseTracker({ interHarmonicK: 0 }).step(0, third()).mass).toBeGreaterThan(0);
		expect(slowHeartHarmonics(third(), 105, TRACKER_INTERHARMONIC_K)).toBe(true);
	});

	test("a real 70 bpm heart with its own harmonic at 140 still shows", () => {
		const r = rng(3);
		expect(shownShare(new PulseTracker(), () => spectrum(r, [[70, 40], [140, 15]]))).toBeGreaterThan(0.5);
	});

	test("a real 90 bpm heart (f0 / 2 = 45 is not slow) is never judged", () => {
		const r = rng(4);
		expect(slowHeartHarmonics(spectrum(r, [[90, 40], [135, 15]]), 90, TRACKER_INTERHARMONIC_K)).toBe(false);
	});
});
