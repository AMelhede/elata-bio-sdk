jest.mock("../mediapipeLoader", () => ({
	loadFaceLandmarker: jest.fn(async () => null),
}));

jest.mock("../videoPlayback", () => ({
	ensureVideoPlaying: jest.fn(async () => undefined),
}));

jest.mock("../wasmBackend", () => ({
	loadWasmBackend: jest.fn(async () => ({
		newPipeline: () => ({
			push_sample: jest.fn(),
			get_metrics: jest.fn(() => ({ bpm: 72, confidence: 0.8, signal_quality: 0.7 })),
			free: jest.fn(),
		}),
	})),
	createUnavailableBackend: jest.fn(() => ({
		newPipeline: () => ({
			push_sample: jest.fn(),
			get_metrics: jest.fn(() => ({ bpm: null, confidence: 0, signal_quality: 0 })),
			free: jest.fn(),
		}),
	})),
}));

jest.mock("../mediaPipeFaceFrameSource", () => ({
	MediaPipeFaceFrameSource: jest.fn().mockImplementation(function MediaPipeFaceFrameSource(this: any) {
		this.onFrame = null;
		this.asyncFinder = null;
		this.start = jest.fn(async () => {});
		this.stop = jest.fn(async () => {});
	}),
}));

jest.mock("../demoRunner", () => ({
	DemoRunner: jest.fn().mockImplementation(function DemoRunner(this: any) {
		this.start = jest.fn(async () => {});
		this.stop = jest.fn(async () => {});
		this.getDiagnostics = jest.fn(() => ({}));
	}),
}));

const fakeFinder = { busy: false, request: jest.fn(), take: jest.fn(), close: jest.fn() };
jest.mock("../faceFinderWorker", () => ({
	...jest.requireActual("../faceFinderWorker"),
	createWorkerFaceFinder: jest.fn(async () => fakeFinder),
}));

import { DemoRunner } from "../demoRunner";
import { createWorkerFaceFinder } from "../faceFinderWorker";
import { MediaPipeFaceFrameSource } from "../mediaPipeFaceFrameSource";
import { type PulseCheckRecording, RecordingPulseCheck } from "../pulseCheckRecording";
import { createRppgSession } from "../rppgSession";
import type { SlowSwitch } from "../slowSwitch";

// Session option slowSwitch (2026-11-11): the session acts on the trigger (slowSwitch.test.ts) once: the face finder to
// its worker, the check to the tracker on the face patches, onSlowSwitch; `{ remembered: true }` starts switched; the
// record is what a saved file's device.slow_switch holds. Without the option nothing of it exists.

const faceMesh = { detectForVideo: () => ({ faceLandmarks: [] }) } as any;
const last = <T>(a: T[]): T => a[a.length - 1];
const runnerOpts = () => last((DemoRunner as unknown as jest.Mock).mock.calls)?.[2];
const source = () => last((MediaPipeFaceFrameSource as unknown as jest.Mock).mock.instances as any[]);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 7.5 frames a second with the face, from 1 s, frames `from` to `to`, through the switch the session handed its runner. */
function slowFrames(sw: SlowSwitch, toS: number, fromS = 0): void {
	for (let i = fromS * 7.5; i < toS * 7.5; i++) sw.frame(1000 + (i * 1000) / 7.5, true);
}

