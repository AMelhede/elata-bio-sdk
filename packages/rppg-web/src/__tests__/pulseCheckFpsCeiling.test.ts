import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";
import { estimateOwnPulse } from "../pulseCheckCore";

// 16 s at 6 fps carrying a strong 150 bpm line (2.5 Hz, past 0.4 x 6 = 2.4 Hz): at this frame rate such a line is
// where a faster rate folds, so the rule withholds it. The same line at 30 fps is kept.
function frames(fps: number, hz = 2.5) {
	const out: number[][] = [];
	for (let k = 0; k <= 16 * fps; k++) {
		const t = (k * 1000) / fps, p = Math.sin(2 * Math.PI * hz * (t / 1000));
		out.push([t, 150 + 0.2 * p, 110 + 0.5 * p, 90 + 0.1 * p, 150 + 0.2 * p, 110 + 0.5 * p, 90 + 0.1 * p, 150 + 0.2 * p, 110 + 0.5 * p, 90 + 0.1 * p, NaN, NaN, NaN, NaN, NaN, NaN]);
	}
	return out as never;
}
const at = (fps: number) => (16 * fps * 1000) / fps;
describe("rule fpsCeiling", () => {
	it("is off unless true, and is a named rule", () => {
		expect(resolvePulseCheckRules().fpsCeiling).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("fpsCeiling");
	});
	it("a 150 bpm line at 6 fps is withheld; at 30 fps it is read", () => {
		const slow = (ceil: boolean) => estimateOwnPulse(frames(6), 16, at(6), undefined, undefined, true, false, false, false, null, ceil);
		expect(Math.abs((slow(false)?.bpm ?? 0) - 150)).toBeLessThan(4);
		expect(slow(true)?.bpm ?? null).toBeNull();
		const fast = estimateOwnPulse(frames(30), 16, at(30), undefined, undefined, true, false, false, false, null, true);
		expect(Math.abs((fast?.bpm ?? 0) - 150)).toBeLessThan(4);
	});
	// The margin under Nyquist (FPS_CEILING_SHARE): at 6 fps a 70 bpm pulse's 2nd harmonic sits at 140 and its 3rd folds to
	// 360 - 210 = 150, so the top of the band stacks false lines (the full gate's 7.5 fps cells read 140 against a finger's 70,
	// 2026-11-07). A 125 bpm line at 6 fps (2.08 Hz) is in that region: withheld; the same line at 10 fps is read.
	it("a 125 bpm line at 6 fps is withheld; at 10 fps it is read", () => {
		const est = (fps: number) => estimateOwnPulse(frames(fps, 125 / 60), 16, at(fps), undefined, undefined, true, false, false, false, null, true);
		expect(est(6)?.bpm ?? null).toBeNull();
		expect(Math.abs((est(10)?.bpm ?? 0) - 125)).toBeLessThan(4);
	});
});
