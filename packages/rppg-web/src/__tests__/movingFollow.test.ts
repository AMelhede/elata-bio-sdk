import { MOVING_FOLLOW_DB, PULSE_CHECK_RULE_NAMES, PulseCheck, resolvePulseCheckRules } from "../pulseCheck";

// Rule movingFollow (on unless false, acts with followRecent): while the head moves, a window follows the number shown
// last at MOVING_FOLLOW_DB under the usual bar. A clean 66 bpm pulse with a still head for 40 s, then 80 s of a weaker
// pulse with the head either swaying (0.2 Hz, far from the pulse and half of it) or still.
function run(movingFollow: boolean, sway: boolean) {
	const c = new PulseCheck({ rules: { moreReadings: false, followRecent: true, blinkGate: false, movingFollow } });
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
	const followed: number[] = [];
	for (let i = 0; i < 30 * 120; i++) {
		const t = i * (1000 / 30);
		const s = t / 1000;
		const late = s > 40;
		const p = Math.sin(((2 * Math.PI * 66) / 60) * s) * (late ? 0.0008 : 0.004) + rnd() * (late ? 0.012 : 0.004);
		const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
		const x = 100 + (late && sway ? 20 * Math.sin(2 * Math.PI * 0.2 * s) : 0);
		c.push(t, [px, px, px], undefined, undefined, { x, y: 100, faceWidth: 100 });
		if (late && i % 30 === 0) {
			const st = c.getState();
			if (st.verdict !== "measured" && st.followBpm != null) followed.push(st.followBpm);
		}
	}
	return { followed };
}

describe("rule movingFollow", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().movingFollow).toBe(true);
		expect(resolvePulseCheckRules({ movingFollow: false }).movingFollow).toBe(false);
		expect(new PulseCheck().rules.movingFollow).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("movingFollow");
		expect(MOVING_FOLLOW_DB).toBe(2);
	});
	it("on: a moving head's weaker windows follow the shown number for more seconds than off, all near 66", () => {
		const off = run(false, true).followed;
		const on = run(true, true).followed;
		expect(on.length).toBeGreaterThan(off.length);
		for (const b of on) expect(Math.abs(b - 66)).toBeLessThanOrEqual(6);
	});
	it("a still head: the same seconds on as off", () => {
		expect(run(true, false).followed).toEqual(run(false, false).followed);
	});
});
