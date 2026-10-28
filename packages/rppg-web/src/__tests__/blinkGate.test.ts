import { BLINK_MAX_MS, BlinkDetector, PulseCheck, resolvePulseCheckRules, shownPulseBpm } from "../pulseCheck";

// Rule blinkGate: no rate until the eyes have blinked since the face appeared; a photo does not blink.

let seed = 5;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
/** Blink scores at 30 a second for `s` seconds: an open level with jitter, plus blinks starting at the given times. */
function scores(s: number, level: number, jitter: number, blinks: { at: number; ms: number }[] = []): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i < s * 30; i++) {
		const t = (i * 1000) / 30;
		const b = blinks.find((x) => t >= x.at * 1000 && t < x.at * 1000 + x.ms);
		out.push([t, b ? 0.7 : level + jitter * 2 * rnd()]);
	}
	return out;
}
const seen = (xs: [number, number][]) => { const d = new BlinkDetector(); for (const [t, v] of xs) d.push(t, v); return d.seen; };

describe("BlinkDetector", () => {
	it("sees a real blink over open eyes", () => {
		expect(seen(scores(5, 0.06, 0.03, [{ at: 3, ms: 200 }]))).toBe(true);
	});
	it("never sees a blink on a photo, even one with half-shut eyes shaking in a hand", () => {
		expect(seen(scores(60, 0.06, 0.03))).toBe(false);
		expect(seen(scores(60, 0.4, 0.06))).toBe(false);
	});
	it("does not take eyes closed longer than a blink, or a blink before 1 s of open eyes, as a blink", () => {
		expect(seen(scores(5, 0.06, 0.03, [{ at: 3, ms: BLINK_MAX_MS + 300 }]))).toBe(false);
		expect(seen(scores(5, 0.06, 0.03, [{ at: 0.3, ms: 200 }]))).toBe(false);
	});
});

describe("rule blinkGate", () => {
	it("is off by default", () => {
		expect(resolvePulseCheckRules().blinkGate).toBe(false);
	});
	function run(gate: boolean, blinkAt: number | null) {
		const check = new PulseCheck({ rules: { blinkGate: gate } });
		const shown: (number | null)[] = [];
		const s = scores(60, 0.06, 0.03, blinkAt == null ? [] : [{ at: blinkAt, ms: 200 }]);
		for (const [t, blink] of s) {
			const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
			const c = { r: 100 + 0.12 * p, g: 100 + 0.4 * p, b: 100 + 0.24 * p };
			check.push(t, [c, c, c], undefined, undefined, { x: 320, y: 240, faceWidth: 140, blink });
			shown.push(shownPulseBpm(check.getState()));
		}
		return shown;
	}
	it("withholds every rate on a face that never blinks, and after a blink shows what the check shows without it", () => {
		const off = run(false, null);
		expect(off.some((b) => b != null)).toBe(true);
		expect(run(true, null).every((b) => b == null)).toBe(true);
		const late = run(true, 40);
		const i = 41 * 30;
		expect(late.slice(0, 40 * 30).every((b) => b == null)).toBe(true);
		expect(late.slice(i)).toEqual(run(false, 40).slice(i));
	});
});
