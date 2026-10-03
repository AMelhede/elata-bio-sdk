import { ChromPulseModel, PosPulseModel } from "../rppgSignalModel";
import { MultiRoiRppgFuser, type RoiRgbSample } from "../multiRoiFusion";

// POS (Wang et al., IEEE TBME 2017): on mean-normalised channels, S1 = G - B and
// S2 = G + B - 2R, h = S1 + (sd S1 / sd S2) S2. Its plane is orthogonal to the skin's
// own colour, so a change that scales all three channels together (brightness) cannot
// reach the output. Measured on 255 real recordings through the SDK's own pipeline
// (MCD-rPPG, finger-sensor truth, frame grid on): CHROM right 29% of seconds, POS 49%;
// held-out side cameras 23% vs 38%.

const fs = 30;
const corr = (a: number[], b: number[]) => {
	const n = a.length;
	const ma = a.reduce((x, y) => x + y, 0) / n;
	const mb = b.reduce((x, y) => x + y, 0) / n;
	let sab = 0, saa = 0, sbb = 0;
	for (let i = 0; i < n; i++) {
		sab += (a[i]! - ma) * (b[i]! - mb);
		saa += (a[i]! - ma) ** 2;
		sbb += (b[i]! - mb) ** 2;
	}
	return sab / Math.sqrt(saa * sbb);
};

describe("PosPulseModel", () => {
	test("brightness changes alone produce no output", () => {
		const m = new PosPulseModel();
		const out: number[] = [];
		for (let i = 0; i < 300; i++) {
			const k = 1 + 0.05 * Math.sin((2 * Math.PI * 0.8 * i) / fs);
			out.push(m.process(180 * k, 120 * k, 100 * k));
		}
		for (const v of out.slice(20)) expect(Math.abs(v)).toBeLessThan(1e-9);
	});

	test("recovers a blood-volume pulse under a brightness swing ten times its size", () => {
		// Pulse along the blood-volume colour direction (de Haan 2014: about 0.33, 0.77, 0.53).
		const m = new PosPulseModel();
		const out: number[] = [];
		const pulse: number[] = [];
		for (let i = 0; i < 300; i++) {
			const t = i / fs;
			const p = Math.sin(2 * Math.PI * 1.2 * t);
			const k = 1 + 0.05 * Math.sin(2 * Math.PI * 0.4 * t);
			const pv = 0.005 * p;
			out.push(m.process(180 * k * (1 + 0.33 * pv), 120 * k * (1 + 0.77 * pv), 100 * k * (1 + 0.53 * pv)));
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
			const rgb = [180 * (1 + 0.33 * pv), 120 * (1 + 0.77 * pv), 100 * (1 + 0.53 * pv)] as const;
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
			const s: RoiRgbSample = { r: 180 * k * (1 + 0.33 * p), g: 120 * k * (1 + 0.77 * p), b: 100 * k * (1 + 0.53 * p) };
			out.push(fuser.pushFrame({ forehead: s, leftCheek: s, rightCheek: s }).fused);
		}
		return out;
	};

	test("uses POS by default and CHROM only when asked", () => {
		const byDefault = run(new MultiRoiRppgFuser(fs));
		const pos = run(new MultiRoiRppgFuser(fs, 8, 0.5, "pos"));
		const chrom = run(new MultiRoiRppgFuser(fs, 8, 0.5, "chrom"));
		expect(byDefault).toEqual(pos);
		expect(chrom).not.toEqual(pos);
		expect(ChromPulseModel).toBeDefined();
	});
});
