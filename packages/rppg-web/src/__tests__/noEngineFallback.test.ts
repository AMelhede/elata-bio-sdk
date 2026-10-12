import { FIX_SWITCHES_OFF_BY_DEFAULT, resolveFixSwitches } from "../fixSwitches";
import { type Metrics, RppgProcessor } from "../rppgProcessor";
import { RppgSession } from "../rppgSession";

// When the processor's own checks refuse a rate (its low-confidence gate: the estimators disagree, the SNR is
// under -4.5 dB, the motion is high, or an alias with a wide spread), the published `bpm` falls back to the
// engine's raw rate (`fused ?? candidate ?? engine`), and with fewer than 24 samples it is the engine's raw rate
// outright. The engine withholds only when its peak is under 1.3 times its noise floor, so on noise it nearly
// always has a number: with no pulse at all, the published processor shows that number while reporting a
// confidence of at most 0.3. The switch noEngineFallback makes the refusal hold: `bpm` is null then.
//
// The engines here are stand-ins with a fixed answer, so the only thing that can put a number in `bpm` with no
// pulse is the fallback. The feed is the rgbPulse tests' region mean: 170 / 120 / 100 grey levels, the pulse (when
// there is one) along the blood-volume direction 0.33 / 0.77 / 0.53 (de Haan and van Leest 2014), 1% scale.

const PBV = [0.33, 0.77, 0.53];
const BASE = [170, 120, 100];
type Sample = { t: number; r: number; g: number; b: number };

function feed(bpm: number, fps: number, seconds: number, opts: { grey?: boolean; noise?: number; seed?: number } = {}): Sample[] {
	let s = (opts.seed ?? 12345) >>> 0;
	const u = () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return (s + 0.5) / 2 ** 32;
	};
	const gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
	const noise = opts.noise ?? 0.05;
	const out: Sample[] = [];
	for (let i = 0; i < Math.round(seconds * fps); i++) {
		const t = (i * 1000) / fps;
		const p = bpm > 0 ? Math.sin((2 * Math.PI * bpm * t) / 60000) : 0;
		const [r, g, b] = BASE.map((c, k) => c * (1 - 0.01 * PBV[k] * p) + noise * gauss());
		out.push(opts.grey ? { t, r: g, g, b: g } : { t, r, g, b });
	}
	return out;
}

/** An engine that takes every sample and always answers `bpm` at `confidence`. */
function engine(bpm: number | null, confidence: number) {
	return {
		newPipeline: () => ({
			push_sample_rgb() {},
			push_sample_rgb_meta() {},
			get_metrics: () => ({ bpm, confidence, signal_quality: 0.8 }),
		}),
	};
}

type Extra = { muse?: { bpm: number; quality: number }; motion?: number };

/** Every read an app polling once a second makes; `motion` goes with each sample (pushSampleRgbMeta). */
function readEverySecond(p: RppgProcessor, samples: Sample[], extra: Extra = {}): Metrics[] {
	const out: Metrics[] = [];
	let next = 1000;
	for (const x of samples) {
		if (extra.motion == null) p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		else p.pushSampleRgbMeta(x.t, x.r, x.g, x.b, 1, extra.motion, 0);
		if (x.t >= next) {
			next += 1000;
			if (extra.muse) p.updateMuseMetrics(extra.muse.bpm, extra.muse.quality, x.t);
			out.push(p.getMetrics());
		}
	}
	return out;
}

const run = (backend: ReturnType<typeof engine>, samples: Sample[], on: boolean, extra: Extra = {}) =>
	readEverySecond(new RppgProcessor(backend, 30, 10, { fixes: { noEngineFallback: on } }), samples, extra);

