import {
	FINDER_SWITCH_MARGIN,
	FINDER_TRIAL_TIMED_CALLS,
	FINDER_TRIAL_WARMUP_CALLS,
	type FinderCandidate,
	faceRebuildReason,
	NO_FACE_AFTER_RETURN_MS,
	pickFastest,
	TrialFaceFinder,
} from "../faceFinderTrial";
import type { FaceLandmarkerResult } from "../mediapipeLoader";

// The face finder can run on the GPU or the CPU. Which is faster depends on the device: on a laptop the
// CPU version gave 4.3 to 6.7 frames a second where the GPU version did not hold the frames back; under a
// software GL the GPU version took ~290 ms per call against under 70 on the CPU. So each one that builds
// is timed on the live video and the faster is kept (an app built on this package does exactly this).

const FACE: FaceLandmarkerResult = { faceLandmarks: [[{ x: 0.5, y: 0.5 }]] } as FaceLandmarkerResult;
const NONE: FaceLandmarkerResult = { faceLandmarks: [] } as FaceLandmarkerResult;

/** A fake finder whose every call advances the shared clock by `ms` and answers `result()`. */
function fake(delegate: "GPU" | "CPU", ms: number, clock: { t: number }, result: () => FaceLandmarkerResult = () => FACE) {
	const calls: number[] = [];
	let closed = false;
	let lost = false;
	const c: FinderCandidate & { calls: number[]; closed: () => boolean; lose: () => void } = {
		delegate,
		finder: {
			detectForVideo: (_input: unknown, ts: number) => {
				calls.push(ts);
				clock.t += ms;
				return result();
			},
			close: () => {
				closed = true;
			},
		} as never,
		isLost: () => lost,
		calls,
		closed: () => closed,
		lose: () => {
			lost = true;
		},
	};
	return c;
}

const PER = FINDER_TRIAL_WARMUP_CALLS + FINDER_TRIAL_TIMED_CALLS;

function drive(f: TrialFaceFinder, n: number, clock: { t: number }) {
	for (let i = 0; i < n; i++) {
		clock.t += 33;
		f.detectForVideo({} as never, clock.t);
	}
}

describe("picking the faster delegate", () => {
	test("the earlier candidate keeps its place unless a later one is more than the margin faster", () => {
		expect(pickFastest([{ delegate: "GPU", meanMs: 20 }, { delegate: "CPU", meanMs: 18 }])!.delegate).toBe("GPU");
		expect(pickFastest([{ delegate: "GPU", meanMs: 20 }, { delegate: "CPU", meanMs: 20 * (1 - FINDER_SWITCH_MARGIN) - 0.01 }])!.delegate).toBe("CPU");
		expect(pickFastest([{ delegate: "GPU", meanMs: Number.NaN }, { delegate: "CPU", meanMs: 60 }])!.delegate).toBe("CPU");
		expect(pickFastest([])).toBeNull();
	});
});

describe("when to rebuild the finder", () => {
	test("a lost GPU context rebuilds at once; a return from a hidden page with no face for 2 s rebuilds", () => {
		expect(faceRebuildReason({ contextLost: true, returnedAtMs: null, lastFaceAtMs: 0, nowMs: 0 })).toBe("context-lost");
		const back = 10_000;
		expect(faceRebuildReason({ contextLost: false, returnedAtMs: back, lastFaceAtMs: back - 1, nowMs: back + NO_FACE_AFTER_RETURN_MS - 1 })).toBeNull();
		expect(faceRebuildReason({ contextLost: false, returnedAtMs: back, lastFaceAtMs: back - 1, nowMs: back + NO_FACE_AFTER_RETURN_MS })).toBe("no-face-after-return");
		expect(faceRebuildReason({ contextLost: false, returnedAtMs: back, lastFaceAtMs: back + 5, nowMs: back + 5_000 })).toBeNull();
	});
});

