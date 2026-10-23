import { PulseCheck, clampFollower, resolvePulseCheckRules } from "../pulseCheck";

// Rule followerClamp (off by default): the shown 8 s follower line is kept between the proven rate and the current
// 16 s window (1 bpm margin). Why: a tester-like real capture (MCD 2852 at rest) showed 66 for 2 s while the finger
// read 57 to 58: the follower overshot past both slower lines. Pre-registered held-out test (lane/follower, 8 people
// at rest and after exercise, scored once): wrong seconds 2 -> 2, mean error to the finger 2.74 -> 2.64, after
// exercise 2.40 -> 2.38, seconds with a number unchanged by construction. A weak pass, so off by default.

function meanError(bpmAt: (s: number) => number, seconds: number, fromS: number, followerClamp: boolean) {
	const check = new PulseCheck({ rules: { followerClamp } });
	let seed = 11;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	let phase = 0;
	let next = fromS;
	let err = 0;
	let n = 0;
	const dt = 1 / 30;
	for (let t = 0; t <= seconds; t += dt) {
		phase += 2 * Math.PI * (bpmAt(t) / 60) * dt;
		const p = 0.01 * Math.sin(phase);
		const region = () => ({ r: 150 * (1 - 0.3 * p) + noise(), g: 120 * (1 - p) + noise(), b: 100 * (1 - 0.6 * p) + noise() });
		check.push(t * 1000, [region(), region(), region()]);
		if (t >= next) {
			const bpm = check.getState().bpm;
			if (bpm != null) {
				err += Math.abs(bpm - bpmAt(t));
				n++;
			}
			next += 1;
		}
	}
	return { err: err / n, n };
}

describe("rule followerClamp", () => {
	it("is off by default and on when asked", () => {
		expect(resolvePulseCheckRules().followerClamp).toBe(false);
		expect(resolvePulseCheckRules({ followerClamp: true }).followerClamp).toBe(true);
	});

	it("keeps the follower between the proven rate and the 16 s window, 1 bpm margin", () => {
		expect(clampFollower(65.6, 62.6, 60)).toBeCloseTo(63.6, 9); // the 2852 overshoot
		expect(clampFollower(61, 60, 62)).toBe(61); // inside: unchanged
		expect(clampFollower(58.5, 60, 62)).toBe(59); // under both: to the lower line minus 1
		expect(clampFollower(66, 62, null)).toBe(66); // no window: unchanged
	});

	it("still follows a falling heart rate (after exercise) without lag", () => {
		const fall = (s: number) => (s < 25 ? 90 : Math.max(70, 90 - 0.5 * (s - 25)));
		const off = meanError(fall, 70, 25, false);
		const on = meanError(fall, 70, 25, true);
		expect(on.n).toBe(off.n);
		expect(on.err).toBeLessThan(off.err + 0.5);
	});

	it("still follows a rising heart rate and reads a steady one as itself", () => {
		expect(meanError((s) => (s < 25 ? 70 : 70 + 0.15 * (s - 25)), 65, 25, true).err).toBeLessThan(1.5);
		expect(meanError(() => 70, 40, 25, true).err).toBeLessThan(1);
	});
});
