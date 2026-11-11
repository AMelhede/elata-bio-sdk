import { PulseTracker, TRACKER_PRIOR_SHOW, TRACKER_START_LOOKS } from "../pulseTracker";
import { PulseCheck, shownPulseBpm } from "../pulseCheck";

// Rule startEvidence: the growing window judged alone against the prior (evsave TRIED FB3, 2026-11-11).
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
/** Noise of mean 1 per rate, plus lines [bpm, height over the floor]. */
function spectrum(r: () => number, lines: Array<[number, number]> = []): Array<[number, number]> {
	return grid.map((b) => {
		let p = -Math.log(1 - r());
		for (const [at, h] of lines) p += h * Math.exp(-0.5 * ((b - at) / 2.5) ** 2);
		return [b, p] as [number, number];
	});
}
/** A start: the growing window from 6 to 15 s (wholeS when `rule`), then full windows; the first second a number shows. */
function firstShown(T: PulseTracker, rule: boolean, make: (windowS: number) => Array<[number, number]>, until = 40) {
	T.markStart();
	for (let t = 8; t < until; t++) {
		const w = Math.min(15, t - 2);
		const o = T.step(t * 1000, make(w), { wholeS: rule && t <= 17 ? w : null });
		if (o.shown) return { t, bpm: o.bpm };
	}
	return null;
}

describe("rule startEvidence (tracker)", () => {
	it("a clear line at the person's rate shows on the second look, seconds before the filter's own count", () => {
		const line = (w: number): Array<[number, number]> => [[66, 1.2 * w]];
		const at = (rule: boolean) => {
			const r = rng(5);
			const T = new PulseTracker();
			T.seedPrior(64, 6);
			return firstShown(T, rule, (w) => spectrum(r, line(w)));
		};
		const off = at(false);
		const on = at(true);
		expect(on).not.toBeNull();
		expect(off).not.toBeNull();
		expect(on!.t).toBeLessThanOrEqual(8 + TRACKER_START_LOOKS);
		expect(on!.t).toBeLessThan(off!.t);
		expect(Math.abs(on!.bpm - 66)).toBeLessThanOrEqual(5);
	});

	it("adds no number on noise: 300 starts with a prior, none shown while the window grows", () => {
		let shown = 0;
		for (let k = 0; k < 300; k++) {
			const r = rng(1000 + k);
			const T = new PulseTracker();
			T.seedPrior(64, 6);
			if (firstShown(T, true, () => spectrum(r), 18)) shown++;
		}
		expect(shown).toBe(0);
	});

	it("a prior at the wrong rate gets no help: a line elsewhere is never shown at the prior", () => {
		for (let k = 0; k < 20; k++) {
			const r = rng(50 + k);
			const T = new PulseTracker();
			T.seedPrior(64, 6);
			const o = firstShown(T, true, (w) => spectrum(r, [[104, 1.5 * w]]));
			expect(o).not.toBeNull();
			expect(Math.abs(o!.bpm - 104)).toBeLessThanOrEqual(5);
		}
	});

	it("each look starts again from the prior: the same window twice weighs once", () => {
		const T = new PulseTracker({ startLooks: 99 });
		T.seedPrior(64, 6);
		T.markStart();
		const S = spectrum(rng(9), [[64, 4]]);
		const prior = (T as unknown as { b: Float64Array }).b;
		T.step(8000, S, { wholeS: 6 });
		const after1 = Float64Array.from(prior);
		T.step(9000, S, { wholeS: 7 });
		// The prior the looks are judged against has only moved in time: it took none of the window's evidence.
		const near = (a: Float64Array) => T.rates.reduce((m, b, i) => (Math.abs(b - 64) <= 6 ? m + a[i] : m), 0);
		expect(near(prior)).toBeLessThan(near(after1) * 1.01);
		expect(near(prior)).toBeLessThan(TRACKER_PRIOR_SHOW);
	});

	it("without wholeS a step is exactly what it was", () => {
		const a = new PulseTracker();
		const b = new PulseTracker({ startWeight: 0 });
		a.seedPrior(70);
		b.seedPrior(70);
		const r1 = rng(3);
		const r2 = rng(3);
		for (let t = 8; t < 40; t++) expect(a.step(t * 1000, spectrum(r1, [[70, 3]]))).toEqual(b.step(t * 1000, spectrum(r2, [[70, 3]])));
	});
});

describe("rule startEvidence (pulse check)", () => {
	function run(startEvidence: boolean, seconds = 30) {
		const check = new PulseCheck({ rules: { tracker: true, startEvidence }, personalRate: 72 });
		let first: number | null = null;
		const wholes: number[] = [];
		const T = (check as unknown as { tracker: PulseTracker }).tracker;
		const step = T.step.bind(T);
		T.step = (t, s, ev) => {
			if (ev?.wholeS != null) wholes.push(ev.wholeS);
			return step(t, s, ev);
		};
		for (let i = 0; i < seconds * 30; i++) {
			const t = (i * 1000) / 30;
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const c = { r: 100 + 0.12 * p, g: 100 + 0.4 * p, b: 100 + 0.24 * p };
			check.push(t, [c, c, c]);
			if (first == null && shownPulseBpm(check.getState()) != null) first = t / 1000;
		}
		return { first, wholes };
	}
	it("hands the tracker the growing window only while the buffer fills (6 to 15 s), never once it is full", () => {
		const { wholes } = run(true, 40);
		expect(wholes[0]).toBe(6);
		expect(Math.max(...wholes)).toBe(15);
		expect(wholes.length).toBeLessThanOrEqual(11);
	});
	it("off: the tracker is never handed a growing window, and the number comes no sooner than with it on", () => {
		const off = run(false);
		const on = run(true);
		expect(off.wholes.length).toBe(0);
		expect(on.first).not.toBeNull();
		expect(on.first!).toBeLessThanOrEqual(off.first ?? Infinity);
	});
});
