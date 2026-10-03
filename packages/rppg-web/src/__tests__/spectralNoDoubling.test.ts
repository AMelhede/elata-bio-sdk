import { estimateDominantBpm } from "../pulseAnalysis";

// A real pulse wave carries a strong second harmonic (the dicrotic notch). The estimator used
// to jump to twice the strongest rate whenever that harmonic exceeded 35% of the peak below
// 85 bpm, so a correct 70 read as 140. Measured with the built SDK on 255 MCD-rPPG recordings
// with finger-sensor truth (POS fuser, frame grid on): right 49% of seconds with the jump,
// 54% without; with the old CHROM fuser, 26% with and 27% without.

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

	test("a rate whose second harmonic is the strongest line still reads the strongest line", () => {
		const r = estimateDominantBpm(wave(55, 1.5), fs, 0.7, 3.3);
		expect(Math.abs(r!.bpm - 110)).toBeLessThan(3);
	});
});
