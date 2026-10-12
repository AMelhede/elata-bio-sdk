import { FIX_SWITCHES_OFF_BY_DEFAULT, resolveFixSwitches } from "../fixSwitches";
import { RppgProcessor } from "../rppgProcessor";

// The rate the processor shows (`bpm`, and `fused_bpm` without a Muse) used to be its camera calibration's
// prediction from the spectral and autocorrelation rates. That calibration is never trained against another sensor:
// untrained it predicts their plain mean, and after a read whose resolved confidence reaches 0.55 it learns toward
// the processor's own resolved rate by a small step per read. So when those two estimators disagree, the processor
// shows a number neither of them measured, and its own resolver's choice arrives late. A clean 120 (whose
// autocorrelation reads 60) showed 95.7 on one read, and 95.7, 104.1, 109.5, 113.1 ... 119.7 over 14 reads.

// An engine with a rate of its own (here the true one), so the processor's low-confidence gate can pass.
const engineAt = (bpm: number | null) => ({
	newPipeline: () => ({
		push_sample_rgb() {},
		push_sample_rgb_meta() {},
		get_metrics: () => ({ bpm, confidence: 0.8, signal_quality: 0.9 }),
	}),
});

// A grey (R = G = B) pulse with a second harmonic, as a fused sample from the runner: the processor's colour step
// passes it unchanged.
function run(bpm: number, fs: number, opts: { engine?: number | null; everySecond?: boolean; fixes?: object } = {}) {
	const p = new RppgProcessor(engineAt(opts.engine === undefined ? bpm : opts.engine), fs, 10, opts.fixes ? { fixes: opts.fixes as never } : {});
	const reads: { bpm: number | null; calibrated: number | null; resolved: number | null; confidence: number }[] = [];
	const read = () => {
		const m = p.getMetrics();
		reads.push({ bpm: m.bpm ?? null, calibrated: m.calibrated_bpm ?? null, resolved: m.resolved_bpm ?? null, confidence: m.confidence });
		return m;
	};
	for (let i = 0; i < 30 * fs; i++) {
		const ph = (2 * Math.PI * bpm * i) / (60 * fs);
		const v = 0.5 + 0.02 * (Math.sin(ph) + 0.4 * Math.sin(2 * ph + 0.8));
		p.pushSampleRgbMeta((i * 1000) / fs, v, v, v, 1, 0, 0);
		if (opts.everySecond && (i + 1) % fs === 0 && i >= 16 * fs) read();
	}
	const last = read();
	p.dispose();
	return { reads, last };
}

const ON = { noCalibrationBlend: true };

describe("switch noCalibrationBlend: the processor shows its resolved rate", () => {
	test.each([
		[120, 30],
		[120, 20],
		[140, 30],
	])("read once after 30 s, a clean %i at %i a second shows the resolved rate, not the blend", (bpm, fs) => {
		const { last } = run(bpm, fs, { fixes: ON });
		expect(last.resolved_bpm).not.toBeNull();
		expect(Math.abs(last.resolved_bpm! - bpm)).toBeLessThanOrEqual(1);
		expect(last.bpm).toBe(last.resolved_bpm);
		// the calibration is still trained and still reported, as a diagnostic
		expect(last.calibration_trained).toBe(true);
		expect(last.calibrated_bpm).not.toBeNull();
	});

	test("read once a second from 17 s, a clean 120 shows 120 from the first read", () => {
		const { reads } = run(120, 30, { everySecond: true, fixes: ON });
		expect(reads.length).toBeGreaterThan(10);
		for (const r of reads) expect(Math.abs(r.bpm! - 120)).toBeLessThanOrEqual(1);
	});

	test("with the switch off, the published blend: 95.7 on one read for a clean 120", () => {
		const { last } = run(120, 30, { fixes: { noCalibrationBlend: false } });
		expect(last.bpm).toBeCloseTo(last.calibrated_bpm!, 9);
		expect(Math.abs(last.bpm! - 95.7)).toBeLessThan(0.5);
	});

	// The same rate to a millionth of a beat: where the estimators agree the blend and the resolved rate differ only
	// by rounding (72 against 71.99999999999999).
	test("where the estimators agree, every read is the same rate either way", () => {
		const on = run(72, 30, { everySecond: true, fixes: ON }).reads;
		const off = run(72, 30, { everySecond: true, fixes: { noCalibrationBlend: false } }).reads;
		expect(on.length).toBe(off.length);
		on.forEach((r, i) => expect(r.bpm!).toBeCloseTo(off[i].bpm!, 6));
		for (const r of on) expect(Math.abs(r.bpm! - 72)).toBeLessThanOrEqual(1);
	});

	test("the processor's refusal is unchanged: no engine rate and a refused read show nothing either way", () => {
		for (const fixes of [ON, { noCalibrationBlend: false }]) {
			const { last } = run(120, 30, { engine: null, fixes });
			expect(last.bpm ?? null).toBeNull();
			expect(last.confidence).toBeLessThanOrEqual(0.3);
		}
	});

	test("the switch is off by default, and fixes: false leaves it off", () => {
		expect(FIX_SWITCHES_OFF_BY_DEFAULT).toContain("noCalibrationBlend");
		expect(resolveFixSwitches().noCalibrationBlend).toBe(false);
		expect(resolveFixSwitches(false).noCalibrationBlend).toBe(false);
		expect(resolveFixSwitches({ noCalibrationBlend: true }).noCalibrationBlend).toBe(true);
	});
});