describe("the trial on the live video", () => {
	test("each candidate is tried for the warm-up and timed calls, the faster is kept, the slower closed", () => {
		const clock = { t: 0 };
		const gpu = fake("GPU", 290, clock);
		const cpu = fake("CPU", 60, clock);
		const f = new TrialFaceFinder([gpu, cpu], { now: () => clock.t });
		drive(f, PER, clock);
		expect(gpu.calls).toHaveLength(PER);
		expect(cpu.calls).toHaveLength(0);
		drive(f, PER, clock);
		expect(cpu.calls).toHaveLength(PER);
		expect(f.delegate).toBe("CPU");
		expect(gpu.closed()).toBe(true);
		expect(cpu.closed()).toBe(false);
		drive(f, 5, clock);
		expect(cpu.calls).toHaveLength(PER + 5);
		expect(gpu.calls).toHaveLength(PER);
		expect(f.trialResults.map((r) => r.delegate)).toEqual(["GPU", "CPU"]);
		expect(f.trialResults[0].meanMs).toBeCloseTo(290, 6);
	});

	test("a fast GPU keeps the GPU, and the CPU is closed", () => {
		const clock = { t: 0 };
		const gpu = fake("GPU", 15, clock);
		const cpu = fake("CPU", 60, clock);
		const f = new TrialFaceFinder([gpu, cpu], { now: () => clock.t });
		drive(f, 2 * PER + 3, clock);
		expect(f.delegate).toBe("GPU");
		expect(cpu.closed()).toBe(true);
		expect(gpu.calls).toHaveLength(PER + 3);
	});

	test("one candidate is simply used, with no trial", () => {
		const clock = { t: 0 };
		const cpu = fake("CPU", 60, clock);
		const f = new TrialFaceFinder([cpu], { now: () => clock.t });
		drive(f, 3, clock);
		expect(f.delegate).toBe("CPU");
		expect(cpu.calls).toHaveLength(3);
	});

	test("a lost GPU context builds a fresh finder of the same delegate and moves to it", async () => {
		const clock = { t: 0 };
		const gpu = fake("GPU", 15, clock);
		const fresh = fake("GPU", 15, clock);
		const rebuild = jest.fn(async () => fresh);
		const f = new TrialFaceFinder([gpu], { now: () => clock.t, rebuild });
		drive(f, 3, clock);
		gpu.lose();
		drive(f, 1, clock);
		expect(rebuild).toHaveBeenCalledWith("GPU");
		await Promise.resolve();
		await Promise.resolve();
		drive(f, 2, clock);
		expect(fresh.calls).toHaveLength(2);
		expect(gpu.closed()).toBe(true);
		drive(f, 2, clock);
		expect(rebuild).toHaveBeenCalledTimes(1);
	});

	test("after a return from a hidden page, no face for 2 s rebuilds; a face found in time does not", async () => {
		const clock = { t: 0 };
		let answer = FACE;
		const cpu = fake("CPU", 10, clock, () => answer);
		const fresh = fake("CPU", 10, clock);
		const rebuild = jest.fn(async () => fresh);
		const f = new TrialFaceFinder([cpu], { now: () => clock.t, rebuild });
		drive(f, 3, clock);
		answer = NONE;
		clock.t += 1; // the page comes back after the last face
		f.noteReturn(clock.t);
		drive(f, Math.floor(NO_FACE_AFTER_RETURN_MS / 43) - 2, clock);
		expect(rebuild).not.toHaveBeenCalled();
		drive(f, 4, clock);
		expect(rebuild).toHaveBeenCalledWith("CPU");
		await Promise.resolve();
		await Promise.resolve();
		drive(f, 1, clock);
		expect(fresh.calls).toHaveLength(1);

		const clock2 = { t: 0 };
		const ok = fake("CPU", 10, clock2);
		const rebuild2 = jest.fn(async () => null);
		const g = new TrialFaceFinder([ok], { now: () => clock2.t, rebuild: rebuild2 });
		g.noteReturn(clock2.t);
		drive(g, 100, clock2);
		expect(rebuild2).not.toHaveBeenCalled();
	});

	test("a rebuild that fails keeps the finder it has", async () => {
		const clock = { t: 0 };
		const gpu = fake("GPU", 15, clock);
		const f = new TrialFaceFinder([gpu], { now: () => clock.t, rebuild: async () => null });
		gpu.lose();
		drive(f, 1, clock);
		await Promise.resolve();
		await Promise.resolve();
		drive(f, 1, clock);
		expect(gpu.calls).toHaveLength(2);
	});
});

describe("lifetime", () => {
	/** A page whose visibility can be flipped, counting its listeners. */
	function page() {
		const listeners = new Set<() => void>();
		return {
			visibilityState: "visible" as string,
			addEventListener: (type: string, fn: () => void) => {
				if (type === "visibilitychange") listeners.add(fn);
			},
			removeEventListener: (type: string, fn: () => void) => {
				if (type === "visibilitychange") listeners.delete(fn);
			},
			listeners,
			flip(state: string) {
				this.visibilityState = state;
				for (const fn of [...listeners]) fn();
			},
		};
	}

	test("a return to the page, heard from the page itself, counts as a return", () => {
		const clock = { t: 0 };
		const cpu = fake("CPU", 10, clock, () => NONE);
		const rebuild = jest.fn(async () => null);
		const doc = page();
		const f = new TrialFaceFinder([cpu], { now: () => clock.t, rebuild, visibility: doc });
		drive(f, 3, clock);
		doc.flip("hidden");
		clock.t += 5_000; // hidden for 5 s: the finder is not called while the page is hidden
		doc.flip("visible");
		drive(f, Math.floor(NO_FACE_AFTER_RETURN_MS / 43) - 2, clock);
		expect(rebuild).not.toHaveBeenCalled(); // the 2 s count from the return, not from leaving
		drive(f, 4, clock);
		expect(rebuild).toHaveBeenCalledWith("CPU");
	});

	test("closing stops listening to the page", () => {
		const clock = { t: 0 };
		const doc = page();
		const f = new TrialFaceFinder([fake("CPU", 10, clock)], { now: () => clock.t, visibility: doc });
		expect(doc.listeners.size).toBe(1);
		f.close();
		expect(doc.listeners.size).toBe(0);
	});

	test("a rebuild that lands after close is closed, never used", async () => {
		const clock = { t: 0 };
		const gpu = fake("GPU", 15, clock);
		const fresh = fake("GPU", 15, clock);
		let land: (c: FinderCandidate) => void = () => undefined;
		const f = new TrialFaceFinder([gpu], { now: () => clock.t, rebuild: () => new Promise((r) => (land = r)) });
		gpu.lose();
		drive(f, 1, clock);
		f.close();
		land(fresh);
		await Promise.resolve();
		await Promise.resolve();
		expect(fresh.closed()).toBe(true);
		expect(f.delegate).toBe("GPU");
	});
});
