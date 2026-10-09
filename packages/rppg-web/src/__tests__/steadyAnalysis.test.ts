import { ANALYSIS_EVERY_MS } from "../processorWorkerProtocol";
import { RppgProcessor } from "../rppgProcessor";

// The analysis is run at most once per ANALYSIS_EVERY_MS of sample time, however often it is read. Published,
// every read ran it again: the rate tracker took the same window once per read, so the reported rate depended on
// how often an app (or the library's own diagnostics, on every camera frame) asked for it.

/** A core whose every analysis is counted, and whose answer says which analysis it was. */
function countingBackend() {
	const counter = { analyses: 0 };
	const pipeline = {
		push_sample_rgb_meta: () => undefined,
		push_sample_rgb: () => undefined,
		push_sample: () => undefined,
		get_metrics: () => {
			counter.analyses += 1;
			return { bpm: 60 + counter.analyses, confidence: 0.8, signal_quality: 0.7 };
		},
	};
	return { backend: { newPipeline: () => pipeline }, counter };
}

function feed(p: RppgProcessor, fromMs: number, toMs: number, fps: number, onFrame?: (ts: number) => void) {
	for (let ts = fromMs; ts < toMs; ts += 1000 / fps) {
		p.pushSampleRgbMeta(ts, 120, 100, 90, 0.8, 0.01, 0.0);
		onFrame?.(ts);
	}
}

describe("switch steadyAnalysis", () => {
	test("reading on every frame analyses once per step of sample time, not once per read", () => {
		const { backend, counter } = countingBackend();
		const p = new RppgProcessor(backend, 30, 10);
		feed(p, 1000, 3000, 30, () => p.getMetrics());
		expect(counter.analyses).toBe(Math.ceil(2000 / ANALYSIS_EVERY_MS));
	});

	test("a step is exactly ANALYSIS_EVERY_MS: at 40 frames a second, one analysis every 10th frame", () => {
		const { backend, counter } = countingBackend();
		const p = new RppgProcessor(backend, 30, 10);
		const changedAt: number[] = [];
		let prev: number | null | undefined;
		let frame = 0;
		feed(p, 1000, 3000, 40, () => {
			const bpm = p.getMetrics().bpm;
			if (bpm !== prev) changedAt.push(frame);
			prev = bpm;
			frame += 1;
		});
		expect(counter.analyses).toBe(2000 / ANALYSIS_EVERY_MS);
		expect(changedAt).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
	});

	test("two reads in a row give one analysis and the same answer", () => {
		const { backend, counter } = countingBackend();
		const p = new RppgProcessor(backend, 30, 10);
		feed(p, 1000, 1500, 30);
		const a = p.getMetrics();
		const b = p.getMetrics();
		const d = p.getDebugSnapshot(0).backendMetrics;
		expect(counter.analyses).toBe(1);
		expect(b.bpm).toBe(a.bpm);
		expect(d.bpm).toBe(a.bpm);
	});

	test("the answer does not depend on how often it is read", () => {
		const once = countingBackend();
		const often = countingBackend();
		const p1 = new RppgProcessor(once.backend, 30, 10);
		const p2 = new RppgProcessor(often.backend, 30, 10);
		const seen1: (number | null | undefined)[] = [];
		const seen2: (number | null | undefined)[] = [];
		let last1 = -Infinity;
		feed(p1, 1000, 4000, 30, (ts) => {
			if (ts - last1 >= ANALYSIS_EVERY_MS) {
				seen1.push(p1.getMetrics().bpm);
				last1 = ts;
			}
		});
		let last2 = -Infinity;
		feed(p2, 1000, 4000, 30, (ts) => {
			const m = p2.getMetrics();
			p2.getMetrics();
			if (ts - last2 >= ANALYSIS_EVERY_MS) {
				seen2.push(m.bpm);
				last2 = ts;
			}
		});
		expect(seen2).toEqual(seen1);
	});

	test("a reset, a recalibration or a loaded state is never answered from before it", () => {
		for (const act of [
			(p: RppgProcessor) => p.enableTracker(),
			(p: RppgProcessor) => p.resetCalibration(),
			(p: RppgProcessor) => p.loadStateSnapshot({}),
			(p: RppgProcessor) => p.updateMuseMetrics(70, 0.9, 1400),
		]) {
			const { backend, counter } = countingBackend();
			const p = new RppgProcessor(backend, 30, 10);
			feed(p, 1000, 1500, 30);
			p.getMetrics();
			act(p);
			p.getMetrics();
			expect(counter.analyses).toBe(2);
		}
	});

	test("capture confidence is read fresh between analyses", () => {
		const { backend } = countingBackend();
		const p = new RppgProcessor(backend, 30, 10);
		feed(p, 1000, 1500, 30);
		p.getMetrics();
		p.pushCaptureFrame({ motion: 0.9, clipRatio: 0.5, skinRatio: 0.1, meanLuma: 0.05, faceBox: null });
		const m = p.getMetrics();
		expect(m.capture_confidence).toBe(p.getCaptureConfidence()?.score);
	});

	test("off: every read analyses again, as published", () => {
		const { backend, counter } = countingBackend();
		const p = new RppgProcessor(backend, 30, 10, { fixes: { steadyAnalysis: false } });
		feed(p, 1000, 3000, 30, () => p.getMetrics());
		expect(counter.analyses).toBe(60);
	});
});
