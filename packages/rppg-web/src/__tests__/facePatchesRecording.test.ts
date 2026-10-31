import { DemoRunner } from "../demoRunner";
import { FACE_PATCH_COUNT, FACE_PATCH_LAYOUT_ID, facePatchesFromFrame } from "../facePatches";
import type { Frame, FrameSource } from "../frameSource";
import { PulseCheck } from "../pulseCheck";
import { RecordingPulseCheck, parsePulseCheckRecording, replayPulseCheck, serializePulseCheckRecording } from "../pulseCheckRecording";
import { sessionPulseCheck } from "../rppgSession";

// recordPulseCheckInputs: { facePatches: true } keeps the 115 skin patches (facePatches.ts) of every frame the check is
// pushed, so a stable or finer face region can be scored offline on files from testers' own devices, the way the lab
// capture is scored. Recorded only: nothing reads it, and a check that does not keep it never has it computed.

const W = 160;
const H = 120;
const MESH = Array.from({ length: 478 }, (_, i) => ({ x: 0.35 + 0.3 * ((i % 22) / 21), y: 0.25 + 0.55 * (Math.floor(i / 22) / 21), z: 0 }));
const ROIS = [
	{ x: 72, y: 36, w: 16, h: 8 },
	{ x: 62, y: 60, w: 10, h: 10 },
	{ x: 88, y: 60, w: 10, h: 10 },
];
/** A skin-coloured frame with a 70 bpm pulse in green, so the YCbCr mask keeps the face's pixels. */
function frameAt(t: number): Frame {
	const data = new Uint8ClampedArray(W * H * 4);
	const g = Math.round(120 + 3 * Math.sin((2 * Math.PI * 70 * t) / 60000));
	for (let i = 0; i < W * H; i++) {
		data[4 * i] = 200;
		data[4 * i + 1] = g;
		data[4 * i + 2] = 100;
		data[4 * i + 3] = 255;
	}
	return { data, width: W, height: H, timestampMs: t, rois: ROIS, landmarks: MESH } as Frame;
}

class Source implements FrameSource {
	onFrame: ((frame: Frame) => void) | null = null;
	async start(): Promise<void> {}
	async stop(): Promise<void> {}
}
const proc = {
	pushFusedSample: jest.fn(),
	pushSampleRgbMeta: jest.fn(),
	getMetrics: () => ({ bpm: 70, confidence: 0.6, signal_quality: 0.5 }),
	getBackendFailure: () => null,
	reset: jest.fn(),
	resetSignal: jest.fn(),
};
describe("facePatches: which checks want them", () => {
	test("only a recording built with facePatches wants them", () => {
		expect(new PulseCheck().wantsFacePatches).toBe(false);
		expect(new RecordingPulseCheck().wantsFacePatches).toBe(false);
		expect(new RecordingPulseCheck({ facePatches: true }).wantsFacePatches).toBe(true);
		expect(sessionPulseCheck({ recordPulseCheckInputs: { facePatches: true } })?.wantsFacePatches).toBe(true);
		expect(sessionPulseCheck({ recordPulseCheckInputs: { seconds: 60 } })?.wantsFacePatches).toBe(false);
		expect(sessionPulseCheck({ recordPulseCheckInputs: true })?.wantsFacePatches).toBe(false);
	});
});

describe("facePatches: the recorded field", () => {
	const regions = [
		{ r: 0.8, g: 0.5, b: 0.4 },
		{ r: 0.7, g: 0.45, b: 0.35 },
		{ r: 0.7, g: 0.46, b: 0.36 },
	];
	const patches = facePatchesFromFrame(frameAt(0), MESH);
	test("the fixture mesh gives every patch", () => {
		expect(patches).not.toBeNull();
		expect(patches?.values.length).toBe(FACE_PATCH_COUNT * 5);
	});

	test("event [11] holds the box (1 decimal) and every value; [9] and [10] null when their switches are off", () => {
		const rec = new RecordingPulseCheck({ facePatches: true });
		rec.push(1000, regions, undefined, undefined, undefined, undefined, { facePatches: patches });
		const r = rec.getRecording();
		expect(r.facePatchLayout).toBe(FACE_PATCH_LAYOUT_ID);
		const e = r.events[0] as unknown[];
		expect(e[9]).toBeNull();
		expect(e[10]).toBeNull();
		const p = e[11] as number[];
		const box = patches?.box.map((v) => Math.round(v * 10) / 10);
		expect(p.slice(0, 4)).toEqual(box);
		expect(p.slice(4)).toEqual(Array.from(patches?.values ?? []));
		// Survives the file.
		const back = parsePulseCheckRecording(serializePulseCheckRecording(r));
		expect((back.events[0] as unknown[])[11]).toEqual(p);
		expect(back.facePatchLayout).toBe(FACE_PATCH_LAYOUT_ID);
	});

	test("a frame with no mesh writes null; a recording without the option writes nothing and no layout", () => {
		const rec = new RecordingPulseCheck({ facePatches: true });
		rec.push(1000, regions, undefined, undefined, undefined, undefined, { facePatches: null });
		expect((rec.getRecording().events[0] as unknown[])[11]).toBeNull();
		const off = new RecordingPulseCheck();
		off.push(1000, regions, undefined, undefined, undefined, undefined, { facePatches: patches });
		expect((off.getRecording().events[0] as unknown[]).length).toBe(9);
		expect(off.getRecording().facePatchLayout).toBeUndefined();
	});

	test("the foreheadBox and light fields keep their places when patches follow them", () => {
		const rec = new RecordingPulseCheck({ facePatches: true });
		rec.push(1000, regions, undefined, undefined, undefined, undefined, { foreheadBox: regions[0], facePatches: patches });
		const e = rec.getRecording().events[0] as unknown[];
		expect(e[9]).toEqual([0.8, 0.5, 0.4]);
		expect(e[10]).toBeNull();
		expect((e[11] as number[]).length).toBe(4 + FACE_PATCH_COUNT * 5);
	});
});

describe("facePatches: through DemoRunner", () => {
	test("the runner computes them when the recording keeps them, and they match facePatchesFromFrame", async () => {
		const rec = new RecordingPulseCheck({ facePatches: true });
		const source = new Source();
		const runner = new DemoRunner(source, proc as never, { pulseChecker: rec, sampleRate: 30, roiSmoothingAlpha: 0.25, useSkinMask: true, requireFace: true });
		await runner.start();
		const f = frameAt(1000);
		source.onFrame?.(f);
		const frames = rec.getRecording().events.filter((e) => e[0] === "f") as unknown[][];
		expect(frames.length).toBeGreaterThan(0);
		const want = facePatchesFromFrame(f, MESH);
		expect((frames[frames.length - 1][11] as number[]).slice(4)).toEqual(Array.from(want?.values ?? []));
		await runner.stop();
	});

	test("recording patches changes no output: the replay is the same with and without them", async () => {
		const shown: (number | null)[][] = [];
		for (const facePatches of [false, true]) {
			const rec = new RecordingPulseCheck({ facePatches });
			const source = new Source();
			const runner = new DemoRunner(source, proc as never, { pulseChecker: rec, sampleRate: 30, roiSmoothingAlpha: 0.25, useSkinMask: true, requireFace: true });
			await runner.start();
			for (let t = 0; t < 15000; t += 33) source.onFrame?.(frameAt(t));
			await runner.stop();
			shown.push(replayPulseCheck(rec.getRecording()).evaluations.map((e) => e.bpm));
		}
		expect(shown[1]).toEqual(shown[0]);
		expect(shown[0].length).toBeGreaterThan(5);
	});
});

