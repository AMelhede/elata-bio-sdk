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

jest.mock("../workerRppgProcessor", () => {
	const actual = jest.requireActual("../workerRppgProcessor");
	return { ...actual, createWorkerRppgProcessor: jest.fn(async () => null) };
});

import { createRppgSession } from "../rppgSession";
import { createWorkerRppgProcessor } from "../workerRppgProcessor";

const mockedCreateWorker = createWorkerRppgProcessor as jest.Mock;

// Speed 4 (analysisWorker switch): the analysis worker is tried by default in this test build,
// never when the switch is off, and the explicit session option wins over the switch.
describe("analysisWorker switch", () => {
	beforeEach(() => jest.clearAllMocks());
	const make = (extra: object) =>
		createRppgSession({ video: document.createElement("video"), faceMesh: "off", ...extra } as never);

	test("on by default: the worker is tried", async () => {
		await make({});
		expect(mockedCreateWorker).toHaveBeenCalledTimes(1);
	});
	test("off: the analysis stays on the main thread, as published", async () => {
		await make({ fixes: { analysisWorker: false } });
		await make({ fixes: false });
		expect(mockedCreateWorker).not.toHaveBeenCalled();
	});
	test("the session option wins over the switch", async () => {
		await make({ fixes: false, analysisWorker: true });
		expect(mockedCreateWorker).toHaveBeenCalledTimes(1);
	});
});
