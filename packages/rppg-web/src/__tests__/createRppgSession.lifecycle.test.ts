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
import { DemoRunner } from "../demoRunner";
import { loadFaceLandmarker } from "../mediapipeLoader";
import { ensureVideoPlaying } from "../videoPlayback";
import { MediaPipeFrameSource } from "../mediaPipeFrameSource";
import { MediaPipeFaceFrameSource } from "../mediaPipeFaceFrameSource";
import { loadWasmBackend } from "../wasmBackend";

const mockedLoadFaceMesh = loadFaceLandmarker as jest.MockedFunction<typeof loadFaceLandmarker>;
const mockedEnsureVideoPlaying = ensureVideoPlaying as jest.MockedFunction<typeof ensureVideoPlaying>;
const mockedMediaPipeFrameSource = MediaPipeFrameSource as unknown as jest.Mock;
const mockedMediaPipeFaceFrameSource = MediaPipeFaceFrameSource as unknown as jest.Mock;
const mockedLoadWasmBackend = loadWasmBackend as jest.MockedFunction<typeof loadWasmBackend>;
const mockedDemoRunner = DemoRunner as unknown as jest.Mock;

describe("createRppgSession lifecycle", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		frameSourceStart.mockClear();
		frameSourceStop.mockClear();
		faceFrameSourceStart.mockClear();
		faceFrameSourceStop.mockClear();
		runnerStart.mockClear();
		runnerStop.mockClear();
	});

	test("uses ensureVideoPlaying by default before auto-starting", async () => {
		const video = document.createElement("video");

		const session = await createRppgSession({
			video,
			faceMesh: "off",
		});

		expect(mockedEnsureVideoPlaying).toHaveBeenCalledTimes(1);
		expect(mockedEnsureVideoPlaying).toHaveBeenCalledWith(
			video,
			{ timeoutMs: undefined },
		);
		expect(mockedLoadFaceMesh).not.toHaveBeenCalled();
		expect(mockedMediaPipeFrameSource).toHaveBeenCalledTimes(1);
		expect(session.faceTrackingMode).toBe("video_frame");
		expect(runnerStart).toHaveBeenCalledTimes(1);
	});

	test("skips video playback coordination when ensureVideoPlayback is false", async () => {
		await createRppgSession({
			video: document.createElement("video"),
			faceMesh: "off",
			ensureVideoPlayback: false,
		});

		expect(mockedEnsureVideoPlaying).not.toHaveBeenCalled();
		expect(runnerStart).toHaveBeenCalledTimes(1);
	});

	test("defers video playback coordination until manual start when autoStart is false", async () => {
		const video = document.createElement("video");
		const session = await createRppgSession({
			video,
			faceMesh: "off",
			autoStart: false,
			videoPlaybackTimeoutMs: 1234,
		});

		expect(mockedEnsureVideoPlaying).not.toHaveBeenCalled();
		expect(runnerStart).not.toHaveBeenCalled();

		await session.start();

		expect(mockedEnsureVideoPlaying).toHaveBeenCalledTimes(1);
		expect(mockedEnsureVideoPlaying).toHaveBeenCalledWith(
			video,
			{ timeoutMs: 1234 },
		);
		expect(runnerStart).toHaveBeenCalledTimes(1);
	});

	test("uses the face frame source when FaceMesh resolves successfully", async () => {
		mockedLoadFaceMesh.mockResolvedValueOnce({
			detectForVideo: jest.fn(() => ({ faceLandmarks: [] })),
		} as any);

		const session = await createRppgSession({
			video: document.createElement("video"),
			faceMesh: "auto",
			ensureVideoPlayback: false,
		});

		expect(mockedLoadFaceMesh).toHaveBeenCalledTimes(1);
		expect(mockedMediaPipeFaceFrameSource).toHaveBeenCalledTimes(1);
		expect(session.faceTrackingMode).toBe("face_mesh");
	});

	test("dispose frees the created backend pipeline", async () => {
		const free = jest.fn();
		mockedLoadWasmBackend.mockResolvedValueOnce({
			newPipeline: () => ({
				push_sample: jest.fn(),
				get_metrics: jest.fn(() => ({ bpm: 72, confidence: 0.8, signal_quality: 0.7 })),
				free,
			}),
		} as any);

		const session = await createRppgSession({
			video: document.createElement("video"),
			faceMesh: "off",
			ensureVideoPlayback: false,
		});

		await session.dispose();

		expect(free).toHaveBeenCalledTimes(1);
	});

	test("stops and reinitializes an experimental model with the session", async () => {
		const model = {
			manifest: {
				schema: "elata.rppg.waveform-model/v1",
				id: "lifecycle-model",
				version: "1",
				status: "diagnostic",
				input: {
					profileId: "mcd-proxy-input-v1",
					channels: ["x"],
					length: 2,
					normalization: "test",
				},
				output: { kind: "normalized-waveform", length: 2 },
				hashes: { modelSha256: "a", metadataSha256: "b" },
				runtime: { engine: "test" },
			} as const,
			init: jest.fn(async () => {}),
			reconstruct: jest.fn(async () => null),
			dispose: jest.fn(async () => {}),
		};
		const session = await createRppgSession({
			video: document.createElement("video"),
			faceMesh: "off",
			ensureVideoPlayback: false,
			experimental: { waveformReconstructor: model },
		});
		await session.stop();
		expect(model.dispose).toHaveBeenCalledTimes(1);
		expect(session.getModelDiagnostics()?.modelStatus).toBe("disposed");

		await session.start();
		expect(model.init).toHaveBeenCalledTimes(2);
		expect(session.getModelDiagnostics()?.modelStatus).toBe("ready");
		await session.dispose();
		expect(model.dispose).toHaveBeenCalledTimes(2);
	});

	// With backend "auto" (every README example), a WASM core that would not load left the session
	// with no heart rate forever and the load error thrown away: no onError, no lastError, nothing
	// saying which URLs were tried. A wrong bundler setup looked like a camera that sees no pulse.
	test("backend auto: a WASM core that does not load is reported to the app, with what was tried", async () => {
		mockedLoadWasmBackend.mockImplementationOnce(async (_importer, opts) => {
			if (opts?.strict) throw new Error("Unable to load rPPG WASM backend. Tried: /pkg/rppg_wasm.js.");
			return null;
		});
		const onError = jest.fn();
		const session = await createRppgSession({
			video: document.createElement("video"),
			faceMesh: "off",
			backend: "auto",
			ensureVideoPlayback: false,
			onError,
		});
		expect(session.backendMode).toBe("unavailable");
		expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "backend_init_failed", stage: "backend" }));
		expect(session.lastError?.message).toContain("Tried: /pkg/rppg_wasm.js");
		expect(session.getState()).toMatchObject({ status: "degraded", phase: "startup", errorCode: "backend_init_failed" });
		await session.dispose();
	});

	test("backend auto: a WASM core that loads raises no error", async () => {
		const onError = jest.fn();
		const session = await createRppgSession({
			video: document.createElement("video"),
			faceMesh: "off",
			backend: "auto",
			ensureVideoPlayback: false,
			onError,
		});
		expect(session.backendMode).toBe("wasm");
		expect(onError).not.toHaveBeenCalled();
		await session.dispose();
	});

	describe("requireFace", () => {
		const faceMeshLoads = () =>
			mockedLoadFaceMesh.mockResolvedValueOnce({
				detectForVideo: jest.fn(() => ({ faceLandmarks: [] })),
			} as any);
		const runnerRequireFace = () => mockedDemoRunner.mock.calls[0][2].requireFace;
		const video = () => document.createElement("video");

		test("is on in face_mesh mode without an explicit roi", async () => {
			faceMeshLoads();
			await createRppgSession({ video: video(), faceMesh: "auto", ensureVideoPlayback: false });
			expect(runnerRequireFace()).toBe(true);
		});

		test("is off with an explicit roi", async () => {
			faceMeshLoads();
			await createRppgSession({
				video: video(),
				faceMesh: "auto",
				roi: { x: 0, y: 0, w: 10, h: 10 },
				ensureVideoPlayback: false,
			});
			expect(runnerRequireFace()).toBe(false);
		});

		test("is off in video_frame mode, including when FaceMesh fails to load", async () => {
			await createRppgSession({ video: video(), faceMesh: "off", ensureVideoPlayback: false });
			mockedLoadFaceMesh.mockRejectedValueOnce(new Error("no model"));
			await createRppgSession({ video: video(), faceMesh: "auto", ensureVideoPlayback: false });
			expect(mockedDemoRunner.mock.calls.map((call) => call[2].requireFace)).toEqual([false, false]);
		});

		test("honours a caller's requireFace", async () => {
			faceMeshLoads();
			await createRppgSession({
				video: video(),
				faceMesh: "auto",
				requireFace: false,
				ensureVideoPlayback: false,
			});
			await createRppgSession({
				video: video(),
				faceMesh: "off",
				requireFace: true,
				ensureVideoPlayback: false,
			});
			expect(mockedDemoRunner.mock.calls.map((call) => call[2].requireFace)).toEqual([false, true]);
		});
	});

	// A bad recordPulseCheckInputs length is a caller's mistake found from the options alone: it is refused
	// before the session loads a face finder or an engine, so nothing is left running that nobody can dispose.
	test("refuses a bad recordPulseCheckInputs length before it loads anything", async () => {
		for (const seconds of [0, -5, Number.NaN]) {
			await expect(
				createRppgSession({ video: document.createElement("video"), faceMesh: "auto", recordPulseCheckInputs: { seconds } }),
			).rejects.toThrow(RangeError);
		}
		expect(mockedLoadFaceMesh).not.toHaveBeenCalled();
		expect(mockedLoadWasmBackend).not.toHaveBeenCalled();
		expect(mockedMediaPipeFrameSource).not.toHaveBeenCalled();
		expect(mockedMediaPipeFaceFrameSource).not.toHaveBeenCalled();
	});
});
