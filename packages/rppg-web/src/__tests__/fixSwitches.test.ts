import { RPPG_WEB_BUILD_VERSION } from "../buildInfo";
import { DemoRunner } from "../demoRunner";
import { resolveFixSwitches } from "../fixSwitches";
import type { Frame, FrameSource } from "../frameSource";
import { estimateDominantBpm } from "../pulseAnalysis";
import { RppgProcessor } from "../rppgProcessor";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// Every fix in this test build has an on/off switch, on by default, and "off" must give back
// the published behaviour for that part. These tests pin both directions for each switch.

class MockFrameSource implements FrameSource {
	onFrame: ((frame: Frame) => void) | null = null;
	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	emit(frame: Frame) {
		this.onFrame?.(frame);
	}
}

function frame(timestampMs: number, withRegions: boolean): Frame {
	const width = 30;
	const height = 30;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = 200;
		data[i + 1] = 150;
		data[i + 2] = 120;
		data[i + 3] = 255;
	}
	return withRegions
		? {
				data,
				width,
				height,
				timestampMs,
				rois: [
					{ x: 0, y: 0, w: 10, h: 10 },
					{ x: 10, y: 10, w: 10, h: 10 },
					{ x: 20, y: 0, w: 10, h: 10 },
				],
			}
		: { data, width, height, timestampMs };
}

function mockProcessor() {
	const order: number[] = [];
	const push = (t: number) => {
		order.push(t);
	};
	return {
		order,
		pushFusedSample: jest.fn(push),
		pushSampleRgbMeta: jest.fn(push),
		getMetrics: jest.fn(),
		reset: jest.fn(),
	};
}

describe("resolveFixSwitches", () => {
	const names = [
		"noFaceNoReading",
		"colourProjectionFix",
		"realFrameRate",
		"posFusion",
		"noRateDoubling",
	];
	test("every fix is on by default", () => {
		for (const v of [undefined, null, true, {}]) {
			const r = resolveFixSwitches(v as never);
			for (const n of names) expect(r[n as keyof typeof r]).toBe(true);
		}
	});
	test("sparseFaceFinder is off unless set to true (measured not to earn a default); the rest stay on", () => {
		for (const v of [undefined, null, true, {}]) {
			const r = resolveFixSwitches(v as never);
			expect(r.sparseFaceFinder).toBe(false);
			expect(r.steadyAnalysis && r.analysisWorker && r.faceFinderTrial && r.analysisWidth).toBe(true);
		}
		expect(resolveFixSwitches({ sparseFaceFinder: true }).sparseFaceFinder).toBe(true);
		expect(resolveFixSwitches(false).sparseFaceFinder).toBe(false);
	});
	test("false turns every fix off", () => {
		const r = resolveFixSwitches(false);
		for (const n of names) expect(r[n as keyof typeof r]).toBe(false);
	});
	test("an object turns off only the fixes set to false", () => {
		const r = resolveFixSwitches({ posFusion: false });
		expect(r.posFusion).toBe(false);
		expect(r.noFaceNoReading && r.realFrameRate && r.noRateDoubling).toBe(true);
		expect(r.colourProjectionFix).toBe(true);
	});
});

describe("switch noFaceNoReading", () => {
	async function wall(fixes?: object) {
		const src = new MockFrameSource();
		const proc = mockProcessor();
		const runner = new DemoRunner(src as never, proc as never, {
			sampleRate: 30,
			requireFace: true,
			...(fixes ? { fixes } : {}),
		});
		await runner.start();
		for (let i = 0; i < 40; i++) src.emit(frame(1000 + i * 33.3, false));
		return { proc, runner };
	}
	test("on (default): a frame with no face is not read", async () => {
		const { proc, runner } = await wall();
		expect(proc.pushSampleRgbMeta).not.toHaveBeenCalled();
		expect(runner.getDiagnostics().lastDropReason).toBe("no_face");
		expect(runner.faceAbsentMs()).toBeGreaterThan(1000);
	});
	test("off: the published fallback square is read, as in 0.14.0", async () => {
		const { proc, runner } = await wall({ noFaceNoReading: false });
		expect(proc.pushSampleRgbMeta).toHaveBeenCalledTimes(40);
		expect(runner.getDiagnostics().lastRoiSource).toBe("fallback_roi");
		expect(runner.faceAbsentMs()).toBe(0);
	});
});

