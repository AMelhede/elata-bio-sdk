import {
	computeRmssdMs,
	detectBeatsViaHilbertPhase,
	type PulsePeak,
} from "../pulseAnalysis";

// A clean sinusoidal pulse at a known rate, sampled on a fixed frame grid.
function makeSinePulse(
	bpm: number,
	fs: number,
	durationSec: number,
	noise = 0,
): PulsePeak[] {
	const freq = bpm / 60;
	const dt = 1000 / fs;
	const out: PulsePeak[] = [];
	const n = Math.round(durationSec * fs);
	for (let i = 0; i < n; i++) {
		const tMs = i * dt;
		const value =
			Math.sin((2 * Math.PI * freq * tMs) / 1000) +
			(noise ? (Math.sin(i * 12.9898) * 43758.5453) % noise : 0);
		out.push({ value, time: tMs });
	}
	return out;
}

describe("computeRmssdMs", () => {
	test("matches the textbook successive-difference formula", () => {
		// diffs: +50, -50, +50 -> mean square = 2500 -> sqrt = 50.
		expect(computeRmssdMs([800, 850, 800, 850])).toBeCloseTo(50, 6);
	});

	test("returns null for fewer than two intervals", () => {
		expect(computeRmssdMs([])).toBeNull();
		expect(computeRmssdMs([900])).toBeNull();
	});
});

describe("detectBeatsViaHilbertPhase", () => {
	test("recovers the beat rate from a clean synthetic pulse", () => {
		const data = makeSinePulse(60, 30, 30);
		const { ibisMs, beatTimesMs } = detectBeatsViaHilbertPhase(data, {
			sampleRate: 30,
		});

		expect(beatTimesMs.length).toBeGreaterThan(20);
		const meanIbi = ibisMs.reduce((a, b) => a + b, 0) / ibisMs.length;
		// ~1000 ms at 60 bpm.
		expect(meanIbi).toBeGreaterThan(950);
		expect(meanIbi).toBeLessThan(1050);
	});

	test("recovers a faster rate too", () => {
		const data = makeSinePulse(90, 30, 30);
		const { ibisMs } = detectBeatsViaHilbertPhase(data, { sampleRate: 30 });
		const meanIbi = ibisMs.reduce((a, b) => a + b, 0) / ibisMs.length;
		// ~667 ms at 90 bpm.
		expect(meanIbi).toBeGreaterThan(620);
		expect(meanIbi).toBeLessThan(710);
	});

	test("a clean periodic pulse yields a small beat-to-beat RMSSD", () => {
		const data = makeSinePulse(72, 30, 30);
		const { ibisMs } = detectBeatsViaHilbertPhase(data, { sampleRate: 30 });
		const rmssd = computeRmssdMs(ibisMs) ?? Number.POSITIVE_INFINITY;
		// A perfectly periodic signal should have near-zero RMSSD; allow slack
		// for frame quantization and the naive-DFT edge behaviour.
		expect(rmssd).toBeLessThan(40);
	});

	test("is empty / safe on too-short input", () => {
		expect(detectBeatsViaHilbertPhase([]).ibisMs).toEqual([]);
		expect(
			detectBeatsViaHilbertPhase([
				{ value: 1, time: 0 },
				{ value: 2, time: 33 },
			]).ibisMs,
		).toEqual([]);
	});
});

// The Hilbert transform as first written: a direct O(N^2) DFT. The shipped one runs through an
// FFT of any length (two thirds of the analysis's time went here) and must equal this.
import { hilbertImag } from "../pulseAnalysis";
function hilbertTextbook(x: number[]): number[] {
	const N = x.length;
	const Xre = new Array<number>(N).fill(0);
	const Xim = new Array<number>(N).fill(0);
	for (let k = 0; k < N; k++) {
		let re = 0;
		let im = 0;
		for (let n = 0; n < N; n++) {
			const a = (-2 * Math.PI * k * n) / N;
			re += x[n] * Math.cos(a);
			im += x[n] * Math.sin(a);
		}
		const h = k === 0 || (N % 2 === 0 && k === N / 2) ? 1 : k < N / 2 ? 2 : 0;
		Xre[k] = re * h;
		Xim[k] = im * h;
	}
	const z = new Array<number>(N).fill(0);
	for (let n = 0; n < N; n++) {
		let im = 0;
		for (let k = 0; k < N; k++) {
			const a = (2 * Math.PI * k * n) / N;
			im += Xre[k] * Math.sin(a) + Xim[k] * Math.cos(a);
		}
		z[n] = im / N;
	}
	return z;
}

describe("hilbertImag through the FFT", () => {
	let seed = 5;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	test.each([1, 2, 7, 64, 333, 1350, 1351])("equals the direct transform at %i samples, to 1e-9 of the signal", (N) => {
		const x = Array.from({ length: N }, (_, n) => Math.sin((2 * Math.PI * 1.2 * n) / 30) + 0.3 * rnd());
		const a = hilbertImag(x);
		const b = hilbertTextbook(x);
		const scale = Math.max(1, ...x.map(Math.abs));
		expect(a).toHaveLength(N);
		a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(1e-9 * scale));
	});
	test("turns a cosine of whole cycles into its sine", () => {
		const N = 600;
		const x = Array.from({ length: N }, (_, n) => Math.cos((2 * Math.PI * 12 * n) / N));
		hilbertImag(x).forEach((v, n) => expect(Math.abs(v - Math.sin((2 * Math.PI * 12 * n) / N))).toBeLessThan(1e-9));
	});
	test("an empty window gives an empty answer", () => {
		expect(hilbertImag([])).toEqual([]);
	});
});
