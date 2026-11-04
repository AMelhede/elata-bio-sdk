import { BRIDGE_MAX_SCALE, BRIDGE_MAX_SHIFT, FRAME_BRIDGE_MS, PULSE_CHECK_RULE_NAMES, PulseCheck, resolvePulseCheckRules, sameFaceAcrossGap, shownPulseBpm } from "../pulseCheck";

// Rule bridgeGap (on unless false): frames that stop for at most FRAME_BRIDGE_MS with the same face on both sides are a
// freeze, not a break. A clean 66 bpm pulse for 40 s at 30 fps, a freeze with no frames, then the same pulse for 12 s.
function run(opts: { bridgeGap: boolean; gapMs: number; moveAfter?: number; scaleAfter?: number; head?: boolean }) {
	const c = new PulseCheck({ rules: { bridgeGap: opts.bridgeGap } });
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
	const push = (ms: number, after: boolean) => {
		const s = ms / 1000;
		const p = Math.sin(((2 * Math.PI * 66) / 60) * s) * 0.004 + rnd() * 0.004;
		const px = { r: 0.6 - p * 0.3, g: 0.4 + p, b: 0.35 - p * 0.2 };
		const w = 100 * (after ? (opts.scaleAfter ?? 1) : 1);
		const head = opts.head === false ? undefined : { x: 300 + (after ? (opts.moveAfter ?? 0) * 100 : 0), y: 200, faceWidth: w };
		c.push(ms, [px, px, px], undefined, undefined, head);
	};
	for (let i = 0; i < 30 * 40; i++) push((i * 1000) / 30, false);
	const before = shownPulseBpm(c.getState());
	const back = 40_000 - 1000 / 30 + opts.gapMs;
	const shown: (number | null)[] = [];
	for (let i = 0; i < 30 * 12; i++) {
		push(back + (i * 1000) / 30, true);
		if (i % 30 === 29) shown.push(shownPulseBpm(c.getState()));
	}
	return { before, shown };
}
const count = (xs: (number | null)[]) => xs.filter((b) => b != null).length;
// The first 6 s after the freeze: a check that started over is still collecting (it shows again from about 7 s, by
// rule followRecent), a bridged one keeps showing.
const first6 = (r: { shown: (number | null)[] }) => count(r.shown.slice(0, 6));

describe("rule bridgeGap", () => {
	it("is on unless set to false, and is a named rule", () => {
		expect(resolvePulseCheckRules().bridgeGap).toBe(true);
		expect(resolvePulseCheckRules({ bridgeGap: false }).bridgeGap).toBe(false);
		expect(new PulseCheck().rules.bridgeGap).toBe(true);
		expect(PULSE_CHECK_RULE_NAMES).toContain("bridgeGap");
		expect(FRAME_BRIDGE_MS).toBe(2500);
	});
	it("off: a 1.4 s freeze starts the check over, no number for the next 6 s", () => {
		const off = run({ bridgeGap: false, gapMs: 1400 });
		expect(off.before).not.toBeNull();
		expect(first6(off)).toBe(0);
	});
	it("on: a 1.4 s freeze with the same face keeps the number, near 66, through the next 12 s", () => {
		const on = run({ bridgeGap: true, gapMs: 1400 });
		expect(on.before).not.toBeNull();
		expect(count(on.shown)).toBe(12);
		for (const b of on.shown) if (b != null) expect(Math.abs(b - 66)).toBeLessThanOrEqual(3);
	});
	it("on: a 2.4 s freeze is bridged, a 3 s one is not", () => {
		expect(first6(run({ bridgeGap: true, gapMs: 2400 }))).toBe(6);
		expect(first6(run({ bridgeGap: true, gapMs: 3000 }))).toBe(0);
	});
	it("on: not when the face after the gap moved or changed size, or no head is handed over", () => {
		expect(first6(run({ bridgeGap: true, gapMs: 1400, moveAfter: 0.5 }))).toBe(0);
		expect(first6(run({ bridgeGap: true, gapMs: 1400, scaleAfter: 1.3 }))).toBe(0);
		expect(first6(run({ bridgeGap: true, gapMs: 1400, head: false }))).toBe(0);
	});
	it("sameFaceAcrossGap: centre within BRIDGE_MAX_SHIFT face widths, width within BRIDGE_MAX_SCALE", () => {
		const a = { x: 0, y: 0, faceWidth: 100 };
		expect(sameFaceAcrossGap(a, { x: 100 * BRIDGE_MAX_SHIFT - 1, y: 0, faceWidth: 100 })).toBe(true);
		expect(sameFaceAcrossGap(a, { x: 100 * BRIDGE_MAX_SHIFT + 1, y: 0, faceWidth: 100 })).toBe(false);
		expect(sameFaceAcrossGap(a, { x: 0, y: 0, faceWidth: 100 * (1 + BRIDGE_MAX_SCALE) - 1 })).toBe(true);
		expect(sameFaceAcrossGap(a, { x: 0, y: 0, faceWidth: 100 * (1 + BRIDGE_MAX_SCALE) + 1 })).toBe(false);
		expect(sameFaceAcrossGap(null, a)).toBe(false);
	});
});
