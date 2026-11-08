import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";
import { ALL_PATCHES_MIN_COUNT, estimateOwnPulse, type PatchSample, patchPulses } from "../pulseCheckCore";

// 16 s at 30 fps. The three regions carry a 100 bpm line of their own (only so the two lines can be told apart); 40 patches each carry a 72 bpm pulse well under their own
// noise (no single patch shows it), as small patches on a weak camera do. Seeded, so the run is the same every time.
let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const FPS = 30, N = 16 * FPS + 1, HZ = 72 / 60;
function make(patchCount: number) {
	const samples: Array<number[]> = [];
	const patches: PatchSample[] = [];
	for (let k = 0; k < N; k++) {
		const t = (k * 1000) / FPS;
		const q = Math.sin(2 * Math.PI * (100 / 60) * (t / 1000));
		const reg = Array.from({ length: 9 }, (_, c) => 120 + [0.1, 0.25, 0.05][c % 3] * q + 0.3 * gauss());
		samples.push([t, ...reg, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
		const p = Math.sin(2 * Math.PI * HZ * (t / 1000));
		const v = new Float32Array(patchCount * 3);
		for (let i = 0; i < patchCount; i++) {
			v[i * 3] = 150 + 0.1 * p + 1.2 * gauss();
			v[i * 3 + 1] = 110 + 0.25 * p + 1.2 * gauss();
			v[i * 3 + 2] = 90 + 0.05 * p + 1.2 * gauss();
		}
		patches.push([t, v]);
	}
	return { samples: samples as never, patches, end: ((N - 1) * 1000) / FPS };
}

describe("rule allPatches", () => {
	it("is on unless false, and is a named rule", () => {
		expect(resolvePulseCheckRules().allPatches).toBe(true);
		expect(resolvePulseCheckRules({ allPatches: false }).allPatches).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("allPatches");
	});
	it("a pulse only the patches carry together: the regions' line reads their 100, the patches' line reads 72", () => {
		const { samples, patches, end } = make(40);
		const off = estimateOwnPulse(samples, 16, end, undefined, undefined, true);
		const on = estimateOwnPulse(samples, 16, end, undefined, undefined, true, false, false, false, patches);
		expect(Math.abs((off?.bpm ?? 0) - 100)).toBeLessThan(3);
		expect(Math.abs((on?.bpm ?? 0) - 72)).toBeLessThan(3);
	});
	it("too few valid patches: the regions' line is read", () => {
		const { patches, end } = make(ALL_PATCHES_MIN_COUNT - 1);
		expect(patchPulses(patches, 0, end / 1000, 0, end, N)).toBeNull();
	});
	it("a patch without skin on more than a tenth of the frames is left out", () => {
		const { patches, end } = make(ALL_PATCHES_MIN_COUNT + 1);
		patches.forEach((p, k) => { if (k % 5 === 0) p[1][0] = Number.NaN; });
		expect(patchPulses(patches, 0, end / 1000, 0, end, N)?.length).toBe(ALL_PATCHES_MIN_COUNT);
	});
});
