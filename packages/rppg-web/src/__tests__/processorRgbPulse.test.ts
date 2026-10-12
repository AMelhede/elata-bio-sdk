import { RppgProcessor } from "../rppgProcessor";
import {
	Bandpass,
	ChannelGainController,
	ChromPulseModel,
	PosPulseModel,
	RgbPulseExtractor,
} from "../rppgSignalModel";

// Known answers for the processor's own colour path (pushSampleRgb and
// pushSampleRgbMeta): what an app that feeds RppgProcessor directly uses, and what
// DemoRunner feeds for every frame it does not fuse. The engine below never has a
// rate of its own, so every rate comes from the processor's own pulse signal and
// its window estimators.
//
// The feed: a skin-coloured region mean of 170 / 120 / 100 grey levels whose pulse
// lies along the blood-volume direction, relative strengths 0.33 / 0.77 / 0.53 for
// R / G / B (de Haan and van Leest 2014, Physiol. Meas. 35:1913), 0.77% at green
// (camera pulses are 0.5 to 2%), plus Gaussian sensor noise of 0.05 grey levels per
// channel on the region mean (a 2-level per-pixel noise averaged over about 1600
// skin pixels). Rising blood volume lowers every channel, green most. The rates
// sit well away from 100 bpm, where a pipeline reading no pulse tends to land.

const PBV = [0.33, 0.77, 0.53];
const BASE = [170, 120, 100];

type Sample = { t: number; r: number; g: number; b: number };

function feed(
	bpm: number,
	fps: number,
	seconds: number,
	opts: { noise?: number; grey?: boolean; seed?: number } = {},
): Sample[] {
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

// An engine that takes every sample and never has a rate.
const silentBackend = {
	newPipeline: () => ({
		push_sample_rgb() {},
		push_sample_rgb_meta() {},
		get_metrics: () => ({ bpm: null, confidence: 0, signal_quality: 0 }),
	}),
};

function run(
	samples: Sample[],
	sampleRate: number,
	opts: { rgbPulse?: "pos" | "chrom"; meta?: boolean } = { rgbPulse: "pos" },
) {
	const p = new RppgProcessor(silentBackend, sampleRate, 10, {
		rgbPulse: opts.rgbPulse,
	});
	// Read along the way, as an app does: the rate history and the tracker move with the reads.
	// Every 2 s rather than every second gives the same answers on these feeds, and each read runs
	// the whole window analysis, which is slow under jest.
	let next = 2000;
	for (const x of samples) {
		if (opts.meta) p.pushSampleRgbMeta(x.t, x.r, x.g, x.b, 1, 0, 0);
		else p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		if (x.t >= next) {
			next += 2000;
			p.getMetrics();
		}
	}
	return p;
}

const near = (value: number | null | undefined, truth: number) =>
	value != null && Math.abs(value - truth) <= 3;

describe('processor colour path with rgbPulse: "pos": known answers', () => {
	test.each([
		[72, 30],
		[50, 30],
		[50, 20],
		[72, 20],
	])("a true %i at %i frames a second reads within 3, spectral estimate and bpm", (bpm, fps) => {
		const m = run(feed(bpm, fps, 30), fps).getMetrics();
		expect(near(m.spectral_bpm, bpm)).toBe(true);
		expect(near(m.bpm, bpm)).toBe(true);
	});

	test("a true 120 reads within 3 on the spectral estimate, and bpm is never a wrong number", () => {
		// The processor's autocorrelation estimate halves clean rates above about 110, so on some
		// feeds the estimators disagree and bpm is withheld; that is a separate stage.
		const m = run(feed(120, 30, 30), 30).getMetrics();
		expect(near(m.spectral_bpm, 120)).toBe(true);
		expect(m.bpm == null || near(m.bpm, 120)).toBe(true);
	});

	test("pushSampleRgbMeta takes the same path", () => {
		const m = run(feed(72, 30, 30), 30, { rgbPulse: "pos", meta: true }).getMetrics();
		expect(near(m.bpm, 72)).toBe(true);
	});

	test("a camera slower than the processor was built for (20 a second into sampleRate 30) still reads", () => {
		for (const bpm of [50, 72, 120]) {
			const m = run(feed(bpm, 20, 30), 30).getMetrics();
			expect(near(m.spectral_bpm, bpm)).toBe(true);
			if (bpm < 110) expect(near(m.bpm, bpm)).toBe(true);
		}
	});

	test("the processor's window holds one quantity: no sample carries a raw colour level", () => {
		const trace = run(feed(72, 30, 10), 30).getTraceSnapshot(1000).points;
		expect(trace.length).toBe(300);
		expect(Math.max(...trace.map((x) => Math.abs(x.intensity)))).toBeLessThan(1);
	});

	test("an already-extracted signal (R = G = B) passes its own value and still reads", () => {
		const p = run(feed(72, 30, 30, { grey: true }), 30);
		for (const x of p.getTraceSnapshot(5).points) expect(x.intensity).toBe(x.g);
		expect(near(p.getMetrics().bpm, 72)).toBe(true);
	});

	test("resetCalibration starts the colour pulse afresh", () => {
		const p = run(feed(72, 30, 5), 30);
		p.resetCalibration();
		for (const x of feed(72, 30, 1).map((s) => ({ ...s, t: s.t + 10000 }))) {
			p.pushSampleRgb(x.t, x.r, x.g, x.b, 1);
		}
		const trace = p.getTraceSnapshot(1000).points;
		expect(trace.slice(-30, -21).map((x) => x.intensity)).toEqual(Array(9).fill(0));
	});
});

describe("processor colour path by default: unchanged", () => {
	test('left out or "chrom": raw green for the first nine samples, then channel gain and CHROM, value for value', () => {
		const samples = feed(72, 30, 5);
		const gain = new ChannelGainController();
		const chrom = new ChromPulseModel();
		const before = samples.map((x) => {
			const bal = gain.process(x.r, x.g, x.b);
			const v = chrom.process(bal.r, bal.g, bal.b);
			return !Number.isFinite(v) || Math.abs(v) < 1e-6 ? x.g : v;
		});
		for (const rgbPulse of [undefined, "chrom"] as const) {
			const trace = run(samples, 30, { rgbPulse }).getTraceSnapshot(1000).points;
			expect(trace.map((x) => x.intensity)).toEqual(before);
		}
		expect(before.slice(0, 9)).toEqual(samples.slice(0, 9).map((x) => x.g));
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

	test("designs its band-pass for the rate the samples arrive at", () => {
		const x = new RgbPulseExtractor();
		push(x, Array.from({ length: 60 }, (_, i) => i * 50));
		expect(x.filterRate).toBeCloseTo(20, 6);
	});

	test("takes the mean rate of a camera on a 16 ms clock, not the median interval", () => {
		// 32, 32, 48 ms repeating: mean 37.33 ms (26.8 a second), median 32 ms (31.25 a second).
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

	test("reset starts it afresh", () => {
		const x = new RgbPulseExtractor();
		push(x, Array.from({ length: 30 }, (_, i) => i * 33.3));
		x.reset();
		expect(x.filterRate).toBe(0);
		expect(push(x, Array.from({ length: 9 }, (_, i) => 5000 + i * 33.3))).toEqual(Array(9).fill(0));
	});
});
