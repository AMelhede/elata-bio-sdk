import { BpmBayesTracker } from "../bpmBayesTracker";
import { RppgProcessor } from "../rppgProcessor";

// getMetrics() ran the engine's whole legacy estimate (window analysis, the Bayes rate tracker's O(n^2) prior step,
// the rate history and fusion updates) on EVERY call, whatever enableTracker said. A page polling 13 to 17 times a
// second paid for it 3.6 times per camera frame (measured 2026-10-27 in Chromium: 1,409 runs for 388 frames, 31.8% of
// all CPU in the tracker's prior step), and the legacy output itself moved with the polling rate because each call
// pushed to the rate history. The pulse check never reads it. It now runs once per new set of samples, and again only
// when another input to it changes (a Muse reading, a reset).

const fs = 30;
const backend = {
	newPipeline: () => ({
		push_sample: () => {},
		get_metrics: () => ({ bpm: 70, confidence: 0.8, signal_quality: 0.8, snr: 3 }),
	}),
};

function withSamples(n: number) {
	const p = new RppgProcessor(backend as any, fs, 10);
	for (let i = 0; i < n; i++) p.pushSample((i * 1000) / fs, Math.sin((2 * Math.PI * 70 * i) / (60 * fs)));
	return p;
}

describe("the legacy estimate runs once per new set of samples", () => {
	let update: jest.SpyInstance;
	beforeEach(() => {
		update = jest.spyOn(BpmBayesTracker.prototype, "update");
	});
	afterEach(() => update.mockRestore());

	test("polling without new samples does not rerun it, and returns the same metrics", () => {
		const p = withSamples(fs * 8);
		const first = p.getMetrics();
		const runs = update.mock.calls.length;
		expect(runs).toBe(1);
		for (let i = 0; i < 10; i++) expect(p.getMetrics()).toEqual(first);
		expect(update.mock.calls.length).toBe(runs);
	});

	test("a new sample reruns it once", () => {
		const p = withSamples(fs * 8);
		p.getMetrics();
		p.pushSample((fs * 8 * 1000) / fs, 0.1);
		p.getMetrics();
		p.getMetrics();
		expect(update.mock.calls.length).toBe(2);
	});

	test("a Muse reading reruns it (it moves the fused rate), a reset does too", () => {
		const p = withSamples(fs * 8);
		p.getMetrics();
		p.updateMuseMetrics(72, 0.9, 5000);
		p.getMetrics();
		expect(update.mock.calls.length).toBe(2);
		p.resetCalibration();
		p.getMetrics();
		expect(update.mock.calls.length).toBe(3);
	});
});
