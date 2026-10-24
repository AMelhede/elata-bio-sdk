import { PulseCheck, resolvePulseCheckRules } from "../pulseCheck";

// Rule earlyPath (off unless true): Peak's early confirmation, ported unchanged.

function firstMeasuredS(check: PulseCheck, seconds = 40, bpm = 70, fps = 30): number | null {
	let s = 11;
	const rnd = () => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647 - 0.5;
	};
	let first: number | null = null;
	for (let i = 0; i < seconds * fps; i++) {
		const t = i / fps;
		const p = Math.sin((2 * Math.PI * bpm * t) / 60) + 0.3 * Math.sin((4 * Math.PI * bpm * t) / 60);
		const reg = () => ({ r: 150 * (1 + 0.002 * p + 0.001 * rnd()), g: 110 * (1 - 0.006 * p + 0.001 * rnd()), b: 90 * (1 + 0.001 * p + 0.001 * rnd()) });
		check.push(t * 1000, [reg(), reg(), reg()]);
		if (first == null && check.getState().verdict === "measured") first = t;
	}
	return first;
}

describe("rule earlyPath", () => {
	it("is off unless set to true", () => {
		expect(resolvePulseCheckRules().earlyPath).toBe(false);
		expect(resolvePulseCheckRules({ earlyPath: true }).earlyPath).toBe(true);
	});

	it("a strong, clean pulse is confirmed sooner with it, at the same rate", () => {
		const off = new PulseCheck();
		const on = new PulseCheck({ rules: { earlyPath: true } });
		const tOff = firstMeasuredS(off);
		const tOn = firstMeasuredS(on);
		expect(tOff).not.toBeNull();
		expect(tOn).not.toBeNull();
		expect(tOn as number).toBeLessThan(tOff as number);
		expect(on.getState().bpm).toBeCloseTo(70, -1);
	});
});
