import { resolveFixSwitches } from "../fixSwitches";
import { RppgProcessor } from "../rppgProcessor";
import { RppgSession } from "../rppgSession";
import { Bandpass, ChannelGainController, ChromPulseModel, PosPulseModel, RgbPulseExtractor } from "../rppgSignalModel";

// Known answers for the processor's own colour path (pushSampleRgb / pushSampleRgbMeta), the one an app takes
// when it feeds RppgProcessor directly. The engine is silent here (no rate of its own), so the rate comes from the
// processor's own pulse signal and its window estimators alone.
//
// The feed: a skin-coloured region mean of 170 / 120 / 100 grey levels whose pulse lies in the blood-volume
// direction, relative strengths 0.33 / 0.77 / 0.53 for R / G / B (de Haan and van Leest 2014, Physiol. Meas.
// 35:1913), 0.77% at green (real camera pulses are 0.5 to 2%), plus Gaussian sensor noise of 0.05 grey levels per
// channel on the region mean (a 2-level per-pixel noise averaged over about 1600 skin pixels). Rising blood volume
// lowers every channel, green most.

const PBV = [0.33, 0.77, 0.53];
const BASE = [170, 120, 100];

type Sample = { t: number; r: number; g: number; b: number };

function feed(bpm: number, fps: number, seconds: number, opts: { noise?: number; grey?: boolean; seed?: number } = {}): Sample[] {
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

// An engine that takes every sample and never has a rate, so only the processor's own estimators speak.
const silentBackend = {
	newPipeline: () => ({
		push_sample_rgb() {},
		push_sample_rgb_meta() {},
		get_metrics: () => ({ bpm: null, confidence: 0, signal_quality: 0 }),
	}),
};

const ON = { rgbPulse: true };

function run(samples: Sample[], sampleRate: number, opts: { fixes?: object | boolean; meta?: boolean } = {}) {
	const p = new RppgProcessor(silentBackend, sampleRate, 10, { fixes: (opts.fixes ?? ON) as never });
	// Read once a second, as an app does: the rate history and the tracker move with the reads.
	let next = 1000;
	for (const x of samples) {
		if (opts.meta) p.pushSampleRgbMeta(x.t, x.r, x.g, x.b, 1, 0, 0);
		else p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		if (x.t >= next) {
			next += 1000;
			p.getMetrics();
		}
	}
	return p;
}

describe("processor colour path: known answers (switch rgbPulse on)", () => {
	// The published path read a 72 as 42 (spectral), 180 (ACF) and 111 (bpm, the mean of the two); see the
	// switch-off test below for the cause.
	test.each([
		[72, 30],
		[50, 30],
		[120, 30],
		[50, 20],
		[72, 20],
	])("a true %i at %i frames a second reads within 3 on every estimator", (bpm, fps) => {
		const m = run(feed(bpm, fps, 40), fps).getMetrics();
		expect(Math.abs((m.spectral_bpm ?? 0) - bpm)).toBeLessThanOrEqual(3);
		expect(Math.abs((m.bpm ?? 0) - bpm)).toBeLessThanOrEqual(3);
	});

	test("pushSampleRgbMeta takes the same path", () => {
		const m = run(feed(72, 30, 40), 30, { meta: true }).getMetrics();
		expect(Math.abs((m.bpm ?? 0) - 72)).toBeLessThanOrEqual(3);
	});

	test("a camera slower than the processor was built for (20 a second into sampleRate 30) still reads", () => {
		for (const bpm of [50, 72, 120]) {
			const m = run(feed(bpm, 20, 40), 30).getMetrics();
			expect(Math.abs((m.bpm ?? 0) - bpm)).toBeLessThanOrEqual(3);
		}
	});

	test("the processor's window holds one quantity: no sample carries a raw colour level", () => {
		// Published, the first nine samples (and any where the projection came out near zero) were raw green, about
		// 120 grey levels, beside a projected pulse of about 0.01: a step a thousand times the pulse that stayed in
		// the 45 s analysis window.
		const trace = run(feed(72, 30, 10), 30).getTraceSnapshot(1000).points;
		expect(trace.length).toBe(300);
		expect(Math.max(...trace.map((x) => Math.abs(x.intensity)))).toBeLessThan(1);
	});

	test("an already-extracted signal (R = G = B) passes its own value and still reads", () => {
		const samples = feed(72, 30, 40, { grey: true });
		const p = run(samples, 30);
		const trace = p.getTraceSnapshot(5).points;
		for (const x of trace) expect(x.intensity).toBe(x.g);
		expect(Math.abs((p.getMetrics().bpm ?? 0) - 72)).toBeLessThanOrEqual(3);
	});
});

// The README's rgbPulse row gives the known answers above as read once a second, as an app polling getMetrics()
// does. Read only once, with no rate history, the processor's fusion of its estimators decides alone: its
// autocorrelation reads this 120 at half the rate, and the untrained calibration blends that with the engine's
// rate. With the packed WASM core of 0.15.0-test.19 in Node (a 120 at 30 frames a second, 0.05 grey levels of
// noise, a separately written feed; test.19 audit) the one read gave 95.7, calibrated_bpm 95.7, acf_bpm 60 and
// resolved_bpm 120; an engine that reports the true rate, as here, gives the same 95.7. The README names it, and
// this keeps its number the code's.
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const path = require("path") as { join: (...p: string[]) => string };
const readme = fs.readFileSync(path.join(__dirname, "..", "..", "README.md"), "utf8");

/** An engine that reports the true rate on every read, as the WASM core does on this feed. */
const rightEngine = (bpm: number) => ({
	newPipeline: () => ({
		push_sample_rgb() {},
		push_sample_rgb_meta() {},
		get_metrics: () => ({ bpm, confidence: 0.9, signal_quality: 0.8 }),
	}),
});

describe("switch rgbPulse on: read once a second, not once", () => {
	test("a 120 read only once after 30 s comes out low, as the README says; read once a second it reads 120", () => {
		const samples = feed(120, 30, 30);
		const once = new RppgProcessor(rightEngine(120), 30, 10, { fixes: ON as never });
		for (const x of samples) once.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		const m = once.getMetrics();
		expect(Math.abs((m.acf_bpm ?? 0) - 60)).toBeLessThanOrEqual(2);
		expect(m.bpm).toBe(m.calibrated_bpm);
		expect(m.bpm ?? 0).toBeGreaterThan(90);
		expect(m.bpm ?? 200).toBeLessThan(100);

		const polled = new RppgProcessor(rightEngine(120), 30, 10, { fixes: ON as never });
		let next = 1000;
		for (const x of samples) {
			polled.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
			if (x.t >= next) {
				next += 1000;
				polled.getMetrics();
			}
		}
		expect(Math.abs((polled.getMetrics().bpm ?? 0) - 120)).toBeLessThanOrEqual(3);

		const row = readme.split(/\r?\n/).find((line) => line.startsWith("| `fixes.rgbPulse` |")) ?? "";
		expect(row).toContain(`a 120 came out ${Math.round(m.bpm ?? 0)}`);
	});
});

describe("switch rgbPulse off (the default): the published path, exactly", () => {
	test("off unless set to true", () => {
		expect(resolveFixSwitches().rgbPulse).toBe(false);
		expect(resolveFixSwitches(true).rgbPulse).toBe(false);
		expect(resolveFixSwitches({}).rgbPulse).toBe(false);
		expect(resolveFixSwitches(false).rgbPulse).toBe(false);
		expect(resolveFixSwitches({ rgbPulse: true }).rgbPulse).toBe(true);
		expect(resolveFixSwitches({ posFusion: false }).noRateDoubling).toBe(true);
		expect(new RppgProcessor(silentBackend, 30, 10).fixes.rgbPulse).toBe(false);
	});

	test("a session reports the switch its processor runs, so a result is logged against the right build", () => {
		// getBuildSwitches() takes the processor's own rgbPulse, as it does colourProjectionFix and noRateDoubling: an
		// app that hands the session its own RppgProcessor with rgbPulse on, under a runner at the defaults, runs it on.
		const session = (processorFixes: object) =>
			new RppgSession(
				{} as never,
				{ fixes: resolveFixSwitches(processorFixes as never) } as never,
				{ fixes: resolveFixSwitches() } as never,
				"wasm",
				"face_mesh",
				{},
			);
		expect(session({ rgbPulse: true }).getBuildSwitches().fixes.rgbPulse).toBe(true);
		expect(session({}).getBuildSwitches().fixes.rgbPulse).toBe(false);
	});

	test("raw green for the first nine samples, then channel gain and CHROM, value for value", () => {
		const samples = feed(72, 30, 5);
		const trace = run(samples, 30, { fixes: {} }).getTraceSnapshot(1000).points;
		const gain = new ChannelGainController();
		const chrom = new ChromPulseModel();
		const published = samples.map((x) => {
			const bal = gain.process(x.r, x.g, x.b);
			const v = chrom.process(bal.r, bal.g, bal.b);
			return !Number.isFinite(v) || Math.abs(v) < 1e-6 ? x.g : v;
		});
		expect(trace.map((x) => x.intensity)).toEqual(published);
		expect(trace.slice(0, 9).map((x) => x.intensity)).toEqual(samples.slice(0, 9).map((x) => x.g));
	});

	test("and so misreads a clean pulse, as published", () => {
		const m = run(feed(72, 30, 40), 30, { fixes: {} }).getMetrics();
		expect(Math.abs((m.spectral_bpm ?? 0) - 72)).toBeGreaterThan(10);
	});
});

describe("RgbPulseExtractor", () => {
	const push = (x: RgbPulseExtractor, times: number[]) =>
		times.map((t, i) => x.process(t, 170 + Math.sin(i), 120 + Math.cos(i), 100));

	test("gives the projection's neutral 0, never a colour level, until it has 10 samples", () => {
		const out = push(new RgbPulseExtractor(), Array.from({ length: 12 }, (_, i) => i * 33.3));
		expect(out.slice(0, 9)).toEqual(Array(9).fill(0));
		expect(Math.abs(out[11])).toBeLessThan(1);
	});

	test("is POS and then the fuser's 0.7 to 4 Hz band-pass, value for value", () => {
		// The fuser's own per-region chain (multiRoiFusion.ts): PosPulseModel, then Bandpass(fs, 0.7, 4.0). On real
		// captures the band-pass is what made the processor's estimators read (see the changeset); here it is pinned.
		const samples = feed(72, 30, 5);
		const x = new RgbPulseExtractor();
		const pos = new PosPulseModel();
		let bp: Bandpass | null = null;
		samples.forEach((s, i) => {
			const h = pos.process(s.r, s.g, s.b);
			const got = x.process(s.t, s.r, s.g, s.b);
			if (i < 9) return expect(got).toBe(0);
			bp ??= new Bandpass(30, 0.7, 4.0);
			expect(got).toBeCloseTo(bp.process(h), 12);
		});
		expect(x.filterRate).toBeCloseTo(30, 9);
	});

	test("at 20 frames a second the band-pass is the one designed for 20, value for value", () => {
		// filterRate alone cannot tell a filter designed for the measured rate from one designed for 30 and labelled 20;
		// the values can.
		const samples = feed(72, 20, 5);
		const x = new RgbPulseExtractor();
		const pos = new PosPulseModel();
		const bp = new Bandpass(20, 0.7, 4.0);
		samples.forEach((s, i) => {
			const h = pos.process(s.r, s.g, s.b);
			const got = x.process(s.t, s.r, s.g, s.b);
			if (i < 9) return expect(got).toBe(0);
			expect(got).toBeCloseTo(bp.process(h), 12);
		});
		expect(x.filterRate).toBeCloseTo(20, 9);
	});

	test("designs its band-pass for the rate the samples arrive at", () => {
		const x = new RgbPulseExtractor();
		push(x, Array.from({ length: 60 }, (_, i) => i * 50));
		expect(x.filterRate).toBeCloseTo(20, 6);
	});

	test("takes the mean rate of a camera on a 16 ms clock, not the median interval", () => {
		// 32 and 48 ms alternating with two 32s for every 48: mean 37.33 ms (26.8 a second), median 32 (31.25).
		const steps = [32, 32, 48];
		const times = [0];
		for (let i = 1; i < 60; i++) times.push(times[i - 1] + steps[i % 3]);
		const x = new RgbPulseExtractor();
		push(x, times);
		expect(x.filterRate).toBeGreaterThan(26);
		expect(x.filterRate).toBeLessThan(27.5);
	});

	test("one camera stall does not move the rate", () => {
		const times = Array.from({ length: 60 }, (_, i) => i * 33.3 + (i >= 40 ? 600 : 0));
		const x = new RgbPulseExtractor();
		push(x, times);
		expect(x.filterRate).toBeCloseTo(30.03, 1);
	});

	test("designs its band-pass afresh when the camera's rate moves by more than a tenth, and not for less", () => {
		// RGB_PULSE_REDESIGN: a camera that halves its rate to lengthen its exposure gets a filter for the new rate
		// (within a tenth of it, the redesign step), while a 5% wander keeps the filter it has.
		const at = (fps: number, n: number, from: number) => Array.from({ length: n }, (_, i) => from + ((i + 1) * 1000) / fps);
		const x = new RgbPulseExtractor();
		const steady = [0, ...at(30, 59, 0)];
		push(x, steady);
		expect(x.filterRate).toBeCloseTo(30, 6);
		const wander = at(28.5, 60, steady[steady.length - 1]);
		push(x, wander);
		expect(x.filterRate).toBeCloseTo(30, 6);
		push(x, at(15, 60, wander[wander.length - 1]));
		expect(x.filterRate).toBeGreaterThanOrEqual(15);
		expect(x.filterRate).toBeLessThanOrEqual(15 * 1.1);
	});

	test("reset starts it afresh", () => {
		const x = new RgbPulseExtractor();
		push(x, Array.from({ length: 30 }, (_, i) => i * 33.3));
		x.reset();
		expect(x.filterRate).toBe(0);
		expect(push(x, Array.from({ length: 9 }, (_, i) => 5000 + i * 33.3))).toEqual(Array(9).fill(0));
	});

	test("resetCalibration starts it afresh too, as it does the published path's channel gain and CHROM", () => {
		const p = run(feed(72, 30, 5), 30);
		p.resetCalibration();
		for (const x of feed(72, 30, 1).map((s) => ({ ...s, t: s.t + 10000 }))) p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		const trace = p.getTraceSnapshot(1000).points;
		expect(trace.slice(-30, -21).map((x) => x.intensity)).toEqual(Array(9).fill(0));
	});

	test("the processor starts it afresh with the signal (resetSignal)", () => {
		const p = run(feed(72, 30, 5), 30);
		p.resetSignal();
		for (const x of feed(72, 30, 1).map((s) => ({ ...s, t: s.t + 10000 }))) p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		const trace = p.getTraceSnapshot(1000).points;
		expect(trace.length).toBe(30);
		expect(trace.slice(0, 9).map((x) => x.intensity)).toEqual(Array(9).fill(0));
	});
});
