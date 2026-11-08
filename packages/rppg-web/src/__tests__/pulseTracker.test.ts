// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => any;
import { PulseTracker, TRACKER_LO_BPM, TRACKER_HI_BPM } from "../pulseTracker";

// Seeded noise: exponential power per bin (a chi-square with 2 degrees of freedom, as a periodogram bin of noise).
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
const grid: number[] = [];
for (let b = 42; b <= 240; b++) grid.push(b);
function spectrum(r: () => number, lines: Array<[number, number]> = [], slope = 0): Array<[number, number]> {
	return grid.map((b) => {
		let p = -Math.log(1 - r()) * (1 + slope * Math.max(0, (90 - b) / 48) ** 2);
		for (const [at, h] of lines) p += h * Math.exp(-0.5 * ((b - at) / 2.5) ** 2);
		return [b, p] as [number, number];
	});
}
function run(T: PulseTracker, from: number, to: number, make: (t: number) => Array<[number, number]>) {
	const out: Array<{ t: number; shown: boolean; bpm: number; mass: number }> = [];
	for (let t = from; t < to; t++) out.push({ t, ...T.step(t * 1000, make(t)) });
	return out;
}

describe("PulseTracker (rule tracker)", () => {
	it("covers the band it says it does", () => {
		const T = new PulseTracker();
		expect(T.rates[0]).toBe(TRACKER_LO_BPM);
		expect(T.rates[T.rates.length - 1]).toBe(TRACKER_HI_BPM);
	});

	it("shows nothing on noise alone, over 10 minutes", () => {
		const r = rng(1);
		const out = run(new PulseTracker(), 16, 616, () => spectrum(r));
		expect(out.filter((o) => o.shown).length).toBe(0);
	});

	it("shows nothing on slow drift without a line (whitening: the general form of driftLine)", () => {
		const r = rng(2);
		const out = run(new PulseTracker(), 16, 316, () => spectrum(r, [], 8));
		expect(out.filter((o) => o.shown).length).toBe(0);
	});

	it("shows a steady pulse within seconds and within 2 bpm", () => {
		const r = rng(3);
		const out = run(new PulseTracker(), 16, 76, () => spectrum(r, [[72, 8]]));
		const first = out.find((o) => o.shown);
		expect(first).toBeDefined();
		// Full windows only from 16 s here (the page's growing window from 6 s is tested in the pulse check itself).
		expect(first!.t).toBeLessThanOrEqual(40);
		const shown = out.filter((o) => o.shown);
		expect(shown.length).toBeGreaterThan(30); // measured: first at 37 s, then every second (39 of 60)
		for (const o of shown) expect(Math.abs(o.bpm - 72)).toBeLessThan(2);
	});

	it("never shows the half rate after a real rate (acceptance case 1, half-rate first number, synthetic)", () => {
		// The workout file's pattern: the real rate (128) for 20 s, then 12 s where a half-rate line (64) is the strongest
		// with the real rate weaker beside it, then the real rate again. A heart does not fall 64 bpm in a second.
		const r = rng(4);
		const out = run(new PulseTracker(), 16, 76, (t) =>
			t >= 36 && t < 48 ? spectrum(r, [[64, 10], [128, 5]]) : spectrum(r, [[128, 8]]),
		);
		const shown = out.filter((o) => o.shown);
		expect(shown.length).toBeGreaterThan(20);
		for (const o of shown) expect(Math.abs(o.bpm - 128)).toBeLessThan(12.8);
	});

	it("follows a heart that slows by 1 bpm a second (after exercise)", () => {
		const r = rng(5);
		const out = run(new PulseTracker(), 16, 106, (t) => spectrum(r, [[150 - (t - 16), 8]]));
		const late = out.filter((o) => o.shown && o.t > 30);
		// Measured with the chosen setting: first number at 62 s, 39 s shown (a moving rate keeps the posterior spread
		// over neighbouring rates, so the mass in the bar builds slowly). Accuracy is the guard; coverage must not fall.
		expect(late.length).toBeGreaterThan(30);
		for (const o of late) expect(Math.abs(o.bpm - (150 - (o.t - 16)))).toBeLessThan(5);
	});

	it("withholds a rate the wall carries (suppressBpm)", () => {
		const r = rng(6);
		const T = new PulseTracker();
		let shownAt72 = 0;
		for (let t = 16; t < 76; t++) {
			const s = T.step(t * 1000, spectrum(r, [[72, 8]]), { suppressBpm: [72] });
			if (s.shown && Math.abs(s.bpm - 72) < 7.2) shownAt72++;
		}
		expect(shownAt72).toBe(0);
	});

	it("learns nothing from a window marked as no evidence (a held picture)", () => {
		const r = rng(7);
		const T = new PulseTracker();
		let shown = 0;
		for (let t = 16; t < 76; t++) if (T.step(t * 1000, spectrum(r, [[72, 8]]), { none: true }).shown) shown++;
		expect(shown).toBe(0);
	});

	it("caps the band at the frame rate's ceiling (capBpm)", () => {
		const r = rng(8);
		const T = new PulseTracker();
		let high = 0;
		for (let t = 16; t < 76; t++) {
			const s = T.step(t * 1000, spectrum(r, [[150, 8]]), { capBpm: 120 });
			if (s.shown && s.bpm > 120) high++;
		}
		expect(high).toBe(0);
	});

	it.each(["a", "b"])("matches the Python screen it was tuned with (parity fixture %s)", (name) => {
		const fx = name === "a" ? require("./fixtures/tracker-parity-a.json") : require("./fixtures/tracker-parity-b.json");
		const p = fx.params;
		const T = new PulseTracker({ tau: p.tau, sigma: p.sigma, qOn: p.q_on, qOff: p.q_off, harmonic: p.w2, whitenBpm: p.wh, show: 0.4 });
		fx.expected.forEach(([t, mass, bpm, pPulse]: number[], i: number) => {
			const rows = (fx.grid as number[]).map((b, k) => [b, fx.spectra[i][k]] as [number, number]);
			const s = T.step(t * 1000, rows);
			expect(s.mass).toBeCloseTo(mass, 6);
			expect(s.pPulse).toBeCloseTo(pPulse, 6);
			if (mass > 1e-6) expect(s.bpm).toBeCloseTo(bpm, 4);
		});
	});
});
