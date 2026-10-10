// The analysis worker must give exactly the answers a main-thread processor gives: same
// samples in, same metrics out, after every sample. The worker module runs in-process here,
// with messages passed through a structured clone as a real worker's would be.
const fakeBackend = () => {
	let n = 0;
	const pipeline = {
		push_sample: () => {
			n++;
		},
		push_sample_rgb: () => {
			n++;
		},
		get_metrics: () => ({
			bpm: 60 + (n % 30),
			confidence: 0.8,
			signal_quality: 0.7,
		}),
		enable_tracker: () => {},
		free: () => {},
	};
	return { newPipeline: () => pipeline };
};

jest.mock("../wasmBackend", () => ({
	loadWasmBackend: jest.fn(async () => fakeBackend()),
	createUnavailableBackend: jest.fn(),
}));

import { ANALYSIS_EVERY_MS } from "../processorWorkerProtocol";
import { RppgProcessor } from "../rppgProcessor";
import {
	createWorkerRppgProcessor,
	type WorkerLike,
} from "../workerRppgProcessor";

// What crosses to a worker is a copy; JSON is that copy for the plain data sent here.
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

async function startInProcessWorker(): Promise<WorkerLike> {
	const scope = self as unknown as {
		onmessage: ((e: { data: unknown }) => unknown) | null;
		postMessage: (m: unknown) => void;
		close: () => void;
	};
	const worker: WorkerLike = {
		postMessage: (m) => {
			scope.onmessage?.({ data: clone(m) });
		},
		terminate: () => {},
		onmessage: null,
		onerror: null,
	};
	scope.postMessage = (m) => worker.onmessage?.({ data: clone(m) } as never);
	scope.close = () => {};
	await import("../processorWorker");
	return worker;
}

function rgbAt(t: number) {
	const p = 0.01 * Math.sin((2 * Math.PI * 72 * t) / 60000);
	return [150 * (1 - 0.3 * p), 120 * (1 - p), 100 * (1 - 0.6 * p)] as const;
}

describe("WorkerRppgProcessor", () => {
	test("answers exactly as a main-thread processor, after every sample", async () => {
		const worker = await startInProcessWorker();
		const viaWorker = await createWorkerRppgProcessor({
			sampleRate: 30,
			windowSec: 10,
			createWorker: () => worker,
		});
		expect(viaWorker).not.toBeNull();
		const direct = new RppgProcessor(fakeBackend() as never, 30, 10);
		direct.enableTracker(55, 150, 200);
		viaWorker!.enableTracker(55, 150, 200);
		// The worker analyses at most every ANALYSIS_EVERY_MS of sample time and answers every
		// read in between from that analysis. Each read of a main-thread processor is an
		// analysis, so the reference is read exactly when the worker analyses, and the two
		// must then agree on metrics, debug state and trace.
		let compared = 0;
		let refreshedAt: number | null = null;
		for (let i = 0; i < 300; i++) {
			const t = 1000 + i * (1000 / 30);
			const [r, g, b] = rgbAt(t);
			direct.pushSampleRgb(t, r, g, b, 1);
			viaWorker!.pushSampleRgb(t, r, g, b, 1);
			const viaWorkerMetrics = viaWorker!.getMetrics();
			if (refreshedAt == null || t - refreshedAt >= ANALYSIS_EVERY_MS) {
				refreshedAt = t;
				expect(viaWorkerMetrics).toEqual(direct.getMetrics());
				expect(viaWorker!.getDebugSnapshot(t + 5)).toEqual(
					direct.getDebugSnapshot(t + 5),
				);
				expect(viaWorker!.getTraceSnapshot(300)).toEqual(
					direct.getTraceSnapshot(300),
				);
				compared++;
			}
		}
		// 300 samples 33.3 ms apart: the 250 ms mark is crossed every 8 samples (266 ms), 38 times.
		expect(compared).toBe(38);
		viaWorker!.dispose();
	});

	test("starts the signal afresh in the worker, as a main-thread processor does", async () => {
		const worker = await startInProcessWorker();
		const viaWorker = await createWorkerRppgProcessor({
			sampleRate: 30,
			windowSec: 10,
			createWorker: () => worker,
		});
		expect(viaWorker).not.toBeNull();
		const direct = new RppgProcessor(fakeBackend() as never, 30, 10);
		for (let i = 0; i < 150; i++) {
			const t = 1000 + i * (1000 / 30);
			const [r, g, b] = rgbAt(t);
			direct.pushSampleRgb(t, r, g, b, 1);
			viaWorker!.pushSampleRgb(t, r, g, b, 1);
		}
		expect(direct.getDebugSnapshot(7000).windowSampleCount).toBe(150);
		direct.resetSignal();
		viaWorker!.resetSignal();
		expect(direct.getDebugSnapshot(7000).windowSampleCount).toBe(0);
		expect(viaWorker!.getDebugSnapshot(7000)).toEqual(direct.getDebugSnapshot(7000));
		expect(viaWorker!.getMetrics()).toEqual(direct.getMetrics());
		viaWorker!.dispose();
	});

	test("a fatal engine error in the worker makes the next push throw, as on the main thread", async () => {
		const { loadWasmBackend } = jest.requireMock("../wasmBackend") as { loadWasmBackend: jest.Mock };
		let pushes = 0;
		const poisoned = {
			push_sample: () => {},
			push_sample_rgb: () => {
				if (++pushes >= 20) throw new Error("engine poisoned");
			},
			get_metrics: () => ({ bpm: 70, confidence: 0.9, signal_quality: 0.9 }),
			enable_tracker: () => {},
			free: () => {},
		};
		loadWasmBackend.mockImplementationOnce(async () => ({ newPipeline: () => poisoned }));
		const worker = await startInProcessWorker();
		const viaWorker = await createWorkerRppgProcessor({
			sampleRate: 30,
			windowSec: 10,
			createWorker: () => worker,
		});
		expect(viaWorker).not.toBeNull();
		const push = (i: number) => {
			const t = 1000 + i * (1000 / 30);
			const [r, g, b] = rgbAt(t);
			viaWorker!.pushSampleRgb(t, r, g, b, 1);
		};
		for (let i = 0; i < 20; i++) push(i);
		expect(viaWorker!.isBackendFailed()).toBe(true);
		expect(() => push(20)).toThrow("engine poisoned");
		expect(() => push(21)).toThrow("engine poisoned");
		viaWorker!.dispose();
	});

	test("falls back (returns null) when the worker never loads the core", async () => {
		jest.useFakeTimers();
		const silent: WorkerLike = {
			postMessage: () => {},
			terminate: jest.fn(),
			onmessage: null,
			onerror: null,
		};
		const pending = createWorkerRppgProcessor({
			sampleRate: 30,
			windowSec: 10,
			createWorker: () => silent,
		});
		jest.advanceTimersByTime(10001);
		await expect(pending).resolves.toBeNull();
		expect(silent.terminate).toHaveBeenCalled();
		jest.useRealTimers();
	});
});