describe("createRppgSession slowSwitch", () => {
	beforeEach(() => jest.clearAllMocks());

	test("off unless set: no switch reaches the runner, no record, the rules as given", async () => {
		const s = await createRppgSession({ video: document.createElement("video"), faceMesh, autoStart: false });
		expect(runnerOpts().slowSwitch).toBeNull();
		expect(s.getSlowSwitch()).toBeNull();
		expect(s.getBuildSwitches().pulseCheckRules?.tracker).toBe(false);
		expect(createWorkerFaceFinder).not.toHaveBeenCalled();
	});

	test("on a slow clock: the finder moves to its worker, the check to the tracker on the patches, once, with the record", async () => {
		const heard: unknown[] = [];
		const s = await createRppgSession({
			video: document.createElement("video"),
			faceMesh,
			autoStart: false,
			pulseCheckRules: { allPatches: false },
			slowSwitch: true,
			onSlowSwitch: (r) => heard.push(r),
		});
		const sw = runnerOpts().slowSwitch as SlowSwitch;
		expect(sw).not.toBeNull();
		expect(s.getBuildSwitches().pulseCheckRules).toMatchObject({ tracker: false, allPatches: false });
		// Warm-up 3 s plus the 16 s window: nothing through second 17.
		slowFrames(sw, 18);
		expect(s.getSlowSwitch()).toBeNull();
		expect(createWorkerFaceFinder).not.toHaveBeenCalled();
		slowFrames(sw, 32, 18);
		await flush();
		expect(s.getBuildSwitches().pulseCheckRules).toMatchObject({ tracker: true, allPatches: true });
		expect(createWorkerFaceFinder).toHaveBeenCalledTimes(1);
		expect(source().asyncFinder).toBe(fakeFinder);
		expect(heard).toEqual([{ at_s: 19.1, fps_before: 7.5, fps_after_10s: null, remembered: false }]);
		expect(s.getSlowSwitch()).toEqual({ at_s: 19.1, fps_before: 7.5, fps_after_10s: 7.5, remembered: false });
		await s.dispose();
		expect(fakeFinder.close).toHaveBeenCalled();
	});

	test("with faceFinderWorker already on, the switch starts no second worker", async () => {
		await createRppgSession({ video: document.createElement("video"), faceMesh, autoStart: false, faceFinderWorker: true, slowSwitch: true });
		slowFrames(runnerOpts().slowSwitch as SlowSwitch, 20);
		await flush();
		expect(createWorkerFaceFinder).toHaveBeenCalledTimes(1);
	});

	test("remembered: starts switched (worker, tracker, record), and the callback is not called", async () => {
		const heard: unknown[] = [];
		const s = await createRppgSession({
			video: document.createElement("video"),
			faceMesh,
			autoStart: false,
			pulseCheckRules: { tracker: false, allPatches: false },
			slowSwitch: { remembered: true },
			onSlowSwitch: (r) => heard.push(r),
		});
		await flush();
		expect(s.getBuildSwitches().pulseCheckRules).toMatchObject({ tracker: true, allPatches: true });
		expect(createWorkerFaceFinder).toHaveBeenCalledTimes(1);
		expect(source().asyncFinder).toBe(fakeFinder);
		expect(s.getSlowSwitch()).toEqual({ at_s: 0, fps_before: null, fps_after_10s: null, remembered: true });
		slowFrames(runnerOpts().slowSwitch as SlowSwitch, 20);
		expect(heard).toEqual([]);
		expect(s.getSlowSwitch()?.fps_after_10s).toBe(7.5);
	});

	test("a recorded session keeps the switch in its place: rules it started with, then an s event", async () => {
		const s = await createRppgSession({
			video: document.createElement("video"),
			faceMesh,
			autoStart: false,
			recordPulseCheckInputs: true,
			slowSwitch: true,
		});
		const check = runnerOpts().pulseChecker as RecordingPulseCheck;
		const sw = runnerOpts().slowSwitch as SlowSwitch;
		const rgb = { r: 120, g: 90, b: 70 };
		for (let i = 0; i < 24 * 7.5; i++) {
			const t = 1000 + (i * 1000) / 7.5;
			check.push(t, [rgb, rgb, rgb]);
			sw.frame(t, true);
		}
		const rec = s.getPulseCheckRecording() as PulseCheckRecording;
		expect(rec.rules.tracker).toBe(false);
		const at = rec.events.findIndex((e) => e[0] === "s");
		expect(at).toBeGreaterThan(0);
		// The first frame of second 19 (frame 143) switches it.
		const tSwitch = 1000 + (143 * 1000) / 7.5;
		expect(rec.events[at]).toEqual(["s", tSwitch]);
		expect(rec.events[at - 1][0]).toBe("f");
		expect(rec.events[at - 1][1]).toBe(tSwitch);
	});
});
