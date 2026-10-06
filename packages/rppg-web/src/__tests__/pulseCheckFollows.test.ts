import { PulseCheck } from "../pulseCheck";

// Once a rate is proven, the shown number follows the newest 12 s while it stays within 4 bpm
// of the proven rate, instead of the 16 s windows that proved it. On UBFC-rPPG, whose people
// play a stressful game, every wrong second the check showed was the true rate of up to 12 s
// earlier. Scored on five sets (MCD-rPPG three cameras plus held-out side cameras, UBFC), wrong
// seconds 0/0/13/6/53 -> 0/0/9/5/43, the seconds with a number unchanged.

/** Mean |shown - true| over each second a number is shown from `fromS`, for a pulse whose
 * rate follows `bpmAt(seconds)`, phase-continuous, 30 fps, three regions. */
function meanError(bpmAt: (s: number) => number, seconds: number, fromS: number) {
	const check = new PulseCheck();
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

describe("PulseCheck shows the newest proven rate", () => {
	it("follows a heart rate rising 0.15 bpm a second", () => {
		// 70 for 25 s, then rising. Showing only the proven rate: mean error 2.5 bpm; following
		// the newest 12 s: 0.9.
		const r = meanError((s) => (s < 25 ? 70 : 70 + 0.15 * (s - 25)), 65, 25);
		expect(r.n).toBeGreaterThanOrEqual(35);
		expect(r.err).toBeLessThan(1.5);
	});

	it("still reads a steady rate as itself", () => {
		const r = meanError(() => 70, 40, 25);
		expect(r.err).toBeLessThan(1);
	});
});
