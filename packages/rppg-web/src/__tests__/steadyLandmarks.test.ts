import { SteadyLandmarks, STEADY_RESET_MS } from "../steadyLandmarks";

// A 20-point face 0.2 wide; jitter of 0.4% of its width on every point, as a finder gives at rest.
const face = (cx: number, cy: number, jitter: (i: number) => number) =>
	Array.from({ length: 20 }, (_, i) => ({ x: cx - 0.1 + (0.2 * i) / 19 + jitter(i), y: cy + jitter(i + 7), z: 0 }));
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);

describe("steady landmarks (One Euro on the face finder's points)", () => {
	it("at rest, cuts the frame-to-frame jump of a point to a fraction", () => {
		const r = rng(7), f = new SteadyLandmarks();
		let rawJump = 0, outJump = 0, prevRaw: number | null = null, prevOut: number | null = null;
		for (let k = 0; k < 100; k++) {
			const raw = face(0.5, 0.5, () => 0.0008 * r());
			const out = f.filter(raw, k * 100);
			if (prevRaw != null && k > 20) { rawJump += Math.abs(raw[3].x - prevRaw); outJump += Math.abs(out[3].x - prevOut!); }
			prevRaw = raw[3].x; prevOut = out[3].x;
		}
		expect(outJump / rawJump).toBeLessThan(0.4);
	});
	it("a head moving steadily is followed with little lag", () => {
		const f = new SteadyLandmarks();
		let out = face(0.3, 0.5, () => 0);
		// 0.1 face widths a second: 0.02 a second in these units, finder at 10 Hz, for 3 s.
		for (let k = 0; k <= 30; k++) out = f.filter(face(0.3 + 0.002 * k, 0.5, () => 0), k * 100);
		const lagWidths = Math.abs(out[10].x - face(0.36, 0.5, () => 0)[10].x) / 0.2;
		expect(lagWidths).toBeLessThan(0.02);
	});
	it("starts again after a gap, a new face, and never changes its input", () => {
		const f = new SteadyLandmarks();
		f.filter(face(0.3, 0.5, () => 0), 0);
		const fresh = face(0.7, 0.5, () => 0);
		const copy = JSON.stringify(fresh);
		expect(f.filter(fresh, STEADY_RESET_MS + 1)[0].x).toBeCloseTo(fresh[0].x, 9);
		expect(JSON.stringify(fresh)).toBe(copy);
		expect(f.filter(face(0.7, 0.5, () => 0).slice(0, 5), STEADY_RESET_MS + 50)).toHaveLength(5);
	});
});
