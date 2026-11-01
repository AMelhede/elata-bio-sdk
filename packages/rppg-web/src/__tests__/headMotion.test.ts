import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";
import { HEAD_MIN_SIZE, HEAD_MIN_SNR_DB, type HeadRow, headKeepsTime } from "../headMotion";

// Rule headMotion: a rate the head keeps time with (a nod, a walk's steps, or a stride's sway at half the rate) is not a pulse.
const rows = (hz: (axis: "x" | "y") => number, ampPx: number): HeadRow[] =>
	Array.from({ length: 16 * 30 }, (_, i) => {
		const t = i / 30;
		const n = Math.sin(i * 12.9898) * 0.3; // a little tracker noise
		return [t * 1000, 320 + (hz("x") ? ampPx * Math.sin(2 * Math.PI * hz("x") * t) : 0) + n, 240 + (hz("y") ? ampPx * Math.sin(2 * Math.PI * hz("y") * t) : 0) + n, 200];
	});
const end = 16 * 1000 - 1;

describe("rule headMotion", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().headMotion).toBe(true);
		expect(resolvePulseCheckRules({ headMotion: false }).headMotion).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("headMotion");
		expect([HEAD_MIN_SNR_DB, HEAD_MIN_SIZE]).toEqual([3.9, 0.003]);
	});
	it("a head bobbing at the claimed rate keeps time with it (a walk's steps)", () => {
		const bob = rows((a) => (a === "y" ? 2.0 : 0), 20); // a handheld walk: 10% of the face
		expect(headKeepsTime(bob, end, 120)).toBe(true);
	});
	it("a head swaying at half the claimed rate keeps time with it (a walk's stride)", () => {
		const sway = rows((a) => (a === "x" ? 1.0 : 0), 20);
		expect(headKeepsTime(sway, end, 120)).toBe(true);
	});
	it("judges only a moving head, on the same bar as hold still", async () => {
		const { MOVE_MAX } = await import("../pulseGuide");
		const { HEAD_MOVING_MIN } = await import("../headMotion");
		expect(HEAD_MOVING_MIN).toBe(MOVE_MAX);
		// a pulse-sized nudge at the rate (a resting heartbeat shakes the head a little) is not judged
		const nudge = rows((a) => (a === "y" ? 1.2 : 0), 1.5);
		expect(headKeepsTime(nudge, end, 72)).toBe(false);
	});
	it("a still head keeps time with nothing", () => {
		const still = rows(() => 0, 0);
		expect(headKeepsTime(still, end, 72)).toBe(false);
		expect(headKeepsTime(still, end, 120)).toBe(false);
	});
	it("a head bobbing at another rate does not take a pulse away", () => {
		const bob = rows((a) => (a === "y" ? 2.0 : 0), 20);
		expect(headKeepsTime(bob, end, 72)).toBe(false);
	});
});
