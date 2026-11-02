import { RppgProcessor } from "../rppgProcessor";

// The Rust engine breaks once a frame time passes 2^30 ms (about 12.4 days of device uptime, the clock Android hands
// requestVideoFrameCallback): 32-bit time can no longer tell 15 fps frames apart and get_metrics traps ("unreachable").
// The owner's Android, 2026-11-02: every run failed after 9 to 13 frames at 1.139e9 ms; the same frames shifted below
// 2^30 run clean, and the previous day's good run traps once shifted above it. So the engine is handed times counted
// from its own pipeline's first sample.
function recordingBackend() {
	const times: number[] = [];
	const pipeline = () => ({
		push_sample_rgb_meta: (t: number) => times.push(Number(t)),
		push_sample: (t: number) => times.push(Number(t)),
		get_metrics: () => ({ bpm: null, confidence: 0, signal_quality: 0 }),
		free: () => {},
	});
	return { times, backend: { newPipeline: pipeline } };
}

describe("the engine's clock", () => {
	it("is handed small times however large the frame clock is, and starts again with each pipeline", () => {
		const { times, backend } = recordingBackend();
		const p = new RppgProcessor(backend as never, 30, 10, { respiration: false });
		const t0 = 1_139_124_495.167;
		for (let i = 0; i < 20; i++) p.pushSampleRgbMeta(t0 + i * 66.7, 0.4, 0.1, 0.05, 1, 0, 0);
		expect(Math.max(...times)).toBeLessThan(2 ** 30);
		// Spacing is kept to the millisecond.
		expect(Math.round(times[1] - times[0])).toBe(67);
		p.resetSignal();
		times.length = 0;
		p.pushSampleRgbMeta(t0 + 1e8, 0.4, 0.1, 0.05, 1, 0, 0);
		expect(times[0]).toBeLessThan(60_000);
	});
});
