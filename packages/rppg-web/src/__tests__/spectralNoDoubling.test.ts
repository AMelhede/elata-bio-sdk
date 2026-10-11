import { analyzePulseWindow, estimateDominantBpm } from "../pulseAnalysis";
import { RppgProcessor } from "../rppgProcessor";

// A pulse wave is not a sine: its steep rise and dicrotic notch put energy at twice the rate, and
// that second harmonic can exceed a third of the fundamental. The estimator used to jump to twice
// the strongest rate whenever the line there held over 35% of the peak below 85 bpm, so a correct
// 70 read as 140. The cases below are synthetic known answers.
//
// What the rule gave up: a signal whose strongest line sits at half its true rate (a true 140 with
// a stronger line at 70) has the same spectrum as a 70 bpm pulse with a strong second harmonic.
// The rule doubled both; the estimator now reads the strongest line for both, and the 70 bpm pulse
// is the common one.

const fs = 30;
const wave = (bpm: number, h2: number, seconds = 10) =>
	Array.from({ length: fs * seconds }, (_, i) => {
		const t = i / fs;
		const f = bpm / 60;
		return Math.sin(2 * Math.PI * f * t) + h2 * Math.sin(2 * Math.PI * 2 * f * t + 0.8);
	});

describe("estimateDominantBpm keeps the strongest rate", () => {
	test.each([
		[60, 0.5],
		[70, 0.6],
		[80, 0.45],
	])("%i bpm with a second harmonic at %f of the fundamental reads as itself", (bpm, h2) => {
		const r = estimateDominantBpm(wave(bpm, h2), fs, 0.7, 3.3);
		expect(r).not.toBeNull();
		expect(Math.abs(r!.bpm - bpm)).toBeLessThan(3);
	});

	// Unchanged by the fix: the strongest line (110) is above the old rule's 85 bpm limit, so it
	// read 110 before as well. Pinned so the estimator does not start halving without a test.
	test("a rate whose second harmonic is the strongest line still reads the strongest line", () => {
		const r = estimateDominantBpm(wave(55, 1.5), fs, 0.7, 3.3);
		expect(Math.abs(r!.bpm - 110)).toBeLessThan(3);
	});
});

// The spectral rate seeds the autocorrelation, peak and beat-timing estimators in
// analyzePulseWindow, and it is a candidate for RppgProcessor's resolved, Bayes and final rates,
// so the doubling reached the numbers an app reads.
describe("readings built on the spectral rate", () => {
	test("analyzePulseWindow reads 60 from the spectrum and from the beats of a 60 bpm pulse", () => {
		const samples = wave(60, 0.5).map((intensity, i) => ({
			timestampMs: (i * 1000) / fs,
			intensity,
			skinRatio: 0.9,
			motion: 0.01,
			clipRatio: 0.01,
		}));
		const analysis = analyzePulseWindow(samples);
		expect(analysis?.spectral).not.toBeNull();
		expect(analysis?.peaks).not.toBeNull();
		expect(Math.abs(analysis!.spectral!.bpm - 60)).toBeLessThan(3);
		expect(Math.abs(analysis!.peaks!.bpm - 60)).toBeLessThan(3);
	});

	const idleBackend = () => {
		const metrics = () => ({ bpm: null, confidence: 0.1, signal_quality: 0.9 });
		const pipeline = {
			push_sample_rgb_meta: jest.fn(),
			get_metrics: jest.fn(metrics),
			getMetrics: jest.fn(metrics),
			free: jest.fn(),
		};
		return { newPipeline: jest.fn(() => pipeline) };
	};

	// Equal colour channels, as in the other processor tests, so the processor analyses the
	// green value itself. The backend offers no rate, so the reading comes from the window
	// analysis alone.
	test.each([
		[60, 0.5],
		[72, 0.4],
	])("RppgProcessor reads %i bpm with a second harmonic at %f of the fundamental", (bpm, h2) => {
		const processor = new RppgProcessor(idleBackend(), fs, 10);
		wave(bpm, h2, 30).forEach((value, i) => {
			const level = 0.5 + 0.02 * value;
			processor.pushSampleRgbMeta((i * 1000) / fs, level, level, level, 0.9, 0.01, 0.01);
		});
		const metrics = processor.getMetrics();
		expect(metrics.bpm).not.toBeNull();
		expect(Math.abs(metrics.bpm! - bpm)).toBeLessThan(3);
	});
});
