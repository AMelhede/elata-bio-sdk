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

function frame(tMs: number, face: boolean, seed: { v: number }): Frame {
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

describe("RppgSession with the real processor and no face in view", () => {
	test("no face for a second means no reading; a brief miss holds it; the face back reads again", async () => {
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
		for (let i = 0; i < 15; i++, t += 1000 / 30) src.emit(frame(t, false, seed));
		// Under a second: a brief face-finder miss, the reading is held.
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
