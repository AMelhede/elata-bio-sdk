import { RppgProcessor } from "../rppgProcessor";

// The rate RppgProcessor shows (`bpm`, and `fused_bpm` without a Muse) is its camera
// calibration's prediction from the spectral and autocorrelation rates. That model is
// never trained against another sensor: until a read passes with a resolved confidence
// of 0.55 it predicts their plain mean, and after that it moves toward the processor's
// own resolved rate by a small step per read. So when the two estimators disagree, the
// processor shows a number neither of them measured, and the rate its own resolver chose
// (from the engine, the spectral, autocorrelation and peak rates, the rate history and
// the tracker) arrives late. With `calibrationBlend: false` it shows the resolved rate.
//
// The engines here are stand-ins that report the true rate, so the processor's gate can
// pass. The samples are grey (R = G = B), as a fused sample from DemoRunner: the
// processor's colour step passes them unchanged. The pulse has a second harmonic at 0.4
// of the fundamental. On it the autocorrelation reads a clean 120 at 60 (its doubling-lag
// test compares confidences clamped at 1, so it halves every clean rate over 110), and
// the spectral estimate reads a 72 at 144 (its doubling rule fires below 85 bpm), so both
// disagreements an app meets are here.

function engineAt(bpm: number | null) {
	return {
		newPipeline: () => ({
			push_sample_rgb() {},
			push_sample_rgb_meta() {},
			get_metrics: () => ({ bpm, confidence: 0.8, signal_quality: 0.9 }),
		}),
	};
}

type Read = {
	bpm: number | null;
	calibrated: number | null;
	resolved: number | null;
	confidence: number;
	trained: boolean;
};

function run(
	bpm: number,
	fs: number,
	opts: { engine?: number | null; everySecond?: boolean; calibrationBlend?: boolean } = {},
): Read[] {
	const options = opts.calibrationBlend === undefined ? {} : { calibrationBlend: opts.calibrationBlend };
	const p = new RppgProcessor(engineAt(opts.engine === undefined ? bpm : opts.engine), fs, 10, options);
	const reads: Read[] = [];
	const read = () => {
		const m = p.getMetrics();
		reads.push({
			bpm: m.bpm ?? null,
			calibrated: m.calibrated_bpm ?? null,
			resolved: m.resolved_bpm ?? null,
			confidence: m.confidence,
			trained: m.calibration_trained === true,
		});
	};
	for (let i = 0; i < 30 * fs; i++) {
		const ph = (2 * Math.PI * bpm * i) / (60 * fs);
		const v = 0.5 + 0.02 * (Math.sin(ph) + 0.4 * Math.sin(2 * ph + 0.8));
		p.pushSampleRgbMeta((i * 1000) / fs, v, v, v, 1, 0, 0);
		if (opts.everySecond && (i + 1) % fs === 0 && i >= 16 * fs) read();
	}
	read();
	p.dispose();
	return reads;
}

describe("RppgProcessor calibrationBlend", () => {
	test.each([
		[120, 30],
		[120, 20],
		[140, 30],
		[72, 30],
	])("read once after 30 s, a clean %i at %i a second shows the resolved rate with calibrationBlend: false", (bpm, fs) => {
		const [last] = run(bpm, fs, { calibrationBlend: false });
		expect(last.resolved).not.toBeNull();
		expect(Math.abs(last.resolved! - bpm)).toBeLessThanOrEqual(1);
		expect(last.bpm).toBe(last.resolved);
		// the calibration still trains and is still reported
		expect(last.trained).toBe(true);
		expect(last.calibrated).not.toBeNull();
	});

	test.each([
		[120, 30, 95.7],
		[140, 30, 114.1],
		[72, 30, 98.3],
	])("by default, the blend: a clean %i at %i a second shows %f on one read", (bpm, fs, blend) => {
		for (const calibrationBlend of [undefined, true]) {
			const [last] = run(bpm, fs, { calibrationBlend });
			expect(last.bpm).toBe(last.calibrated);
			expect(Math.abs(last.bpm! - blend)).toBeLessThan(0.1);
			expect(Math.abs(last.resolved! - bpm)).toBeLessThanOrEqual(1);
		}
	});

	test("read once a second from 17 s, a clean 120 shows 120 from the first read", () => {
		const reads = run(120, 30, { everySecond: true, calibrationBlend: false });
		expect(reads.length).toBeGreaterThan(10);
		for (const r of reads) expect(Math.abs(r.bpm! - 120)).toBeLessThanOrEqual(1);
		// the default climbs from the blend toward it, one small step per read
		const blend = run(120, 30, { everySecond: true }).map((r) => r.bpm!);
		expect(blend[0]).toBeLessThan(100);
		expect(blend[1]).toBeGreaterThan(blend[0]);
	});

	// To a millionth of a beat: where the estimators agree (90 sits between both rules'
	// limits), the blend and the resolved rate differ only by rounding.
	test("where the estimators agree, every read is the same rate either way", () => {
		const off = run(90, 30, { everySecond: true, calibrationBlend: false });
		const on = run(90, 30, { everySecond: true });
		expect(off.length).toBe(on.length);
		off.forEach((r, i) => expect(r.bpm!).toBeCloseTo(on[i].bpm!, 6));
		for (const r of off) expect(Math.abs(r.bpm! - 90)).toBeLessThanOrEqual(1);
	});

	test("a read the processor refuses shows nothing either way", () => {
		for (const calibrationBlend of [true, false]) {
			const [last] = run(120, 30, { engine: null, calibrationBlend });
			expect(last.bpm).toBeNull();
			expect(last.confidence).toBeLessThanOrEqual(0.3);
		}
	});
});
