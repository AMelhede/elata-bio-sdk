// Jest provides require; this package's tests carry no Node type declarations.
import { PulseTracker, TRACKER_PRIOR_MASS, TRACKER_PRIOR_SHOW, TRACKER_SHOW } from "../pulseTracker";
import { PulseCheck } from "../pulseCheck";
import { LAST_RATE_KEY, PERSONAL_RATE_MAX_AGE_MS, PERSONAL_RATE_SESSIONS, PERSONAL_SPREAD_MAX, PERSONAL_SPREAD_MIN, readPersonalPrior, readPersonalRate, writeLastReading } from "../lastRate";

// The person's own rate as the tracker's prior (evsave TRIED 2026-11-09, F2).
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
function spectrum(r: () => number, lines: Array<[number, number]> = []): Array<[number, number]> {
	return grid.map((b) => {
		let p = -Math.log(1 - r());
		for (const [at, h] of lines) p += h * Math.exp(-0.5 * ((b - at) / 2.5) ** 2);
		return [b, p] as [number, number];
	});
}
function run(T: PulseTracker, from: number, to: number, make: (t: number) => Array<[number, number]>) {
	const out: Array<{ t: number; shown: boolean; bpm: number; mass: number }> = [];
	for (let t = from; t < to; t++) out.push({ t, ...T.step(t * 1000, make(t)) });
	return out;
}
const near = (T: PulseTracker, bpm: number, w: number) => {
	const a = (T as unknown as { a: Float64Array }).a;
	let m = 0;
	T.rates.forEach((r, i) => {
		if (Math.abs(r - bpm) <= w) m += a[i];
	});
	return m;
};

describe("personal prior (rule tracker)", () => {
	it("is centred on the person's rate and carries less than the show bar", () => {
		const T = new PulseTracker();
		T.seedPrior(64);
		expect(near(T, 64, 12)).toBeGreaterThan(0.6 * TRACKER_PRIOR_MASS);
		expect(TRACKER_PRIOR_MASS).toBeLessThan(TRACKER_SHOW);
		expect(T.priorSeeded).toBe(true);
	});

	it("never shows by itself, over 10 minutes of noise", () => {
		const r = rng(21);
		const T = new PulseTracker();
		T.seedPrior(64);
		expect(run(T, 6, 606, () => spectrum(r)).filter((o) => o.shown).length).toBe(0);
	});

	it("with the face agreeing, the first number comes sooner than with no prior", () => {
		const first = (prior: boolean) => {
			const r = rng(22);
			const T = new PulseTracker();
			if (prior) T.seedPrior(64);
			return run(T, 6, 66, () => spectrum(r, [[64, 5]])).find((o) => o.shown)?.t ?? 999;
		};
		expect(first(true)).toBeLessThan(first(false));
	});

	it("does not bend a face at another rate toward it", () => {
		const r = rng(23);
		const T = new PulseTracker();
		T.seedPrior(64);
		const shown = run(T, 6, 96, () => spectrum(r, [[104, 6]])).filter((o) => o.shown);
		expect(shown.length).toBeGreaterThan(0);
		for (const o of shown) expect(Math.abs(o.bpm - 104)).toBeLessThanOrEqual(5);
	});

	it("raises the show bar while it is in the filter, until a reset", () => {
		expect(TRACKER_PRIOR_SHOW).toBeGreaterThan(TRACKER_SHOW);
		const T = new PulseTracker({ priorMass: 0.5, priorSd: 3, priorShow: 0.9 });
		T.seedPrior(70);
		// A flat window teaches nothing, so the prior's own concentration (about 0.5) is all there is: under 0.9, not shown.
		const r = rng(24);
		expect(T.step(6000, spectrum(r)).shown).toBe(false);
		const U = new PulseTracker({ priorMass: 0.5, priorSd: 3, priorShow: TRACKER_SHOW });
		U.seedPrior(70);
		expect(U.step(6000, spectrum(rng(24))).shown).toBe(true);
		T.reset();
		expect(T.priorSeeded).toBe(false);
	});
});

