import { ANALYSIS_EVERY_MS } from "../processorWorkerProtocol";
import { analyzePulseWindow } from "../pulseAnalysis";
import { RppgProcessor } from "../rppgProcessor";

// The window analysis (spectrum, autocorrelation, beat timing, breathing) is a pure function of the samples in the
// window, so a second analysis of the same samples reuses the first instead of computing it again. Every number is
// the same; the time is not. The rate trackers downstream still take the window as often as before.

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

jest.mock("../pulseAnalysis", () => {
	const actual = jest.requireActual("../pulseAnalysis");
	return {
		...actual,
		// Counted, and frozen: anything downstream that changed a result would throw here.
		analyzePulseWindow: jest.fn((...args: Parameters<typeof actual.analyzePulseWindow>) =>
			deepFreeze(actual.analyzePulseWindow(...args)),
		),
	};
});

const actualAnalyze: typeof analyzePulseWindow = jest.requireActual("../pulseAnalysis").analyzePulseWindow;
const analyzeMock = analyzePulseWindow as jest.MockedFunction<typeof analyzePulseWindow>;

function stubBackend() {
	const counter = { reads: 0 };
	const pipeline = {
		push_sample_rgb_meta: () => undefined,
		push_sample_rgb: () => undefined,
		push_sample: () => undefined,
		get_metrics: () => {
			counter.reads += 1;
			return { bpm: 72, confidence: 0.8, signal_quality: 0.7, snr: 3 };
		},
	};
	return { backend: { newPipeline: () => pipeline }, counter };
}

/** A face at 72 bpm: green falls with each beat, red and blue barely move, plus a little noise. */
function feedPulse(p: RppgProcessor, fromMs: number, toMs: number, fps: number, onFrame?: (ts: number) => void) {
	let seed = 11;
	const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.4;
	for (let ts = fromMs; ts < toMs; ts += 1000 / fps) {
		const beat = Math.sin((2 * Math.PI * 1.2 * ts) / 1000);
		p.pushSampleRgbMeta(ts, 150 + 0.3 * beat + noise(), 110 - 1.5 * beat + noise(), 95 + 0.2 * beat + noise(), 0.9, 0.01, 0);
		onFrame?.(ts);
	}
}

beforeEach(() => analyzeMock.mockClear());

describe("window analysis reuse", () => {
	test("with steadyAnalysis, the window is analysed once per step; the core is still read twice", () => {
		const { backend, counter } = stubBackend();
		const p = new RppgProcessor(backend, 30, 10);
		feedPulse(p, 0, 3000, 30);
		analyzeMock.mockClear();
		feedPulse(p, 3000, 5000, 30, () => p.getMetrics());
		const steps = Math.ceil(2000 / ANALYSIS_EVERY_MS);
		expect(analyzeMock).toHaveBeenCalledTimes(steps);
		expect(counter.reads).toBe(2 * steps);
	});

	test("without steadyAnalysis, two reads of the same samples analyse the window once", () => {
		const { backend, counter } = stubBackend();
		const p = new RppgProcessor(backend, 30, 10, { fixes: { steadyAnalysis: false } });
		feedPulse(p, 0, 3000, 30);
		analyzeMock.mockClear();
		let frames = 0;
		feedPulse(p, 3000, 4000, 30, () => {
			p.getMetrics();
			p.getDebugSnapshot(0);
			frames += 1;
		});
		expect(analyzeMock).toHaveBeenCalledTimes(frames);
		expect(counter.reads).toBe(2 * frames);
	});

	test("a new sample is a new window: the kept analysis is never reused across it", () => {
		const { backend } = stubBackend();
		const p = new RppgProcessor(backend, 30, 10, { fixes: { steadyAnalysis: false } });
		feedPulse(p, 0, 3000, 30);
		p.getMetrics();
		analyzeMock.mockClear();
		feedPulse(p, 3000, 3034, 30);
		p.getMetrics();
		expect(analyzeMock).toHaveBeenCalledTimes(1);
	});

	test("the kept analysis equals analysing the window again, at every step of a 40 s capture", () => {
		const { backend } = stubBackend();
		const p = new RppgProcessor(backend, 30, 10);
		const internals = p as unknown as {
			samples: Parameters<typeof analyzePulseWindow>[0];
			samplesVersion: number;
			windowAnalysis: { version: number; result: ReturnType<typeof analyzePulseWindow> } | null;
		};
		let checked = 0;
		let withRate = 0;
		let lastCheck = -Infinity;
		feedPulse(p, 0, 40000, 30, (ts) => {
			p.getMetrics();
			// Only where the kept analysis is of the samples as they stand (a step just ran), once a second.
			if (internals.windowAnalysis?.version !== internals.samplesVersion || ts - lastCheck < 1000) return;
			lastCheck = ts;
			const fresh = actualAnalyze(internals.samples, { doublingRule: false });
			expect(internals.windowAnalysis?.result).toEqual(fresh);
			checked += 1;
			if (fresh?.spectral) withRate += 1;
		});
		expect(checked).toBeGreaterThan(30);
		expect(withRate).toBeGreaterThan(30);
	});

	test("nothing downstream changes an analysis (results are frozen here), with the switch on and off", () => {
		for (const steadyAnalysis of [true, false]) {
			const { backend } = stubBackend();
			const p = new RppgProcessor(backend, 30, 10, { fixes: { steadyAnalysis } });
			expect(() =>
				feedPulse(p, 0, 12000, 30, () => {
					p.getMetrics();
					p.getDebugSnapshot(0);
				}),
			).not.toThrow();
			expect(p.getMetrics().spectral_bpm).not.toBeNull();
		}
	});
});
