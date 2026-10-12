import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import { RppgProcessor } from "../rppgProcessor";

// A known answer through the real processor: a 66 bpm colour pulse, the face gone for 10 s, then
// back. The processor estimates its sample rate as samples over time spanned, so a window that
// holds frames from both sides of a hole counts the hole as frames and scales every rate by the
// share of the window that has frames (35 of 45 s here: 66 reads as about 51).
const TRUE_BPM = 66;

class Source implements FrameSource {
	onFrame: ((f: Frame) => void) | null = null;
	async start() {}
	async stop() {}
	emit(f: Frame) {
		this.onFrame?.(f);
	}
}

function frame(tMs: number, face: boolean, seed: { v: number }, regions = false): Frame {
	const width = 20;
	const height = 20;
	const data = new Uint8ClampedArray(width * height * 4);
	const p = Math.sin((2 * Math.PI * TRUE_BPM * tMs) / 60000);
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
	const f: Frame = { data, width, height, timestampMs: tMs };
	if (face) f.roi = { x: 5, y: 5, w: 10, h: 10 };
	// Forehead and both cheeks, as MediaPipeFaceFrameSource sends them with a face.
	if (face && regions)
		f.rois = [
			{ x: 6, y: 3, w: 8, h: 5 },
			{ x: 3, y: 10, w: 6, h: 6 },
			{ x: 11, y: 10, w: 6, h: 6 },
		];
	return f;
}

describe("DemoRunner and RppgProcessor across a face gap", () => {
	test("the rate after the face returns is measured on frames from after the gap", async () => {
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
		const seed = { v: 1 };
		let beforeGap: number | null = null;
		for (let i = 0; i < 75 * 30; i++) {
			const t = (i * 1000) / 30;
			src.emit(frame(t, t < 45000 || t >= 55000, seed));
			if (beforeGap == null && t >= 44000) beforeGap = processor.getMetrics().spectral_bpm ?? null;
		}
		// The fixture reads its own rate when nothing is missing, so the check below can fail.
		expect(beforeGap).not.toBeNull();
		expect(Math.abs((beforeGap as number) - TRUE_BPM)).toBeLessThanOrEqual(3);
		const after = processor.getMetrics().spectral_bpm ?? null;
		expect(after).not.toBeNull();
		expect(Math.abs((after as number) - TRUE_BPM)).toBeLessThanOrEqual(3);
		// The engine's own window starts afresh too.
		expect(newPipeline).toHaveBeenCalledTimes(2);
	});
});

describe("DemoRunner and RppgProcessor across a face gap, multi-region path", () => {
	test("the fused rate after the gap is measured on frames from after it, and so are the region weights", async () => {
		const pipeline = {
			push_sample: jest.fn(),
			push_sample_rgb_meta: jest.fn(),
			free: jest.fn(),
			get_metrics: jest.fn(() => ({ bpm: null, confidence: 0, signal_quality: 0.5, reason_codes: [] })),
		};
		const processor = new RppgProcessor({ newPipeline: () => pipeline } as never, 30, 10);
		const src = new Source();
		// The default with a face: the multi-region fuser and the skin mask on.
		const runner = new DemoRunner(src, processor, { sampleRate: 30, requireFace: true });
		await runner.start();
		const seed = { v: 3 };
		let beforeGap: number | null = null;
		let snrBeforeGap = 0;
		let snrJustAfter: number | null = null;
		for (let i = 0; i < 75 * 30; i++) {
			const t = (i * 1000) / 30;
			src.emit(frame(t, t < 45000 || t >= 55000, seed, true));
			if (beforeGap == null && t >= 44000) {
				beforeGap = processor.getMetrics().spectral_bpm ?? null;
				snrBeforeGap = runner.getDiagnostics().lastFusedSnr ?? 0;
			}
			// One second after the face returns: too soon for the fuser to have measured an SNR
			// on frames from after the gap (it needs three seconds of them).
			if (snrJustAfter == null && t >= 56000) snrJustAfter = runner.getDiagnostics().lastFusedSnr ?? 0;
		}
		expect(runner.getDiagnostics().lastProcessorMethod).toBe("fused");
		expect(snrBeforeGap).toBeGreaterThan(1);
		expect(snrJustAfter).toBe(0);
		expect(beforeGap).not.toBeNull();
		expect(Math.abs((beforeGap as number) - TRUE_BPM)).toBeLessThanOrEqual(3);
		const after = processor.getMetrics().spectral_bpm ?? null;
		expect(after).not.toBeNull();
		expect(Math.abs((after as number) - TRUE_BPM)).toBeLessThanOrEqual(3);
	});
});

describe("RppgSession with the real processor and no face in view", () => {
	test("no face for two seconds means no reading; a shorter loss holds it; the face back reads again", async () => {
		const pipeline = {
			push_sample: jest.fn(),
			push_sample_rgb_meta: jest.fn(),
			free: jest.fn(),
			get_metrics: jest.fn(() => ({ bpm: 72, confidence: 0.8, signal_quality: 0.7, reason_codes: ["LOW_SNR"] })),
		};
		const processor = new RppgProcessor({ newPipeline: () => pipeline } as never, 30, 10);
		const src = new Source();
		const runner = new DemoRunner(src, processor, { sampleRate: 30, requireFace: true });
		const { RppgSession } = await import("../rppgSession");
		const session = new RppgSession(src, processor, runner, "wasm", "face_mesh");
		await runner.start();
		const seed = { v: 7 };
		let t = 0;
		for (let i = 0; i < 90; i++, t += 1000 / 30) src.emit(frame(t, true, seed));
		const pushedWithFace = pipeline.push_sample_rgb_meta.mock.calls.length;
		const before = session.getMetrics().bpm;
		expect(before).not.toBeNull();
		for (let i = 0; i < 45; i++, t += 1000 / 30) src.emit(frame(t, false, seed));
		// A face lost for 1.5 s (a turn of the head, a burst of finder misses) is held, not reset:
		// on moving heads a restart there showed wrong numbers for about 5 s afterwards.
		expect(session.getMetrics().bpm).toBe(before);
		for (let i = 0; i < 30; i++, t += 1000 / 30) src.emit(frame(t, false, seed));
		const gone = session.getMetrics();
		expect(gone.bpm).toBeNull();
		expect(gone.confidence).toBe(0);
		expect(gone.reason_codes).toEqual(["LOW_SNR", "no_face"]);
		expect(pipeline.push_sample_rgb_meta.mock.calls.length).toBe(pushedWithFace);
		src.emit(frame(t, true, seed));
		expect(session.getMetrics().reason_codes).not.toContain("no_face");
	});
});
