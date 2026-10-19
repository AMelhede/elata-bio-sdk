import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import { RppgProcessor } from "../rppgProcessor";

// A known answer through the real processor: a 66 bpm colour pulse with the face in view
// throughout, and a break in the frames: the camera sends nothing for a while (a frozen driver, a
// hidden tab, a locked screen), or the frame clock steps back (a looping video). The processor
// estimates its sample rate as samples over time spanned, so a window across the break reads every
// rate wrong for as long as the break stays in its 45 s history (measured before the fix: 66 read
// 51 for 35 s after a 10 s freeze, 63 for 43 s after a 2 s one, and 189 falling to 111, wrong for
// 75 s, after the clock went back 30 s).
const TRUE_BPM = 66;

class Source implements FrameSource {
	onFrame: ((f: Frame) => void) | null = null;
	async start() {}
	async stop() {}
	emit(f: Frame) {
		this.onFrame?.(f);
	}
}

function frame(tMs: number, phaseMs: number, seed: { v: number }, regions: boolean): Frame {
	const width = 20;
	const height = 20;
	const data = new Uint8ClampedArray(width * height * 4);
	const p = Math.sin((2 * Math.PI * TRUE_BPM * phaseMs) / 60000);
	const a = 0.03;
	const dither = () => {
		seed.v = (seed.v * 1664525 + 1013904223) >>> 0;
		return seed.v / 2 ** 32 - 0.5;
	};
	for (let i = 0; i < data.length; i += 4) {
		data[i] = 200 * (1 - 0.33 * a * p) + dither();
		data[i + 1] = 140 * (1 - a * p) + dither();
		data[i + 2] = 110 * (1 - 0.5 * a * p) + dither();
		data[i + 3] = 255;
	}
	const f: Frame = { data, width, height, timestampMs: tMs, roi: { x: 5, y: 5, w: 10, h: 10 } };
	// Forehead and both cheeks, as MediaPipeFaceFrameSource sends them with a face.
	if (regions)
		f.rois = [
			{ x: 6, y: 3, w: 8, h: 5 },
			{ x: 3, y: 10, w: 6, h: 6 },
			{ x: 11, y: 10, w: 6, h: 6 },
		];
	return f;
}

type Break = { kind: "gap"; ms: number } | { kind: "back"; ms: number };

/** 45 s of frames, the break, then 20 s more; the rate just before the break and at the end. */
async function across(brk: Break, opts: { regions?: boolean; fixes?: { noFramesNoReading: boolean } } = {}) {
	const pipeline = {
		push_sample: jest.fn(),
		push_sample_rgb_meta: jest.fn(),
		free: jest.fn(),
		get_metrics: jest.fn(() => ({ bpm: null, confidence: 0, signal_quality: 0.5, reason_codes: [] })),
	};
	const newPipeline = jest.fn(() => pipeline);
	const processor = new RppgProcessor({ newPipeline } as never, 30, 10);
	const src = new Source();
	const runner = new DemoRunner(src, processor, { sampleRate: 30, requireFace: true, fixes: opts.fixes });
	await runner.start();
	const seed = { v: 1 };
	const step = 1000 / 30;
	let before: number | null = null;
	for (let i = 0; i * step < 45000; i++) src.emit(frame(i * step, i * step, seed, opts.regions === true));
	before = processor.getMetrics().spectral_bpm ?? null;
	const resume = brk.kind === "gap" ? 45000 + brk.ms : 45000 - brk.ms;
	for (let i = 0; i * step < 20000; i++) {
		// The pulse goes on in real time; only the clock the frames carry breaks.
		const real = 45000 + (brk.kind === "gap" ? brk.ms : 0) + i * step;
		src.emit(frame(resume + i * step, real, seed, opts.regions === true));
	}
	const after = processor.getMetrics().spectral_bpm ?? null;
	return { before, after, pipelinesStarted: newPipeline.mock.calls.length, runner };
}

const near = (v: number | null) => v != null && Math.abs(v - TRUE_BPM) <= 3;

