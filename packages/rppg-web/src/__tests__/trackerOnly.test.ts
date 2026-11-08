import { PulseCheck, shownPulseBpm } from "../pulseCheck";

// Rule tracker: the tracker alone decides, so the streak's work (its verdict, held rate and support window, the follow)
// does not run under it; run and then overridden, it cost slow devices frames (full gate 2026-11-06).
function run(tracker: boolean) {
	const check = new PulseCheck({ rules: { tracker } });
	const states = [];
	for (let i = 0; i < 60 * 30; i++) {
		const t = (i * 1000) / 30;
		const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
		const c = { r: 100 + 0.12 * p, g: 100 + 0.4 * p, b: 100 + 0.24 * p };
		check.push(t, [c, c, c]);
		if (i % 30 === 29) states.push(check.getState());
	}
	return states;
}

describe("rule tracker runs alone", () => {
	it("leaves no trace of the streak's work, and still shows the pulse", () => {
		const off = run(false);
		expect(off.some((s) => (s.heldBpm ?? null) != null && s.streak > 0)).toBe(true);
		const on = run(true);
		expect(on.every((s) => s.heldBpm == null && s.streak === 0 && s.buildingBpm == null)).toBe(true);
		const shown = on.map(shownPulseBpm).filter((b): b is number => b != null);
		expect(shown.length).toBeGreaterThan(20);
		expect(shown.every((b) => Math.abs(b - 72) <= 5)).toBe(true);
	});
});
