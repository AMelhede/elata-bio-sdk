import {
	feedPassiveReader,
	PASSIVE_DEFAULTS,
	PassiveReader,
	type PassiveReading,
	passiveReaderFor,
	rawRoiSampleOf,
	resolvePassiveOptions,
} from "../passiveReader";
import { PulseCheck } from "../pulseCheck";
import type { RawRoiSample } from "../pulseCheckCore";
import { RppgSession } from "../rppgSession";

type Rgb = { r: number; g: number; b: number };

// Three face regions at 30 fps, as pulseCheck.test.ts builds them: a pulse is chromatic (green drops most).
// `bpmAt(t)` gives the rate at each instant (phase accumulated, so a change of rate does not jump), `amp` the
// pulse as a fraction of the light; `skip(t)` drops frames (a break in the camera).
function frames(
	bpmAt: (tMs: number) => number,
	amp: number,
	fromMs: number,
	toMs: number,
	seed = 7,
	skip: (tMs: number) => boolean = () => false,
): Array<{ t: number; regions: Rgb[] }> {
	let s = seed;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	const out: Array<{ t: number; regions: Rgb[] }> = [];
	let phase = 0;
	const dt = 1000 / 30;
	for (let t = fromMs; t <= toMs; t += dt) {
		phase += (2 * Math.PI * bpmAt(t) * dt) / 60000;
		if (skip(t)) continue;
		const p = amp * Math.sin(phase);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		out.push({ t, regions: [region(), region(), region()] });
	}
	return out;
}

function readAll(reader: PassiveReader, fs: Array<{ t: number; regions: Rgb[] }>): PassiveReading[] {
	const got: PassiveReading[] = [];
	for (const f of fs) {
		const r = reader.push(rawRoiSampleOf(f.t, f.regions) as RawRoiSample);
		if (r) got.push(r);
	}
	return got;
}

const steady = (bpm: number) => () => bpm;

describe("PassiveReader", () => {
	it("reads a steady pulse at its rate, every 5 s once 48 s are in", () => {
		const got = readAll(new PassiveReader(), frames(steady(72), 0.01, 0, 120_000));
		expect(got.length).toBeGreaterThanOrEqual(10);
		for (const r of got) {
			expect(Math.abs(r.bpm - 72)).toBeLessThanOrEqual(1.5);
			expect(r.windowS).toBe(48);
			expect(r.snrDb).toBeGreaterThanOrEqual(PASSIVE_DEFAULTS.minSnrDb);
			expect(r.atMs % 5000).toBe(0);
		}
		const gaps = got.slice(1).map((r, i) => r.atMs - got[i].atMs);
		expect(gaps.every((g) => g === 5000)).toBe(true);
	});

	it("reads nothing before a full 48 s window", () => {
		const got = readAll(new PassiveReader(), frames(steady(72), 0.01, 0, 120_000));
		expect(got[0].atMs).toBeGreaterThanOrEqual(48_000);
		expect(readAll(new PassiveReader(), frames(steady(72), 0.01, 0, 47_000))).toEqual([]);
	});

	it("reads nothing from noise alone", () => {
		for (const seed of [3, 7, 11]) expect(readAll(new PassiveReader(), frames(steady(72), 0, 0, 240_000, seed))).toEqual([]);
	});

	it("refuses a window whose two halves disagree on the rate", () => {
		// 60 bpm for 30 s, then 90: some windows that span the change have one half at 60 and the other at 90.
		const fs = frames((t) => (t < 30_000 ? 60 : 90), 0.01, 0, 140_000);
		const split = (r: PassiveReading) => Math.abs(r.halvesBpm[0] - r.halvesBpm[1]) > PASSIVE_DEFAULTS.halfAgreeBpm;
		const without = readAll(new PassiveReader({ halfAgreeBpm: Number.POSITIVE_INFINITY }), fs);
		const refused = without.filter(split).map((r) => r.atMs);
		expect(refused.length).toBeGreaterThan(0);
		const got = readAll(new PassiveReader(), fs);
		expect(got.filter((r) => refused.includes(r.atMs))).toEqual([]);
		expect(got.filter(split)).toEqual([]);
		// Once the window is all 90, it reads 90.
		expect(got.filter((r) => r.atMs >= 80_000).length).toBeGreaterThan(0);
		for (const r of got.filter((r) => r.atMs >= 80_000)) expect(Math.abs(r.bpm - 90)).toBeLessThanOrEqual(1.5);
	});

	it("refuses a window whose newest 16 s disagree with it", () => {
		// 60 bpm for 60 s, then 90: soon after the change the window still reads 60 and its newest stretch 90.
		const fs = frames((t) => (t < 60_000 ? 60 : 90), 0.01, 0, 100_000);
		const stale = (r: PassiveReading) => Math.abs(r.recentBpm - r.bpm) > PASSIVE_DEFAULTS.recentAgreeBpm;
		const any = { halfAgreeBpm: Number.POSITIVE_INFINITY };
		const without = readAll(new PassiveReader({ ...any, recentAgreeBpm: Number.POSITIVE_INFINITY }), fs);
		const refused = without.filter(stale).map((r) => r.atMs);
		expect(refused.length).toBeGreaterThan(0);
		const got = readAll(new PassiveReader(any), fs);
		expect(got.filter((r) => refused.includes(r.atMs))).toEqual([]);
	});

	it("starts again after a break longer than the reset gap, and keeps the last reading with its age", () => {
		const reader = new PassiveReader();
		const before = readAll(reader, frames(steady(72), 0.01, 0, 60_000));
		expect(before.length).toBeGreaterThan(0);
		// Frames stop for 6 s (over the 5 s reset gap), then come back.
		const after = readAll(reader, frames(steady(72), 0.01, 66_000, 140_000, 9));
		// The mark at the last frame before the break is still read from the frames before it.
		const fresh = after.filter((r) => r.atMs > 66_000);
		expect(fresh.length).toBeGreaterThan(0);
		expect(fresh[0].atMs - 66_000).toBeGreaterThanOrEqual(48_000);
		expect(reader.reading()?.bpm).toBeCloseTo(after[after.length - 1].bpm, 6);
		// Between, the last reading stays, older by the frames that came in.
		const held = new PassiveReader();
		readAll(held, frames(steady(72), 0.01, 0, 58_000));
		const last = held.reading() as PassiveReading;
		readAll(held, frames(steady(72), 0.01, 66_000, 80_000, 9));
		expect(held.reading()?.atMs).toBe(last.atMs);
		expect(held.reading()?.ageMs).toBeGreaterThan(last.ageMs + 19_000);
	});

	it("carries on over a break shorter than the reset gap", () => {
		const fs = frames(steady(72), 0.01, 0, 120_000, 7, (t) => t > 60_000 && t < 62_000);
		const got = readAll(new PassiveReader(), fs);
		expect(got.some((r) => r.atMs > 62_000 && r.atMs < 62_000 + 48_000)).toBe(true);
	});

	it("never carries HRV", () => {
		const got = readAll(new PassiveReader(), frames(steady(72), 0.01, 0, 70_000));
		for (const r of got) expect(Object.keys(r).filter((k) => /hrv|rmssd/i.test(k))).toEqual([]);
	});

	it("resolves the option: off unless set, defaults with true", () => {
		expect(resolvePassiveOptions(undefined)).toBeNull();
		expect(resolvePassiveOptions(false)).toBeNull();
		expect(resolvePassiveOptions(true)).toEqual(PASSIVE_DEFAULTS);
		expect(resolvePassiveOptions({ windowS: 32 })).toEqual({ ...PASSIVE_DEFAULTS, windowS: 32 });
	});
});

