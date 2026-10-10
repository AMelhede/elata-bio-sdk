// Known answer through the path apps get by default: createRppgSession() with no options
// finds a face (face_mesh mode), DemoRunner samples the forehead and both cheeks, the
// multi-region fuser projects and band-passes each region, and the fused pulse reaches the
// processor through pushFusedSample. Only the camera, the face finder and the WASM core are
// stubbed: the frames are synthetic pixels, so the true rate is known.

jest.mock("../mediapipeLoader", () => ({
	loadFaceLandmarker: jest.fn(async () => ({
		detectForVideo: jest.fn(() => ({ faceLandmarks: [] })),
	})),
}));

jest.mock("../videoPlayback", () => ({
	ensureVideoPlaying: jest.fn(async () => undefined),
}));

jest.mock("../wasmBackend", () => ({
	loadWasmBackend: jest.fn(async () => ({
		newPipeline: () => ({
			push_sample: jest.fn(),
			get_metrics: jest.fn(() => ({
				bpm: null,
				confidence: 0,
				signal_quality: 0,
			})),
			free: jest.fn(),
		}),
	})),
	createUnavailableBackend: jest.fn(),
}));

jest.mock("../mediaPipeFaceFrameSource", () => ({
	MediaPipeFaceFrameSource: jest
		.fn()
		.mockImplementation(function MediaPipeFaceFrameSource(this: any) {
			this.onFrame = null;
			this.start = jest.fn(async () => {});
			this.stop = jest.fn(async () => {});
		}),
}));

import type { Frame } from "../frameSource";
import { MediaPipeFaceFrameSource } from "../mediaPipeFaceFrameSource";
import { createRppgSession } from "../rppgSession";

const FS = 30;
const TRUE_BPM = 72;
const SECONDS = 20;
const WIDTH = 30;
const HEIGHT = 30;
// Forehead, left cheek, right cheek: the order DemoRunner hands to the fuser.
const ROIS = [
	{ x: 10, y: 0, w: 10, h: 10 },
	{ x: 0, y: 15, w: 10, h: 10 },
	{ x: 20, y: 15, w: 10, h: 10 },
];
// A skin tone that passes the SDK's YCbCr skin mask.
const SKIN = [200, 150, 120] as const;
// The pulse moves the colour along the blood-volume direction, about (0.33, 0.77, 0.53)
// of each channel (de Haan and van Leest 2014), 0.4% deep: inside the 0.5 to 2% range of
// real skin. Each pixel also gets sensor noise of one grey level (sd), so each 100-pixel
// region carries about 0.1 level of noise per channel after averaging, quieter than a
// webcam; the pixels are then rounded to integers, as a camera delivers them.
const PULSE_DIRECTION = [0.33, 0.77, 0.53] as const;
const PULSE_DEPTH = 0.004;
const PIXEL_NOISE = 1;

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
}

function gauss(r: () => number) {
	let u = 0;
	while (u === 0) u = r();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function frameAt(i: number, r: () => number): Frame {
	const p = PULSE_DEPTH * Math.sin((2 * Math.PI * (TRUE_BPM / 60) * i) / FS);
	const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
	for (let px = 0; px < WIDTH * HEIGHT; px++) {
		for (let c = 0; c < 3; c++) {
			data[px * 4 + c] =
				SKIN[c] * (1 + PULSE_DIRECTION[c] * p) + PIXEL_NOISE * gauss(r);
		}
		data[px * 4 + 3] = 255;
	}
	return {
		data,
		width: WIDTH,
		height: HEIGHT,
		rois: ROIS,
		timestampMs: (i * 1000) / FS,
	};
}

// Strongest frequency in 0.7 to 3.5 Hz (42 to 210 bpm) of a Hann-windowed series.
function peakBpm(x: number[]) {
	let best = 0;
	let bestHz = 0;
	for (let hz = 0.7; hz <= 3.5; hz += 0.01) {
		let re = 0;
		let im = 0;
		for (let i = 0; i < x.length; i++) {
			const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
			re += w * x[i]! * Math.cos((2 * Math.PI * hz * i) / FS);
			im += w * x[i]! * Math.sin((2 * Math.PI * hz * i) / FS);
		}
		if (re * re + im * im > best) {
			best = re * re + im * im;
			bestHz = hz;
		}
	}
	return bestHz * 60;
}

describe("createRppgSession default multi-region fusion", () => {
	// Fixed seeds keep the run reproducible.
	test.each([2, 3, 4])(
		"the fused pulse a default session hands the processor peaks at the true 72 bpm (seed %i)",
		async (seed) => {
			const session = await createRppgSession({
				video: document.createElement("video"),
			});
			expect(session.faceTrackingMode).toBe("face_mesh");
			const sources = (MediaPipeFaceFrameSource as unknown as jest.Mock).mock
				.instances;
			const source = sources[sources.length - 1] as {
				onFrame: (frame: Frame) => void;
			};
			const r = rng(seed);
			for (let i = 0; i < SECONDS * FS; i++) source.onFrame(frameAt(i, r));

			// Every one of the last 10 s of samples came from the fuser.
			const diagnostics = session.getDiagnostics();
			expect(diagnostics.processorMethod).toBe("fused");
			expect(diagnostics.framesWithFusion).toBeGreaterThanOrEqual(10 * FS);
			const fused = session
				.getTraceSnapshot(10 * FS)
				.points.map((point) => point.intensity);
			expect(fused).toHaveLength(10 * FS);
			expect(Math.abs(peakBpm(fused) - TRUE_BPM)).toBeLessThanOrEqual(2);
			await session.dispose();
		},
	);
});