describe("a hand-over from an earlier session seeds the person's rate, not a flat start mass", () => {
	const seedAt = (opts: ConstructorParameters<typeof PulseCheck>[0]) => {
		const check = new PulseCheck({ ...opts, rules: { tracker: true } });
		const c = check as unknown as { trackerDecides: (...a: unknown[]) => void; tracker: PulseTracker };
		try {
			c.trackerDecides(null, 60_000, () => null, () => null, [], 0);
		} catch {
			/* the window part needs frames; the seed is placed before it */
		}
		return c.tracker;
	};
	it("a 3 h old hand-over: concentrated near its rate", () => {
		const T = seedAt({ resumeAt: { bpm: 64, t: 60_000 - 3 * 3_600_000, maxAgeMs: 24 * 3_600_000 } });
		expect(T.priorSeeded).toBe(true);
		expect(near(T, 64, 12)).toBeGreaterThan(0.6 * TRACKER_PRIOR_MASS);
	});
	it("the person's rate, when handed in, wins over the last hand-over", () => {
		const T = seedAt({ resumeAt: { bpm: 90, t: 60_000 - 3 * 3_600_000, maxAgeMs: 24 * 3_600_000 }, personalRate: 62 });
		expect(near(T, 62, 12)).toBeGreaterThan(0.6 * TRACKER_PRIOR_MASS);
	});
	it("a hand-over within a short break still seeds the walk from it", () => {
		const T = seedAt({ resumeAt: { bpm: 64, t: 50_000, maxAgeMs: 24 * 3_600_000 } });
		expect(T.priorSeeded).toBe(false);
		expect(near(T, 64, 12)).toBeGreaterThan(0.6 * 0.2);
	});
	it("a personalRate that is not a rate is refused", () => {
		expect(() => new PulseCheck({ personalRate: -3 })).toThrow(RangeError);
	});
});

describe("lastRate: the person's own rate on the device", () => {
	const mem = () => {
		const m = new Map<string, string>();
		return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
	};
	const day = 24 * 3_600_000;
	it("is the median of the last sessions, one entry per session (its latest rate)", () => {
		const s = mem();
		writeLastReading(s, { bpm: 60, atEpochMs: 1 * day }, 1);
		writeLastReading(s, { bpm: 64, atEpochMs: 2 * day }, 2);
		writeLastReading(s, { bpm: 66, atEpochMs: 2 * day + 1000 }, 2);
		writeLastReading(s, { bpm: 120, atEpochMs: 3 * day }, 3);
		expect(readPersonalRate(s, 4 * day)).toBe(66);
	});
	it("keeps only the last sessions and none older than its limit", () => {
		const s = mem();
		for (let i = 0; i < PERSONAL_RATE_SESSIONS + 5; i++) writeLastReading(s, { bpm: 50 + i, atEpochMs: day + i }, i);
		const kept = JSON.parse(s.getItem(LAST_RATE_KEY)!).recent;
		expect(kept.length).toBe(PERSONAL_RATE_SESSIONS);
		expect(readPersonalRate(s, day + PERSONAL_RATE_MAX_AGE_MS + 10_000)).toBeNull();
	});
	it("reads a store written before the person's rate was kept as one session", () => {
		const s = mem();
		s.setItem(LAST_RATE_KEY, JSON.stringify({ bpm: 58, atEpochMs: day }));
		expect(readPersonalRate(s, 2 * day)).toBe(58);
	});
	it("follows a drifting rate: recent sessions outweigh old ones", () => {
		const s = mem();
		for (let i = 0; i < 6; i++) writeLastReading(s, { bpm: 70, atEpochMs: i * day }, i);
		for (let i = 0; i < 4; i++) writeLastReading(s, { bpm: 55, atEpochMs: (100 + i) * day }, 100 + i);
		expect(readPersonalRate(s, 104 * day)).toBe(55);
	});
	it("gives the person's own spread once enough sessions exist, within its bounds", () => {
		const s = mem();
		for (let i = 0; i < 3; i++) writeLastReading(s, { bpm: 60 + i, atEpochMs: day + i }, i);
		expect(readPersonalPrior(s, 2 * day)?.sd).toBeNull();
		writeLastReading(s, { bpm: 61, atEpochMs: day + 9 }, 9);
		const sd = readPersonalPrior(s, 2 * day)?.sd ?? 0;
		expect(sd).toBeGreaterThanOrEqual(PERSONAL_SPREAD_MIN);
		expect(sd).toBeLessThanOrEqual(PERSONAL_SPREAD_MAX);
	});
	it("an unreadable store gives nothing", () => {
		const s = mem();
		s.setItem(LAST_RATE_KEY, "{not json");
		expect(readPersonalRate(s, day)).toBeNull();
		expect(readPersonalRate(null, day)).toBeNull();
	});
});