describe("DemoRunner and RppgProcessor across a break in the frames", () => {
	test.each([false, true])(
		"after frames stop for 10 s, the rate is measured on frames from after the gap (regions %s)",
		async (regions) => {
			const r = await across({ kind: "gap", ms: 10000 }, { regions });
			// The fixture reads its own rate when nothing is missing, so the check below can fail.
			expect(near(r.before)).toBe(true);
			expect(r.after).not.toBeNull();
			expect(near(r.after)).toBe(true);
			// The engine's own window starts afresh too.
			expect(r.pipelinesStarted).toBe(2);
		},
	);

	test("after the frame clock steps back 30 s (a looping video), the rate is measured afresh", async () => {
		const r = await across({ kind: "back", ms: 30000 });
		expect(near(r.before)).toBe(true);
		expect(near(r.after)).toBe(true);
		expect(r.pipelinesStarted).toBe(2);
	});

	test("a frame out of order by under a second (one re-delivered stale frame) is dropped, not a restart", async () => {
		const pipeline = {
			push_sample: jest.fn(),
			push_sample_rgb_meta: jest.fn(),
			free: jest.fn(),
			get_metrics: jest.fn(() => ({ bpm: null, confidence: 0, signal_quality: 0.5, reason_codes: [] })),
		};
		const newPipeline = jest.fn(() => pipeline);
		const processor = new RppgProcessor({ newPipeline } as never, 30, 10);
		const src = new Source();
		const runner = new DemoRunner(src, processor, { sampleRate: 30, requireFace: true });
		await runner.start();
		const seed = { v: 5 };
		const step = 1000 / 30;
		for (let i = 0; i * step < 45000; i++) {
			src.emit(frame(i * step, i * step, seed, false));
			// Two older-by-one-frame repeats, as an older step-mode run delivered (11500 then 11458).
			if (i === 600 || i === 900) src.emit(frame((i - 1.25) * step, (i - 1.25) * step, seed, false));
		}
		expect(newPipeline).toHaveBeenCalledTimes(1);
		expect(runner.msSinceAnalysisRestart()).toBeNull();
		expect(runner.getDiagnostics().droppedFrames).toBe(2);
		expect(near(processor.getMetrics().spectral_bpm ?? null)).toBe(true);
	});

	test("a face out of view stays out of view across a step back of the clock", async () => {
		const processor = new RppgProcessor({ newPipeline: () => ({ push_sample: jest.fn(), push_sample_rgb_meta: jest.fn(), free: jest.fn(), get_metrics: jest.fn(() => ({ bpm: null, confidence: 0, signal_quality: 0, reason_codes: [] })) }) } as never, 30, 10);
		const src = new Source();
		const runner = new DemoRunner(src, processor, { sampleRate: 30, requireFace: true });
		await runner.start();
		const seed = { v: 9 };
		const empty = (t: number): Frame => {
			const f = frame(t, t, seed, false);
			delete f.roi;
			return f;
		};
		for (let t = 0; t < 3000; t += 1000 / 30) src.emit(empty(t));
		expect(runner.faceAbsentMs()).toBeGreaterThanOrEqual(2900);
		src.emit(empty(500));
		expect(runner.faceAbsentMs()).toBeGreaterThanOrEqual(2900);
	});

	test("a gap of half a second (a dropped frame or two) does not restart the analysis", async () => {
		const r = await across({ kind: "gap", ms: 500 });
		expect(near(r.after)).toBe(true);
		expect(r.pipelinesStarted).toBe(1);
		expect(r.runner.msSinceAnalysisRestart()).toBeNull();
	});

	test("switch noFramesNoReading off: the window spans the gap, as published", async () => {
		const r = await across({ kind: "gap", ms: 10000 }, { fixes: { noFramesNoReading: false } });
		expect(near(r.before)).toBe(true);
		expect(r.pipelinesStarted).toBe(1);
		// 35 of the 45 s window hold frames: 66 reads as about 51.
		expect(r.after).toBeLessThan(55);
	});
});
