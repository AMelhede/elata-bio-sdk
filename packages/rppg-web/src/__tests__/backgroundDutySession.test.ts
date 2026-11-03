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

const frameSourceStart = jest.fn(async () => {});
const frameSourceStop = jest.fn(async () => {});
const faceFrameSourceStart = jest.fn(async () => {});
const faceFrameSourceStop = jest.fn(async () => {});

jest.mock("../mediaPipeFrameSource", () => ({
	MediaPipeFrameSource: jest.fn().mockImplementation(function MediaPipeFrameSource(this: any) {
		this.onFrame = null;
		this.start = frameSourceStart;
		this.stop = frameSourceStop;
	}),
}));

jest.mock("../mediaPipeFaceFrameSource", () => ({
	MediaPipeFaceFrameSource: jest.fn().mockImplementation(function MediaPipeFaceFrameSource(this: any) {
		this.onFrame = null;
		this.start = faceFrameSourceStart;
		this.stop = faceFrameSourceStop;
	}),
}));

const runnerStart = jest.fn(async () => {});
const runnerStop = jest.fn(async () => {});

jest.mock("../demoRunner", () => ({
	DemoRunner: jest.fn().mockImplementation(function DemoRunner(this: any) {
		this.start = runnerStart;
		this.stop = runnerStop;
		this.getDiagnostics = jest.fn(() => ({
			framesSeen: 0,
			framesWithFaceRoi: 0,
			framesWithFallbackRoi: 0,
			framesWithMultiRoi: 0,
			samplesPushed: 0,
			droppedFrames: 0,
			lastDropReason: null,
			lastTimestampMs: null,
			lastIntensity: null,
			lastSkinRatio: null,
			lastClipRatio: null,
			lastMotion: null,
			lastProcessorMethod: null,
			lastRoiSource: null,
		}));
	}),
}));

import { createRppgSession } from "../rppgSession";
import { MediaPipeFaceFrameSource } from "../mediaPipeFaceFrameSource";
import { BackgroundDuty } from "../backgroundFrames";

// Session options backgroundEveryMs, backgroundMaxBurstMs, backgroundHoldMs: with backgroundFrames and the face mesh,
// the session hands the frame source its burst schedule and the reading mark the schedule reads.

const mockedFaceSource = MediaPipeFaceFrameSource as unknown as jest.Mock;
const faceMesh = { detectForVideo: () => ({ faceLandmarks: [] }) } as any;

describe("createRppgSession backgroundEveryMs", () => {
	beforeEach(() => jest.clearAllMocks());

	test("with backgroundFrames: a schedule with the options given, and a mark from the session's pulse check", async () => {
		await createRppgSession({ video: document.createElement("video"), faceMesh, autoStart: false, backgroundFrames: true, backgroundEveryMs: 300_000, backgroundMaxBurstMs: 90_000, backgroundHoldMs: 5000 });
		const src = mockedFaceSource.mock.instances[0];
		expect(src.backgroundFrames).toBe(true);
		expect(src.backgroundDuty).toBeInstanceOf(BackgroundDuty);
		expect([src.backgroundDuty.everyMs, src.backgroundDuty.maxBurstMs, src.backgroundDuty.holdMs]).toEqual([300_000, 90_000, 5000]);
		expect(src.backgroundReadingMark()).toEqual({ evaluations: 0, measured: false, passive: 0 });
	});

	test("defaults for the longest burst and the hold", async () => {
		await createRppgSession({ video: document.createElement("video"), faceMesh, autoStart: false, backgroundFrames: true, backgroundEveryMs: 300_000 });
		const d = mockedFaceSource.mock.instances[0].backgroundDuty;
		expect([d.maxBurstMs, d.holdMs]).toEqual([120_000, 0]);
	});

	test("no schedule without backgroundEveryMs, or without backgroundFrames", async () => {
		await createRppgSession({ video: document.createElement("video"), faceMesh, autoStart: false, backgroundFrames: true });
		await createRppgSession({ video: document.createElement("video"), faceMesh, autoStart: false, backgroundEveryMs: 300_000 });
		for (const src of mockedFaceSource.mock.instances) expect(src.backgroundDuty ?? null).toBeNull();
	});
});