describe("PassiveReader fed from the pulse check", () => {
	const feed = (check: PulseCheck, fs: Array<{ t: number; regions: Rgb[] }>) => {
		for (const f of fs) check.push(f.t, f.regions);
	};

	it("is not attached when the option is off, or without a check", () => {
		const check = new PulseCheck();
		expect(passiveReaderFor({}, check)).toBeNull();
		expect(passiveReaderFor({ passive: false }, check)).toBeNull();
		expect(passiveReaderFor({ passive: true }, null)).toBeNull();
		expect(Object.prototype.hasOwnProperty.call(check, "push")).toBe(false);
		expect(check.push).toBe(PulseCheck.prototype.push);
	});

	it("leaves the check's state exactly as it is without the reader", () => {
		const fs = frames(steady(72), 0.01, 0, 70_000);
		const plain = new PulseCheck();
		const fed = new PulseCheck();
		const heard: PassiveReading[] = [];
		const reader = passiveReaderFor({ passive: true, onPassiveReading: (r) => heard.push(r) }, fed) as PassiveReader;
		const states: [unknown, unknown][] = [];
		for (const f of fs) {
			plain.push(f.t, f.regions);
			fed.push(f.t, f.regions);
			states.push([plain.getState(), fed.getState()]);
		}
		for (const [a, b] of states) expect(b).toEqual(a);
		expect(fed.evaluations).toBe(plain.evaluations);
		expect(heard.length).toBeGreaterThan(0);
		expect(reader.reading()?.atMs).toBe(heard[heard.length - 1].atMs);
	});

	it("reads through the check what it reads from the rows", () => {
		const fs = frames(steady(66), 0.01, 0, 90_000, 5);
		const check = new PulseCheck();
		const viaCheck = new PassiveReader();
		const heard: PassiveReading[] = [];
		feedPassiveReader(check, viaCheck, (r) => heard.push(r));
		feed(check, fs);
		expect(heard).toEqual(readAll(new PassiveReader(), fs));
	});

	it("the session hands over nothing with the option off", () => {
		const session = new RppgSession({} as never, {} as never, {} as never, "wasm", "face_mesh", {});
		expect(session.passiveReading()).toBeNull();
	});

	it("the session hands over the reader's newest reading with the option on", () => {
		const check = new PulseCheck();
		const reader = passiveReaderFor({ passive: true }, check) as PassiveReader;
		feed(check, frames(steady(72), 0.01, 0, 60_000));
		const session = new RppgSession({} as never, {} as never, {} as never, "wasm", "face_mesh", { pulseCheck: check, passive: reader });
		expect(session.passiveReading()).toEqual(reader.reading());
		expect(Math.abs((session.passiveReading()?.bpm ?? 0) - 72)).toBeLessThanOrEqual(1.5);
	});
});
