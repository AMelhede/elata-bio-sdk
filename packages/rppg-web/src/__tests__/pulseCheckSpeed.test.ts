import { OWN_PULSE_FS, spectrum } from "../pulseCheckCore";

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
