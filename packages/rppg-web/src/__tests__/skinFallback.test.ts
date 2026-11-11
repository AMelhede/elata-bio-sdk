import { SKIN_FALLBACK_SHARE, averageRgbInROIWithSkinMaskStats } from "../frameSource";
import { FACE_PATCH_COUNT, FACE_PATCH_LAYOUT_ID, facePatchesFromFrame } from "../facePatches";
import { PULSE_CHECK_RULE_NAMES, PulseCheck, resolvePulseCheckRules } from "../pulseCheck";

// Rule skinFallback (evsave TRIED FB2a, 2026-11-10): the fixed skin-colour test rejects real skin on some cameras.
const SKIN = [200, 140, 110] as const; // Cb 104, Cr 159: passes the test
const CAST = [150, 170, 200] as const; // Cb 145: fails it (a blue cast)
function frame(w: number, h: number, skinShare: number) {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		const c = i < Math.round(w * h * skinShare) ? SKIN : CAST;
		data.set([c[0], c[1], c[2], 255], i * 4);
	}
	return { data, width: w, height: h, timestampMs: 0 } as never;
}
const mean = (s: number, k: number) => (s * SKIN[k] + (1 - s) * CAST[k]) / 255;

describe("rule skinFallback", () => {
	it("is a rule, off unless true", () => {
		expect(PULSE_CHECK_RULE_NAMES).toContain("skinFallback");
		expect(resolvePulseCheckRules().skinFallback).toBe(false);
		expect(resolvePulseCheckRules({ skinFallback: true }).skinFallback).toBe(true);
	});

	it("a box mostly passing the test reads its skin pixels, with or without the rule", () => {
		const f = frame(20, 20, 0.8);
		for (const share of [0.1, SKIN_FALLBACK_SHARE]) {
			const m = averageRgbInROIWithSkinMaskStats(f, 0, 0, 20, 20, share);
			expect(m.g).toBeCloseTo(SKIN[1] / 255, 6);
			expect(m.skinRatio).toBeCloseTo(0.8, 6);
		}
	});

	it("a box the test mostly rejects: skin pixels without the rule, all pixels with it, the same skinRatio", () => {
		const f = frame(20, 20, 0.3);
		const off = averageRgbInROIWithSkinMaskStats(f, 0, 0, 20, 20);
		const on = averageRgbInROIWithSkinMaskStats(f, 0, 0, 20, 20, SKIN_FALLBACK_SHARE);
		expect(off.g).toBeCloseTo(SKIN[1] / 255, 6);
		expect(on.g).toBeCloseTo(mean(0.3, 1), 6);
		expect(on.skinRatio).toBeCloseTo(off.skinRatio, 9);
	});

	it("patch layout v2 keeps the 5-field block unchanged and appends all-pixel sums", () => {
		expect(FACE_PATCH_LAYOUT_ID).toBe("lane-subregion-115-v2");
		const W = 200, H = 200, f = frame(W, H, 0.3);
		const lm = Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + 0.4 * ((i * 37) % 100) / 100, y: 0.3 + 0.4 * ((i * 61) % 100) / 100 }));
		const p = facePatchesFromFrame(f, lm)!;
		expect(p.values.length).toBe(FACE_PATCH_COUNT * 8);
		for (let i = 0; i < FACE_PATCH_COUNT; i++) {
			const n = p.values[i * 5 + 4];
			if (!n) continue;
			const a = FACE_PATCH_COUNT * 5 + i * 3;
			expect(p.values[i * 5 + 3]).toBeLessThanOrEqual(n);
			expect(p.values[i * 5 + 1]).toBeLessThanOrEqual(p.values[a + 1]);
			expect(p.values[a + 1] % 1).toBe(0);
		}
	});

	it("the check reads a mostly rejected patch from all its pixels only with the rule, and never on a v1 patch", () => {
		const values = new Uint32Array(FACE_PATCH_COUNT * 8);
		const n = 100, sk = 30; // 30% pass
		for (let i = 0; i < FACE_PATCH_COUNT; i++) {
			values.set([sk * SKIN[0], sk * SKIN[1], sk * SKIN[2], sk, n], i * 5);
			values.set([sk * SKIN[0] + (n - sk) * CAST[0], sk * SKIN[1] + (n - sk) * CAST[1], sk * SKIN[2] + (n - sk) * CAST[2]], FACE_PATCH_COUNT * 5 + i * 3);
		}
		const read = (rules: object, v: Uint32Array) => {
			const c = new PulseCheck({ rules }) as unknown as { push: (...a: unknown[]) => void; patchRows: Array<[number, Float32Array]> };
			const rgb = { r: 0.5, g: 0.4, b: 0.3 };
			c.push(1000, [rgb, rgb, rgb], undefined, undefined, undefined, undefined, { facePatches: { box: [0, 0, 10, 10], values: v } });
			return c.patchRows[c.patchRows.length - 1][1][1];
		};
		expect(read({}, values)).toBeCloseTo(SKIN[1], 4);
		expect(read({ skinFallback: true }, values)).toBeCloseTo(mean(0.3, 1) * 255, 3);
		expect(read({ skinFallback: true }, values.slice(0, FACE_PATCH_COUNT * 5))).toBeCloseTo(SKIN[1], 4);
	});
});
