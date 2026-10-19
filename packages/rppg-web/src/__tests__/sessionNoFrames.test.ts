import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import { RppgProcessor } from "../rppgProcessor";
import { RppgSession } from "../rppgSession";

// The camera stops sending frames mid-reading (a frozen driver, an ended track, a hidden tab, a
// locked screen). Nothing new reaches the engine or the pulse check, so both keep their last state,
// and before this fix the session kept reporting that last number for as long as the frames stayed
// away. The frames' own clock stops with them, so staleness is judged on a wall clock (`now`).

class Source implements FrameSource {
	onFrame: ((f: Frame) => void) | null = null;
	async start() {}
	async stop() {}
	emit(f: Frame) {
		this.onFrame?.(f);
	}
}

/** A face with a 66 bpm colour pulse and sensor dither, so the engine reads a rate from it. */
const seed = { v: 7 };
function face(tMs: number): Frame {
	const data = new Uint8ClampedArray(20 * 20 * 4);
	const p = Math.sin((2 * Math.PI * 66 * tMs) / 60000);
	const dither = () => {
		seed.v = (seed.v * 1664525 + 1013904223) >>> 0;
		return seed.v / 2 ** 32 - 0.5;
	};
	for (let i = 0; i < data.length; i += 4) {
		data[i] = 200 * (1 - 0.01 * p) + dither();
		data[i + 1] = 140 * (1 - 0.03 * p) + dither();
		data[i + 2] = 110 * (1 - 0.015 * p) + dither();
		data[i + 3] = 255;
	}
	return { data, width: 20, height: 20, timestampMs: tMs, roi: { x: 5, y: 5, w: 10, h: 10 } };
}

async function setup(opts: { fixes?: { noFramesNoReading: boolean }; checkSaysMeasured?: boolean; vitals?: boolean } = {}) {
	const pipeline = {
		push_sample: jest.fn(),
		push_sample_rgb_meta: jest.fn(),
		free: jest.fn(),
		get_metrics: jest.fn(() => ({ bpm: 72, confidence: 0.8, signal_quality: 0.7, hrv_rmssd: 40, reason_codes: ["LOW_SNR"] })),
	};
	const processor = new RppgProcessor({ newPipeline: () => pipeline } as never, 30, 10);
	const src = new Source();
	const clock = { ms: 1000 };
	const runner = new DemoRunner(src, processor, {
		sampleRate: 30,
		requireFace: true,
		fixes: opts.fixes,
		now: () => clock.ms,
	});
	const pulseCheck = opts.checkSaysMeasured
		? ({ getState: () => ({ verdict: "measured", bpm: 70, snrDb: 6, streak: 8, wallMatch: false }) } as never)
		: undefined;
	const session = new RppgSession(src, processor, runner, "wasm", "face_mesh", {
		pulseCheck,
		experimentalVitals: opts.vitals,
	});
	await runner.start();
	let t = 0;
	/** `seconds` of frames at 30 a second, the wall clock moving with them. */
	const frames = (seconds: number) => {
		for (let i = 0; i < seconds * 30; i++) {
			t += 1000 / 30;
			clock.ms += 1000 / 30;
			src.emit(face(t));
		}
	};
	/** The wall clock moves `ms` with no frame arriving. */
	const wait = (ms: number) => {
		clock.ms += ms;
	};
	return { session, runner, processor, clock, frames, wait };
}

describe("RppgSession when the camera stops sending frames", () => {
	it("reports no heart rate once no frame has arrived for over a second, and reads again when frames return", async () => {
		const { session, frames, wait } = await setup();
		frames(3);
		const before = session.getMetrics().bpm;
		expect(before).not.toBeNull();
		// A second exactly: the same bound the pulse check and the chest motion use for a gap in frames.
		wait(1000);
		expect(session.getMetrics().bpm).toBe(before);
		wait(1);
		const stopped = session.getMetrics();
		expect(stopped.bpm).toBeNull();
		expect(stopped.hrv_rmssd).toBeNull();
		expect(stopped.confidence).toBe(0);
		expect(stopped.reason_codes).toEqual(["LOW_SNR", "no_frames"]);
		expect(session.getDiagnostics().framesStopped).toBe(true);
		// Still nothing however long they stay away.
		wait(60000);
		expect(session.getMetrics().bpm).toBeNull();
		frames(0.1);
		expect(session.getMetrics().reason_codes).not.toContain("no_frames");
		expect(session.getDiagnostics().framesStopped).toBe(false);
	});

	it("does not show the pulse check's proven rate while no frames arrive", async () => {
		const { session, frames, wait } = await setup({ checkSaysMeasured: true });
		frames(3);
		expect(session.getMetrics().bpm).toBe(70);
		wait(1500);
		expect(session.getMetrics().bpm).toBeNull();
		expect(session.getMetrics().reason_codes).toContain("no_frames");
	});

	it("hands over no experimental HRV while no frames arrive", async () => {
		const { session, frames, wait } = await setup({ vitals: true });
		frames(20);
		session.getMetrics();
		expect(session.getExperimentalVitals()?.hrvRmssd).not.toBeNull();
		wait(1500);
		session.getMetrics();
		expect(session.getExperimentalVitals()?.hrvRmssd).toBeNull();
	});

	it("does not count the time the read itself spends analysing as frames stopped", async () => {
		// No frame can arrive while getMetrics() runs (it holds the main thread), so its own analysis
		// time is not the camera's: on a slow phone one analysis can take most of a second.
		const { session, frames, processor, clock } = await setup();
		frames(3);
		const analyse = processor.getMetrics.bind(processor);
		processor.getMetrics = () => {
			clock.ms += 1100;
			return analyse();
		};
		expect(session.getMetrics().reason_codes).not.toContain("no_frames");
		frames(0.1);
		processor.getDebugSnapshot = ((snap) => (nowMs?: number) => {
			clock.ms += 1100;
			return snap(nowMs);
		})(processor.getDebugSnapshot.bind(processor));
		expect(session.getDiagnostics().framesStopped).toBe(false);
	});

	it("says so for a camera that never sends a frame", async () => {
		const { session, wait } = await setup();
		wait(1500);
		expect(session.getMetrics().reason_codes).toContain("no_frames");
	});

	it("leaves a stopped session's last read as published: the app stopped it, the camera did not", async () => {
		const { session, runner, frames, wait } = await setup();
		frames(3);
		const last = session.getMetrics().bpm;
		expect(last).not.toBeNull();
		await runner.stop();
		wait(5000);
		expect(session.getMetrics().bpm).toBe(last);
		expect(session.getDiagnostics().framesStopped).toBe(false);
	});

	it("switch noFramesNoReading off: the last number stays, as published", async () => {
		const { session, frames, wait } = await setup({ fixes: { noFramesNoReading: false } });
		frames(3);
		const last = session.getMetrics().bpm;
		expect(last).not.toBeNull();
		wait(5000);
		expect(session.getMetrics().bpm).toBe(last);
		expect(session.getDiagnostics().framesStopped).toBe(false);
	});
});
