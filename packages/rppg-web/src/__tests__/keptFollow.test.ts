import { FOLLOW_RESUME_MS, PULSE_CHECK_RULE_NAMES, PulseCheck, resolvePulseCheckRules, shownPulseBpm } from "../pulseCheck";

// Rule keptFollow (on unless false, acts with followRecent): across a break the rate proven before it stays the follow's
// anchor until the check proves again, and a blink seen before a short break still opens the refill across it.
// A clean 66 bpm pulse for 40 s, a break with no frames (the check resets), then the same pulse for 30 s.
function run(opts: { keptFollow: boolean; breakS?: number; blinkGate?: boolean; moreReadings?: boolean; resumeBpm?: number }) {
	const c = new PulseCheck({
		rules: { moreReadings: opts.moreReadings ?? false, followRecent: true, blinkGate: opts.blinkGate ?? false, keptFollow: opts.keptFollow },
	});
	let seed = 11;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
	const push = (s: number, bpm: number, blink: number | null) => {
		const p = Math.sin(((2 * Math.PI * bpm) / 60) * s) * 0.004 + rnd() * 0.004;
		const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
		c.push(s * 1000, [px, px, px], undefined, undefined, blink == null ? undefined : { x: 100, y: 100, faceWidth: 100, blink });
	};
	// Blinks only before the break.
	for (let i = 0; i < 30 * 40; i++) push(i / 30, 66, opts.blinkGate ? (i % 90 < 4 ? 0.8 : 0.1) : null);
	const back = 40 + (opts.breakS ?? 26);
	const shown: (number | null)[] = [];
	const followed: boolean[] = [];
	for (let i = 0; i < 30 * 30; i++) {
		push(back + i / 30, opts.resumeBpm ?? 66, opts.blinkGate ? 0.1 : null);
		if (i % 30 === 0) {
			const st = c.getState();
			shown.push(shownPulseBpm(st));
			followed.push(st.followBpm != null && st.verdict !== "measured");
		}
	}
	return { shown, followed };
}
const count = (xs: (number | null)[]) => xs.filter((b) => b != null).length;

describe("rule keptFollow", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().keptFollow).toBe(true);
		expect(resolvePulseCheckRules({ keptFollow: false }).keptFollow).toBe(false);
		expect(new PulseCheck().rules.keptFollow).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("keptFollow");
	});
	it("off: once the first window is full, nothing follows until the check proves again", () => {
		const off = run({ keptFollow: false });
		expect(off.followed.slice(16).some(Boolean)).toBe(false);
	});
	it("on: the rate proven before the break is followed after the window is full, near 66", () => {
		const on = run({ keptFollow: true });
		const after = on.followed.map((f, k) => (f && k >= 16 ? k : -1)).filter((k) => k >= 0);
		expect(after.length).toBeGreaterThan(0);
		for (const k of after) expect(Math.abs((on.shown[k] as number) - 66)).toBeLessThanOrEqual(6);
		expect(count(on.shown)).toBeGreaterThan(count(run({ keptFollow: false }).shown));
	});
	it("on: not for a different heart", () => {
		expect(run({ keptFollow: true, resumeBpm: 84 }).followed.some(Boolean)).toBe(false);
	});
	it("blink gate: off, no number for 14 s back without a new blink; on, the blink before a short break carries", () => {
		expect(run({ keptFollow: false, blinkGate: true }).shown.slice(0, 14).every((b) => b == null)).toBe(true);
		expect(run({ keptFollow: true, blinkGate: true }).shown.slice(0, 14).some((b) => b != null)).toBe(true);
	});
	it("blink gate: no carry across a break longer than FOLLOW_RESUME_MS", () => {
		expect(FOLLOW_RESUME_MS).toBe(45_000);
		expect(run({ keptFollow: true, blinkGate: true, breakS: 50 }).shown.slice(0, 14).every((b) => b == null)).toBe(true);
	});
});
