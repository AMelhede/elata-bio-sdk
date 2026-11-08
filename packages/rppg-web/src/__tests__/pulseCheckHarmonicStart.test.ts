import { COHERENT_START_BPM, COHERENT_START_SHARE, octaveAmbiguous, PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";

// The workout file's first 30 s (ring 123): window rates 63, 64, then 139 x3, 135 x4, then 64 x5. coherentStart alone
// passes a 64 (7 of 14 within 6 bpm, exactly its 0.5 share); half the windows sit at its double, so it is ambiguous.
const workout = [63, 64, 139, 139, 139, 135, 135, 135, 135, 64, 64, 64, 64, 64];
const shareNear = (r: number[], v: number) => r.filter((b) => Math.abs(b - v) <= COHERENT_START_BPM).length / r.length;
describe("rule harmonicStart", () => {
	it("is off unless true, and is a named rule", () => {
		expect(resolvePulseCheckRules().harmonicStart).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("harmonicStart");
	});
	it("the workout start: coherentStart lets 64 through, the octave check holds it", () => {
		expect(shareNear(workout, 64)).toBeGreaterThanOrEqual(COHERENT_START_SHARE);
		expect(octaveAmbiguous(workout, 64)).toBe(true);
	});
	it("a steady heart whose windows stay put is not ambiguous", () => {
		expect(octaveAmbiguous([72, 71, 73, 72, 70, 72, 74, 71], 72)).toBe(false);
		expect(octaveAmbiguous([128, 131, 126, 129, 130, 127], 129)).toBe(false);
	});
	it("one stray octave window in eight does not hold a number", () => {
		expect(octaveAmbiguous([72, 71, 144, 72, 70, 72, 74, 71], 72)).toBe(false);
	});
});