describe("switch realFrameRate", () => {
	async function slowCamera(fixes?: object) {
		const src = new MockFrameSource();
		const proc = mockProcessor();
		const runner = new DemoRunner(src as never, proc as never, {
			sampleRate: 30,
			useSkinMask: true,
			multiRoiFusion: true,
			...(fixes ? { fixes } : {}),
		});
		await runner.start();
		const times = Array.from({ length: 31 }, (_, i) => 1000 + i * (1000 / 15));
		for (const t of times) src.emit(frame(t, true));
		return { order: proc.order, times };
	}
	test("on (default): a 15 fps camera is filled in to the 30 a second grid", async () => {
		const { order } = await slowCamera();
		expect(order.length).toBe(61);
	});
	test("off: one sample per camera frame at the frame's own time, as in 0.14.0", async () => {
		const { order, times } = await slowCamera({ realFrameRate: false });
		expect(order).toEqual(times);
	});
});

describe("switch posFusion", () => {
	const projection = (runner: DemoRunner) =>
		(runner as never as { fuser: { chrom: Record<string, object> } }).fuser
			.chrom.forehead.constructor.name;
	const make = (opts: object) =>
		new DemoRunner(new MockFrameSource() as never, mockProcessor() as never, {
			sampleRate: 30,
			...opts,
		});
	test("on (default): the fuser projects with POS", () => {
		expect(projection(make({}))).toBe("PosPulseModel");
	});
	test("off: CHROM, as in 0.14.0", () => {
		expect(projection(make({ fixes: { posFusion: false } }))).toBe(
			"ChromPulseModel",
		);
	});
	test("an explicit fusionProjection wins over the switch", () => {
		expect(
			projection(
				make({ fixes: { posFusion: false }, fusionProjection: "pos" }),
			),
		).toBe("PosPulseModel");
	});
});

describe("switch noRateDoubling", () => {
	const fs = 30;
	const wave = Array.from({ length: fs * 10 }, (_, i) => {
		const t = i / fs;
		return Math.sin(2 * Math.PI * (70 / 60) * t) + 0.6 * Math.sin(2 * Math.PI * (140 / 60) * t + 0.8);
	});
	test("on (default): a 70 with a strong second harmonic reads 70", () => {
		expect(Math.abs(estimateDominantBpm(wave, fs, 0.7, 3.3)!.bpm - 70)).toBeLessThan(3);
	});
	test("off: the published rule doubles it to 140, as in 0.14.0", () => {
		const r = estimateDominantBpm(wave, fs, 0.7, 3.3, { doublingRule: true });
		expect(Math.abs(r!.bpm - 140)).toBeLessThan(3);
	});
	test("the processor passes the switch to its analysis", () => {
		const backend = { newPipeline: () => ({}) };
		expect(new RppgProcessor(backend, 30, 10).fixes.noRateDoubling).toBe(true);
		expect(
			new RppgProcessor(backend, 30, 10, { fixes: { noRateDoubling: false } }).fixes
				.noRateDoubling,
		).toBe(false);
	});
});

describe("switch colourProjectionFix reaches the WASM core", () => {
	const make = (fixes?: object | boolean) => {
		const set = jest.fn();
		const backend = { newPipeline: () => ({ set_colour_projection_fix: set }) };
		new RppgProcessor(backend, 30, 10, fixes === undefined ? {} : { fixes });
		return set;
	};
	test("on by default", () => {
		expect(make().mock.calls).toEqual([[true]]);
	});
	test("off when set to false", () => {
		expect(make({ colourProjectionFix: false }).mock.calls).toEqual([[false]]);
		expect(make(false).mock.calls).toEqual([[false]]);
	});
	test("a core without the setter (the published WASM) still works", () => {
		const backend = { newPipeline: () => ({}) };
		expect(() => new RppgProcessor(backend, 30, 10)).not.toThrow();
	});
});

describe("build version", () => {
	test("matches package.json, so every logged result names the exact build", () => {
		const pkg = require("../../package.json") as { version: string };
		expect(RPPG_WEB_BUILD_VERSION).toBe(pkg.version);
	});
});
