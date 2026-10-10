import { MultiRoiRppgFuser, type RoiRgbSample } from "../multiRoiFusion";
import { ChromPulseModel, PosPulseModel } from "../rppgSignalModel";

// POS (Wang, den Brinker, Stuijk and de Haan, IEEE TBME 2017): on window-mean-normalised
// channels, S1 = G - B and S2 = G + B - 2R, h = S1 + (sd S1 / sd S2) S2. Each normalised
// channel averages exactly 1 over the window, so each axis averages the sum of its
// weights: 0 for both POS axes, 1 for both CHROM axes (3R - 2G and 1.5R + G - 1.5B).
// The pulse is a colour change along the blood-volume direction, about (0.33, 0.77, 0.53)
// of each channel (de Haan and van Leest 2014).

const fs = 30;
const corr = (a: number[], b: number[]) => {
	const n = a.length;
	const ma = a.reduce((x, y) => x + y, 0) / n;
	const mb = b.reduce((x, y) => x + y, 0) / n;
	let sab = 0;
	let saa = 0;
	let sbb = 0;
	for (let i = 0; i < n; i++) {
		sab += (a[i]! - ma) * (b[i]! - mb);
		saa += (a[i]! - ma) ** 2;
		sbb += (b[i]! - mb) ** 2;
	}
	return sab / Math.sqrt(saa * sbb);
};
const sd = (a: number[]) => {
	const m = a.reduce((x, y) => x + y, 0) / a.length;
	return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
};
function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
}
function gauss(r: () => number) {
	let u = 0;
	while (u === 0) u = r();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

describe("PosPulseModel", () => {
	test("a brightness change alone gives no output (CHROM shares this property)", () => {
		const m = new PosPulseModel();
		const out: number[] = [];
		for (let i = 0; i < 300; i++) {
			const k = 1 + 0.05 * Math.sin((2 * Math.PI * 0.8 * i) / fs);
			out.push(m.process(180 * k, 120 * k, 100 * k));
		}
		for (const v of out.slice(20)) expect(Math.abs(v)).toBeLessThan(1e-9);
	});

	test.each([1, 2, 3])(
		"under sensor noise alone the output stays at the scale of the noise (seed %i)",
		(seed) => {
			// Noise of 0.1 level per channel is at most 0.1 / 100 = 0.001 of a channel's
			// level. S1 and S2 average zero, so the per-frame weight only scales noise-sized
			// deviations. With CHROM's arithmetic the output carries (1 - weight), and the
			// weight's wobble makes it roughly a hundred times larger.
			const m = new PosPulseModel();
			const r = rng(seed);
			const out: number[] = [];
			for (let i = 0; i < 300; i++) {
				out.push(
					m.process(
						180 + 0.1 * gauss(r),
						120 + 0.1 * gauss(r),
						100 + 0.1 * gauss(r),
					),
				);
			}
			expect(sd(out.slice(45))).toBeLessThan(5 * 0.001);
		},
	);

	test("recovers a blood-volume pulse under a brightness swing ten times its size", () => {
		const m = new PosPulseModel();
		const out: number[] = [];
		const pulse: number[] = [];
		for (let i = 0; i < 300; i++) {
			const t = i / fs;
			const p = Math.sin(2 * Math.PI * 1.2 * t);
			const k = 1 + 0.05 * Math.sin(2 * Math.PI * 0.4 * t);
			const pv = 0.005 * p;
			out.push(
				m.process(
					180 * k * (1 + 0.33 * pv),
					120 * k * (1 + 0.77 * pv),
					100 * k * (1 + 0.53 * pv),
				),
			);
			pulse.push(p);
		}
		expect(Math.abs(corr(out.slice(60), pulse.slice(60)))).toBeGreaterThan(0.95);
	});

	test("keeps the waveform the same way up as CHROM, so beat timing downstream is unchanged", () => {
		const pos = new PosPulseModel();
		const chrom = new ChromPulseModel();
		const a: number[] = [];
		const c: number[] = [];
		for (let i = 0; i < 300; i++) {
			const pv = 0.005 * Math.sin(2 * Math.PI * 1.2 * (i / fs));
			const rgb = [
				180 * (1 + 0.33 * pv),
				120 * (1 + 0.77 * pv),
				100 * (1 + 0.53 * pv),
			] as const;
			a.push(pos.process(...rgb));
			c.push(chrom.process(...rgb));
		}
		expect(corr(a.slice(60), c.slice(60))).toBeGreaterThan(0.9);
	});
});

describe("MultiRoiRppgFuser projection", () => {
	const run = (fuser: MultiRoiRppgFuser) => {
		const out: number[] = [];
		for (let i = 0; i < 200; i++) {
			const t = i / fs;
			const p = 0.004 * Math.sin(2 * Math.PI * 1.1 * t);
			const k = 1 + 0.03 * Math.sin(2 * Math.PI * 0.3 * t);
			const s: RoiRgbSample = {
				r: 180 * k * (1 + 0.33 * p),
				g: 120 * k * (1 + 0.77 * p),
				b: 100 * k * (1 + 0.53 * p),
			};
			out.push(
				fuser.pushFrame({ forehead: s, leftCheek: s, rightCheek: s }).fused,
			);
		}
		return out;
	};

	test("uses POS by default and CHROM only when asked", () => {
		const byDefault = run(new MultiRoiRppgFuser(fs));
		const pos = run(new MultiRoiRppgFuser(fs, 8, 0.5, "pos"));
		const chrom = run(new MultiRoiRppgFuser(fs, 8, 0.5, "chrom"));
		expect(byDefault).toEqual(pos);
		expect(chrom).not.toEqual(pos);
	});
});
