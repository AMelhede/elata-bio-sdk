import { BLINK_HOLD_MS, PulseCheck, shownPulseBpm } from "../pulseCheck";

// Rule blinkGate: the blink proves a live face, not the rate, so a rate withheld moments before the blink shows once
// when the gate opens, even if the window has turned weak by then.

let seed = 5;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
/** A 72 bpm face at 30 frames a second; from `noiseFrom` s on, noise far above the pulse; one blink at `blinkAt` s. */
function run(blinkAt: number, noiseFrom: number): (number | null)[] {
	seed = 5;
	const check = new PulseCheck({ rules: { blinkGate: true, moreReadings: true } });
	const shown: (number | null)[] = [];
	for (let i = 0; i < 36 * 30; i++) {
		const t = (i * 1000) / 30;
		const p = Math.sin((2 * Math.PI * 1.2 * t) / 1000);
		const n = t >= noiseFrom * 1000 ? 1000 * rnd() : 0;
		const c = { r: 100 + 0.12 * p + 0.9 * n, g: 100 + 0.4 * p + n, b: 100 + 0.24 * p + 1.1 * n };
		const blink = t >= blinkAt * 1000 && t < blinkAt * 1000 + 200 ? 0.7 : 0.06 + 0.06 * rnd();
		check.push(t, [c, c, c], undefined, undefined, { x: 320, y: 240, faceWidth: 140, blink });
		shown.push(shownPulseBpm(check.getState()));
	}
	return shown;
}
const after = (xs: (number | null)[], s: number) => xs.slice(Math.round(s * 30)).filter((b): b is number => b != null);

describe("rule blinkGate, a rate held for the blink", () => {
	it("shows the withheld rate when the eyes blink after the window turned weak", () => {
		const shown = run(19.1, 18);
		expect(shown.slice(0, Math.round(19.1 * 30)).every((b) => b == null)).toBe(true);
		const got = after(shown, 19.1);
		expect(got.length).toBeGreaterThan(0);
		expect(Math.abs(got[0] - 72)).toBeLessThan(2);
	});
	it("does not show a withheld rate older than BLINK_HOLD_MS", () => {
		// The window stops yielding a rate a few seconds after the noise starts; the blink comes far later.
		const shown = run(31, 18);
		expect(31 - 25).toBeGreaterThan(BLINK_HOLD_MS / 1000);
		expect(shown.every((b) => b == null)).toBe(true);
	});
});
