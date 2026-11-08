import { OWN_PULSE_FS, pos, spectrum } from "../pulseCheckCore";

// The pulse check's spectrum is its largest cost (half its time, measured on recorded input). It is
// computed from tables of the window's sines and cosines, made once per window length, instead of a
// sine and a cosine per bin per sample. Speed only: every value must equal the textbook transform below.
function textbook(x: number[]): Array<[number, number]> {
	const N = x.length;
	const han = x.map((v, k) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1))));
	const out: Array<[number, number]> = [];
	for (let fi = 1; fi < N / 2; fi++) {
		const f = (fi * OWN_PULSE_FS) / N;
		if (f > 4) break;
		let re = 0;
		let im = 0;
		for (let k = 0; k < N; k++) {
			const ang = (-2 * Math.PI * fi * k) / N;
			re += han[k] * Math.cos(ang);
			im += han[k] * Math.sin(ang);
		}
		out.push([f, re * re + im * im]);
	}
	return out;
}

// POS as first written: the colour projection is the check's next cost (a fifth of its time). The
// faster one keeps every operation in the same order, so its output must be identical, bit for bit.
function textbookPos(R: number[], G: number[], B: number[]): number[] {
	const win = Math.round(1.6 * OWN_PULSE_FS);
	const h = new Array<number>(R.length).fill(0);
	const sd = (a: number[]) => {
		const m = a.reduce((s, v) => s + v, 0) / a.length;
		return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1;
	};
	for (let n = win; n <= R.length; n++) {
		const m = n - win;
		let mr = 0;
		let mg = 0;
		let mb = 0;
		for (let k = m; k < n; k++) {
			mr += R[k];
			mg += G[k];
			mb += B[k];
		}
		mr /= win;
		mg /= win;
		mb /= win;
		const s1: number[] = [];
		const s2: number[] = [];
		for (let k = m; k < n; k++) {
			const r = R[k] / mr;
			const g = G[k] / mg;
			const b = B[k] / mb;
			s1.push(g - b);
			s2.push(g + b - 2 * r);
		}
		const alpha = sd(s1) / sd(s2);
		let mean = 0;
		const seg = s1.map((v, i) => {
			const y = v + alpha * s2[i];
			mean += y;
			return y;
		});
		mean /= win;
		for (let k = 0; k < win; k++) h[m + k] += seg[k] - mean;
	}
	return h;
}

/** Equal to the textbook form within 1e-9 of the signal's own size (running sums round differently, never more). */
function close(a: number[], b: number[]) {
	expect(a.length).toBe(b.length);
	const scale = Math.max(1e-300, ...b.map(Math.abs));
	const worst = Math.max(0, ...a.map((v, i) => Math.abs(v - b[i])));
	expect(worst / scale).toBeLessThan(1e-9);
}

describe("pulse check colour projection", () => {
	let seed = 11;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	test.each([10, 32, 33, 160, 320])("equals POS as first written, to rounding, at %i samples", (N) => {
		for (let rep = 0; rep < 3; rep++) {
			const p = (k: number) => 0.01 * Math.sin((2 * Math.PI * 1.2 * k) / OWN_PULSE_FS);
			const R = Array.from({ length: N }, (_, k) => 150 * (1 - 0.3 * p(k)) + rnd());
			const G = Array.from({ length: N }, (_, k) => 120 * (1 - p(k)) + rnd());
			const B = Array.from({ length: N }, (_, k) => 100 * (1 - 0.6 * p(k)) + rnd());
			close(pos(R, G, B), textbookPos(R, G, B));
		}
	});

	test("a patch of frozen pixels gives exactly zero, as the textbook form does (no rounding residue)", () => {
		const N = 119;
		const R = Array.from({ length: N }, () => 0.3667450980392157);
		const G = Array.from({ length: N }, () => 0.03686274509803922);
		const B = Array.from({ length: N }, () => 0.030274509803921566);
		expect(pos(R, G, B).every((v) => v === 0)).toBe(true);
	});

	test("a channel that goes flat after its first samples (clipped at 255) is a zero spread too", () => {
		const N = 200;
		const R = Array.from({ length: N }, (_, k) => (k < 40 ? 180 + Math.sin(k) : 255));
		const G = Array.from({ length: N }, (_, k) => 120 + Math.sin(0.7 * k));
		const B = Array.from({ length: N }, (_, k) => (k < 40 ? 90 + Math.cos(k) : 255));
		close(pos(R, G, B), textbookPos(R, G, B));
	});

	test("a flat channel gives a zero spread and is not divided by", () => {
		const N = 64;
		const R = Array.from({ length: N }, () => 150);
		const G = Array.from({ length: N }, (_, k) => 120 + Math.sin(k));
		const B = Array.from({ length: N }, () => 100);
		close(pos(R, G, B), textbookPos(R, G, B));
		expect(pos(R, G, B).every(Number.isFinite)).toBe(true);
	});
});

describe("pulse check spectrum", () => {
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
	test.each([40, 159, 160, 161, 320, 321, 333])("equals the textbook transform at %i samples", (N) => {
		for (let rep = 0; rep < 3; rep++) {
			const x = Array.from({ length: N }, (_, k) => Math.sin((2 * Math.PI * 1.2 * k) / OWN_PULSE_FS) + rnd());
			const a = spectrum(x);
			const b = textbook(x);
			expect(a.length).toBe(b.length);
			const peak = Math.max(...b.map(([, p]) => p));
			a.forEach(([f, p], i) => {
				expect(f).toBe(b[i][0]);
				expect(Math.abs(p - b[i][1])).toBeLessThanOrEqual(1e-9 * peak);
			});
		}
	});

	test("a window length seen before reuses its tables and still answers right", () => {
		const x = Array.from({ length: 320 }, (_, k) => Math.cos((2 * Math.PI * 0.9 * k) / OWN_PULSE_FS));
		const y = Array.from({ length: 320 }, (_, k) => Math.cos((2 * Math.PI * 2.1 * k) / OWN_PULSE_FS));
		const top = (P: Array<[number, number]>) => P.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
		expect(top(spectrum(x))).toBeCloseTo(0.875, 6);
		expect(top(spectrum(y))).toBeCloseTo(2.125, 6);
		expect(top(spectrum(x))).toBeCloseTo(0.875, 6);
	});
});
