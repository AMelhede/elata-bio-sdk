import {
	butterworthSos,
	cubicSplineNotAKnot,
	dejitterFrameTimes,
	hrvFromBeats,
	hrvFromRegions,
	HRV_GAP_MS,
	HRV_MIN_SNR_DB,
	sosFiltFilt,
	type HrvRegionFrame,
} from "../hrvTracking";
import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import { detectBeatsViaHilbertPhase, rmssdFromPeaks } from "../pulseAnalysis";
import { RecordingPulseCheck } from "../pulseCheckRecording";
import { pos, resample, detrend, OWN_PULSE_DETREND_S, OWN_PULSE_FS } from "../pulseCheckCore";

// A seeded generator, so every run draws the same noise.
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function gauss(r: () => number): number {
	return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/** Beat times (s): a 72 bpm rhythm swung by breathing (0.2 Hz, 12 a minute) plus a little beat-to-beat jitter. */
function beatTimes(seconds: number, seed: number): number[] {
	const r = rng(seed);
	const out = [0.3];
	while (out[out.length - 1] < seconds + 2) {
		const t = out[out.length - 1];
		out.push(t + 0.833 + 0.05 * Math.sin(2 * Math.PI * 0.2 * t) + 0.006 * gauss(r));
	}
	return out;
}
function trueRmssdMs(beats: number[], w0: number, w1: number): number {
	const ibi: number[] = [];
	for (let i = 1; i < beats.length; i++) {
		const mid = (beats[i] + beats[i - 1]) / 2;
		if (mid >= w0 && mid <= w1) ibi.push(beats[i] - beats[i - 1]);
	}
	let s = 0;
	for (let i = 1; i < ibi.length; i++) s += (ibi[i] - ibi[i - 1]) ** 2;
	return Math.sqrt(s / (ibi.length - 1)) * 1000;
}

/**
 * Three face regions on a camera: a pulse (cosine of the beat phase, small 2nd harmonic) mostly in green, white noise and
 * a slow drift (AR(1), 0.97 a frame) per channel, frames at `fps` read on a 16 ms tick clock (so intervals read 32 or
 * 48 ms), and optional holes.
 */
function synthetic(o: { seconds?: number; fps?: number; noise?: number; drift?: number; pulse?: number; seed?: number; holes?: [number, number][] } = {}) {
	const { seconds = 75, fps = 29.9, noise = 0.0003, drift = 0.00015, pulse = 0.002, seed = 1, holes = [] } = o;
	const beats = beatTimes(seconds, seed);
	const r = rng(seed + 100);
	const frames: HrvRegionFrame[] = [];
	let k = 0;
	const ar = new Array<number>(9).fill(0);
	for (let i = 0; i * (1 / fps) < seconds; i++) {
		const t = i / fps;
		if (holes.some(([a, b]) => t >= a && t < b)) continue;
		while (k < beats.length - 2 && beats[k + 1] <= t) k++;
		const ph = (2 * Math.PI * (t - beats[k])) / (beats[k + 1] - beats[k]);
		const p = pulse > 0 ? Math.cos(ph) + 0.3 * Math.cos(2 * ph - 0.6) : 0;
		const regions = [0, 1, 2].map((reg) => {
			const base = [150 + 10 * reg, 110 + 5 * reg, 90];
			const gain = [0.35, 1, 0.55];
			const c = base.map((b, c) => {
				ar[reg * 3 + c] = 0.97 * ar[reg * 3 + c] + drift * gauss(r);
				return b * (1 + pulse * gain[c] * p + noise * gauss(r) + ar[reg * 3 + c]);
			});
			return { r: c[0], g: c[1], b: c[2] };
		});
		const tickMs = Math.floor((t * 1000 + 3) / 16) * 16; // a 16 ms tick clock
		frames.push({ t: tickMs, regions });
	}
	return { frames, beats };
}

describe("filters and spline match scipy (the lab pipeline they port)", () => {
	it("butterworthSos + sosFiltFilt equals scipy's butter(4, [0.7, 3.5], 'band', fs=30) sosfiltfilt", () => {
		const x = Array.from({ length: 200 }, (_, n) => Math.sin(0.3 * n) + 0.5 * Math.cos(1.7 * n) + 0.01 * n);
		const y = sosFiltFilt(butterworthSos(4, [0.7, 3.5], 30), x);
		const want = [-0.059451999535, 0.0430172362, 0.632291547028, -0.98554679354, 0.231597454797];
		[0, 1, 50, 100, 199].forEach((i, j) => expect(y[i]).toBeCloseTo(want[j], 9));
	});
	it("a low-pass at 0.45 Hz on a 240 Hz grid equals scipy's butter(4, 0.45, fs=240) sosfiltfilt", () => {
		const x = Array.from({ length: 3000 }, (_, n) => Math.sin(0.01 * n) + Math.cos(0.2 * n));
		const y = sosFiltFilt(butterworthSos(4, 0.45, 240), x);
		const want = [1.7770186341, 1.707247950822, 0.510487655694, 0.567193624534];
		[0, 10, 1500, 2999].forEach((i, j) => expect(y[i]).toBeCloseTo(want[j], 8));
	});
	it("a not-a-knot cubic spline equals scipy's CubicSpline on uneven knots", () => {
		const t = [0, 0.3, 0.7, 1.2, 1.4, 2.0, 2.9];
		const v = t.map((q) => Math.sin(q * 2) + q);
		const got = cubicSplineNotAKnot(t, v, [0.1, 0.5, 1.3, 2.5, 2.85]);
		const want = [0.301660133233, 1.339601455029, 1.815028331573, 1.420859555858, 2.252732737764];
		got.forEach((g, j) => expect(g).toBeCloseTo(want[j], 10));
	});
});

describe("dejitterFrameTimes", () => {
	it("puts frames read on a 16 ms tick clock back on the camera's own steady clock", () => {
		const fps = 29.9;
		const real = Array.from({ length: 900 }, (_, i) => 5000 + (i * 1000) / fps);
		const ticks = real.map((t) => Math.floor(t / 16) * 16);
		const out = dejitterFrameTimes(ticks);
		const err = out.map((t, i) => t - real[i]);
		const mean = err.reduce((a, b) => a + b, 0) / err.length;
		const worst = Math.max(...err.slice(60, -60).map((e) => Math.abs(e - mean)));
		expect(worst).toBeLessThan(2); // the ticks themselves are up to 16 ms out
	});
	it("keeps a dropped frame a gap of whole frame periods", () => {
		const t = [0, 33, 67, 100, 200, 233, 267, 300, 333, 367, 400, 433, 467, 500];
		const out = dejitterFrameTimes(t, 30);
		expect(out[4] - out[3]).toBeGreaterThan(90);
	});
});

describe("hrvFromBeats: intervals, the local-median correction, gaps", () => {
	const steady = Array.from({ length: 80 }, (_, i) => i * 800 + (i % 2 ? 20 : 0)); // alternating 820/780 ms
	it("rMSSD from adjacent kept pairs and SDNN from kept intervals", () => {
		const h = hrvFromBeats(steady, [], 0, 64000);
		expect(h.rmssdMs).toBeCloseTo(40, 6);
		expect(h.sdnnMs).toBeGreaterThan(19);
		expect(h.sdnnMs).toBeLessThan(21);
	});
	it("drops every interval touching a frame gap over 90 ms, and the pairs that hold it", () => {
		const gap: [number, number] = [20_300, 20_300 + HRV_GAP_MS + 60]; // inside the interval 20020 to 20800 only
		const h = hrvFromBeats(steady, [gap], 0, 64000);
		const none = hrvFromBeats(steady, [], 0, 64000);
		expect(h.kept).toBe(none.kept - 1);
		expect(h.pairs).toBe(none.pairs - 2);
	});
	it("drops an interval 20% off the local median (a missed beat)", () => {
		const missed = steady.filter((_, i) => i !== 40);
		const h = hrvFromBeats(missed, [], 0, 64000);
		expect(h.kept).toBe(hrvFromBeats(steady, [], 0, 64000).kept - 2);
		expect(h.rmssdMs).toBeCloseTo(40, 6);
	});
	it("gives no rMSSD under 5 pairs and no SDNN under 6 intervals", () => {
		const h = hrvFromBeats(steady.slice(0, 6), [], 0, 64000);
		expect(h.rmssdMs).toBeNull();
		expect(h.sdnnMs).toBeNull();
	});
});

describe("hrvFromRegions: the camera beat timer", () => {
	/** The shipped path on the same frames: each region's POS pulse at the analysis rate (library resample, POS,
	 * detrend), unit sd, summed; Hilbert phase around the rate; the peak-based RMSSD over the same 60 s. */
	function shippedRmssd(frames: HrvRegionFrame[], end: number): number | null {
		const t = frames.map((f) => f.t / 1000);
		let sum: number[] | null = null;
		for (let reg = 0; reg < 3; reg++) {
			const ch = (["r", "g", "b"] as const).map((c) => resample(t, frames.map((f) => f.regions[reg][c]), t[0], t[t.length - 1]));
			const p = detrend(pos(ch[0], ch[1], ch[2]), OWN_PULSE_DETREND_S);
			const m = p.reduce((a, b) => a + b, 0) / p.length;
			const sd = Math.sqrt(p.reduce((a, b) => a + (b - m) ** 2, 0) / p.length) || 1;
			const u = p.map((v) => (v - m) / sd);
			sum = sum ? sum.map((v, i) => v + u[i]) : u;
		}
		const pts = (sum as number[]).map((value, i) => ({ value, time: t[0] * 1000 + (i * 1000) / OWN_PULSE_FS }));
		const inWin = pts.filter((p) => p.time >= end - 60000 && p.time <= end);
		return rmssdFromPeaks(
			detectBeatsViaHilbertPhase(inWin, { sampleRate: OWN_PULSE_FS, centerBpm: 72 }).beatTimesMs.map((time) => ({ time, value: 1 })),
		);
	}
	const runs = [3, 4, 5].map((seed) => {
		const { frames, beats } = synthetic({ seed });
		const end = frames[frames.length - 1].t - 1000;
		const truth = trueRmssdMs(beats, (end - 60000) / 1000, end / 1000);
		return { truth, h: hrvFromRegions(frames, { windowEndMs: end, windowS: 60 }), old: shippedRmssd(frames, end) as number };
	});
	it("recovers rMSSD within 20% on a noisy, drifting three-region pulse read on a jittery clock (three seeds)", () => {
		for (const { truth, h } of runs) {
			expect(h.snrDb as number).toBeGreaterThanOrEqual(HRV_MIN_SNR_DB);
			expect(h.rmssdMs).not.toBeNull();
			expect(Math.abs((h.rmssdMs as number) - truth)).toBeLessThan(0.2 * truth);
			expect(h.sdnnMs).not.toBeNull();
			expect(h.centreBpm).toBeGreaterThan(68);
			expect(h.centreBpm).toBeLessThan(76);
		}
	});
	it("where the shipped Hilbert-phase path on the same frames reads high: the new mean bias under half its", () => {
		const bias = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r) - r.truth, 0) / runs.length;
		const oldBias = bias((r) => r.old);
		expect(oldBias).toBeGreaterThan(0);
		expect(Math.abs(bias((r) => r.h.rmssdMs as number))).toBeLessThan(0.5 * oldBias);
		// The worst seed: the shipped path over 30% high, the new timer within 20%.
		expect(runs[1].old - runs[1].truth).toBeGreaterThan(0.3 * runs[1].truth);
	});
	it("drops the intervals across a hole in the frames over 90 ms", () => {
		const whole = synthetic({ seed: 5 });
		const holed = synthetic({ seed: 5, holes: [[40, 40.4]] });
		const end = whole.frames[whole.frames.length - 1].t - 1000;
		const a = hrvFromRegions(whole.frames, { windowEndMs: end });
		const b = hrvFromRegions(holed.frames, { windowEndMs: end });
		expect(b.intervals - b.kept).toBeGreaterThanOrEqual(a.intervals - a.kept + 1);
	});
	it("the SNR gate gives no HRV on noise", () => {
		const { frames } = synthetic({ pulse: 0, seed: 7 });
		const h = hrvFromRegions(frames, { windowEndMs: frames[frames.length - 1].t - 1000 });
		expect(h.snrDb as number).toBeLessThan(HRV_MIN_SNR_DB);
		expect(h.gated).toBe(true);
		expect(h.rmssdMs).toBeNull();
		expect(h.sdnnMs).toBeNull();
	});
	it("gives nothing when the frames do not cover the window and its lead", () => {
		const { frames } = synthetic({ seconds: 40 });
		const h = hrvFromRegions(frames, { windowS: 60 });
		expect(h.rmssdMs).toBeNull();
		expect(h.reason).toBe("short");
	});
});