describe("noEngineFallback: the processor's own refusal holds", () => {
	test("no pulse, an engine that always says 88: published shows 88 in every read; with the switch, none", () => {
		const samples = feed(0, 30, 20);
		const off = run(engine(88, 0.2), samples, false);
		const on = run(engine(88, 0.2), samples, true);
		expect(off).toHaveLength(19);
		// Published: every read refused by the processor (fused_source "none", confidence at most 0.3), and the
		// engine's 88 shown anyway.
		for (const m of off) {
			expect(m.fused_source).toBe("none");
			expect(m.confidence).toBeLessThanOrEqual(0.3);
			expect(m.bpm).toBe(88);
		}
		for (const [i, m] of on.entries()) {
			expect(m.bpm).toBeNull();
			expect(m.fused_bpm).toBeNull();
			// Everything else in the read is what the published read says.
			expect({ ...m, bpm: off[i].bpm }).toEqual(off[i]);
		}
	});

	test("a clean pulse still reads: a read the gate passed is the same number with and without the switch", () => {
		// Grey input (R = G = B) reaches the processor's estimators as is, so they read the 72 themselves.
		const samples = feed(72, 30, 20, { grey: true });
		const off = run(engine(88, 0.2), samples, false);
		const on = run(engine(88, 0.2), samples, true);
		let passed = 0;
		for (const [i, m] of on.entries()) {
			if (off[i].fused_source === "none") {
				expect(off[i].bpm).toBe(88);
				expect(m.bpm).toBeNull();
			} else {
				passed++;
				expect(m).toEqual(off[i]);
			}
		}
		expect(passed).toBeGreaterThanOrEqual(15);
		expect(on.slice(-15).every((m) => m.bpm != null && Math.abs(m.bpm - 72) <= 1)).toBe(true);
	});

	test("a moving camera, which the gate refuses: the engine's 88 shown, with the switch none, and a fresh Muse rate still shows", () => {
		// A clean 72 the processor's own estimators read, but every sample carries motion 0.5 and the gate refuses
		// any read whose mean motion is over 0.22.
		const samples = feed(72, 30, 20, { grey: true });
		const muse = { bpm: 64, quality: 90 };
		expect(run(engine(88, 0.2), samples, false, { motion: 0.5 }).every((m) => m.fused_source === "none" && m.bpm === 88)).toBe(true);
		expect(run(engine(88, 0.2), samples, true, { motion: 0.5 }).every((m) => m.bpm === null)).toBe(true);
		// A fresh Muse rate is another sensor's measurement; the refusal is the camera's, so it still shows.
		const withMuse = run(engine(88, 0.2), samples, true, { motion: 0.5, muse });
		expect(withMuse.every((m) => m.fused_source === "none" && m.bpm === 64)).toBe(true);
		expect(withMuse).toEqual(run(engine(88, 0.2), samples, false, { motion: 0.5, muse }));
	});

	test("fewer than 24 samples: published shows the engine's raw rate; with the switch, none", () => {
		const read = (on: boolean) => {
			const p = new RppgProcessor(engine(88, 0.9), 30, 10, { fixes: { noEngineFallback: on } });
			for (const x of feed(72, 30, 0.6, { grey: true })) p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
			return p.getMetrics();
		};
		expect(read(false).bpm).toBe(88);
		expect(read(false).fused_bpm).toBe(88);
		const on = read(true);
		expect(on.bpm).toBeNull();
		expect(on.fused_bpm).toBeNull();
		expect(on.fused_source).toBe("none");
	});

	test.each([1, 2, 3])("with the switch no read shows a rate the processor refused (noise, seed %i)", (seed) => {
		for (const m of run(engine(88, 0.2), feed(0, 20, 30, { seed, noise: 0.5 }), true)) {
			if (m.bpm != null) expect(m.fused_source).not.toBe("none");
		}
	});

	test("an engine with no rate: the switch changes nothing", () => {
		const samples = feed(72, 30, 20, { grey: true });
		expect(run(engine(null, 0), samples, true)).toEqual(run(engine(null, 0), samples, false));
	});
});

describe("noEngineFallback switch", () => {
	test("off unless set to true, and fixes: false gives the published fallback", () => {
		expect(FIX_SWITCHES_OFF_BY_DEFAULT).toContain("noEngineFallback");
		expect(resolveFixSwitches().noEngineFallback).toBe(false);
		expect(resolveFixSwitches(true).noEngineFallback).toBe(false);
		expect(resolveFixSwitches({}).noEngineFallback).toBe(false);
		expect(resolveFixSwitches(false).noEngineFallback).toBe(false);
		expect(resolveFixSwitches({ noEngineFallback: true }).noEngineFallback).toBe(true);
		expect(new RppgProcessor(engine(88, 0.2), 30, 10).fixes.noEngineFallback).toBe(false);
		const off = readEverySecond(new RppgProcessor(engine(88, 0.2), 30, 10, { fixes: false }), feed(0, 30, 5));
		expect(off.every((m) => m.bpm === 88)).toBe(true);
	});

	test("a session reports the switch its processor runs, so a result is logged against the right build", () => {
		const session = (processorFixes: object) =>
			new RppgSession(
				{} as never,
				{ fixes: resolveFixSwitches(processorFixes as never) } as never,
				{ fixes: resolveFixSwitches() } as never,
				"wasm",
				"face_mesh",
				{},
			);
		expect(session({ noEngineFallback: true }).getBuildSwitches().fixes.noEngineFallback).toBe(true);
		expect(session({}).getBuildSwitches().fixes.noEngineFallback).toBe(false);
	});
});
