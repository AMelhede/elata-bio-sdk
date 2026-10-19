import { PulseCheck } from "../pulseCheck";

// The frames' clock steps back: a looping video (the dataset harness loops every 75 s), or a source
// whose first frame carries a different clock from the rest. Before this rule the check kept its
// windows across the step and judged nothing new until the clock passed where it had been: with the
// clock back 30 s and the pulse gone at that moment, a rate of 66 to 70 stayed shown for 37 s and the
// verdict "measured" for 44 s (a gap forward of over a second already starts the check over).
let s = 7;
const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
function feed(check: PulseCheck, fromMs: number, seconds: number, amp: number) {
	for (let t = fromMs; t <= fromMs + seconds * 1000; t += 1000 / 30) {
		const p = amp * Math.sin((2 * Math.PI * 66 * t) / 60000);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t, [region(), region(), region()]);
	}
}

describe("PulseCheck when the frame clock steps back", () => {
	it("starts over: no rate from before the step, the pulse gone after it", () => {
		const check = new PulseCheck();
		feed(check, 0, 45, 0.01);
		expect(check.getState().verdict).toBe("measured");
		feed(check, 15000, 0.1, 0);
		expect(check.getState().bpm).toBeNull();
		feed(check, 15200, 10, 0);
		expect(check.getState().verdict).not.toBe("measured");
	});

	it("skips a frame older than the last by under a second (out of order), and the proof stands", () => {
		const check = new PulseCheck();
		feed(check, 0, 45, 0.01);
		const before = check.getState();
		expect(before.verdict).toBe("measured");
		feed(check, 45000 - 40, 0, 0.01);
		check.faceLost(45000 - 40);
		expect(check.getState()).toEqual(before);
		feed(check, 45040, 3, 0.01);
		expect(check.getState().verdict).toBe("measured");
	});

	it("proves a pulse after the step from frames after it", () => {
		const check = new PulseCheck();
		feed(check, 0, 45, 0.01);
		feed(check, 15000, 30, 0.01);
		expect(check.getState().verdict).toBe("measured");
		expect(Math.abs((check.getState().bpm as number) - 66)).toBeLessThanOrEqual(2);
	});

	it("starts over on a step back seen only by faceLost (no face either side of the step)", () => {
		const check = new PulseCheck();
		feed(check, 0, 45, 0.01);
		check.faceLost(45040);
		check.faceLost(15000);
		expect(check.getState().bpm).toBeNull();
	});

	it("rule clockBack off: the windows run across the step, as in 0.15.0-test.25", () => {
		const check = new PulseCheck({ rules: { clockBack: false } });
		feed(check, 0, 45, 0.01);
		feed(check, 15000, 10, 0);
		expect(check.getState().verdict).toBe("measured");
	});
});