describe("the runner feeds the timer the pulse check's own regions", () => {
	const W = 160;
	const H = 120;
	const MESH = Array.from({ length: 478 }, (_, i) => ({ x: 0.35 + 0.3 * ((i % 22) / 21), y: 0.25 + 0.55 * (Math.floor(i / 22) / 21), z: 0 }));
	const ROIS = [
		{ x: 72, y: 36, w: 16, h: 8 },
		{ x: 62, y: 60, w: 10, h: 10 },
		{ x: 88, y: 60, w: 10, h: 10 },
	];
	const frameAt = (t: number): Frame => {
		const data = new Uint8ClampedArray(W * H * 4);
		const g = Math.round(120 + 3 * Math.sin((2 * Math.PI * 70 * t) / 60000));
		for (let i = 0; i < W * H; i++) data.set([200, g, 100, 255], 4 * i);
		return { data, width: W, height: H, timestampMs: t, rois: ROIS, landmarks: MESH } as Frame;
	};
	class Source implements FrameSource {
		onFrame: ((frame: Frame) => void) | null = null;
		async start(): Promise<void> {}
		async stop(): Promise<void> {}
	}
	const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: () => ({ bpm: 70, confidence: 0.6, signal_quality: 0.5 }), getBackendFailure: () => null, reset: jest.fn(), resetSignal: jest.fn() };
	it("same frames, same three boxes; nothing without a pulse check", async () => {
		const rec = new RecordingPulseCheck();
		const fed: [number, { r: number; g: number; b: number }[]][] = [];
		const hrvRegions = { push: (t: number, regions: readonly { r: number; g: number; b: number }[]) => void fed.push([t, regions.map((q) => ({ ...q }))]) };
		const source = new Source();
		const runner = new DemoRunner(source, proc as never, { pulseChecker: rec, hrvRegions, sampleRate: 30, useSkinMask: true, requireFace: true });
		await runner.start();
		for (let t = 0; t < 1000; t += 33) source.onFrame?.(frameAt(t));
		await runner.stop();
		const events = rec.getRecording().events.filter((e) => e[0] === "f") as unknown as [string, number, number[][]][];
		expect(fed.length).toBe(events.length);
		expect(fed.length).toBeGreaterThan(20);
		fed.forEach(([t, regions], i) => {
			expect(t).toBe(events[i][1]);
			regions.forEach((q, j) => expect([q.r, q.g, q.b].map((v) => Math.round(v * 1e6))).toEqual(events[i][2][j].map((v) => Math.round(v * 1e6))));
		});
		const alone: unknown[] = [];
		const s2 = new Source();
		const r2 = new DemoRunner(s2, proc as never, { hrvRegions: { push: () => void alone.push(1) }, sampleRate: 30, useSkinMask: true, requireFace: true });
		await r2.start();
		for (let t = 0; t < 500; t += 33) s2.onFrame?.(frameAt(t));
		await r2.stop();
		expect(alone.length).toBe(0);
	});
});
