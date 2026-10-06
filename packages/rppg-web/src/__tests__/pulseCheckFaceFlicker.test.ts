import { PulseCheck } from "../pulseCheck";

// Three face regions at 30 fps, no wall visible (a face too close for one). `lamp`: the light
// swings in brightness at `bpm`, scaling R, G and B alike, with a tiny colour leak such as a
// rendered or compressed video adds; `pulse`: a real chromatic pulse (green drops most).
function feed(check: PulseCheck, kind: "lamp" | "pulse", bpm: number, seconds: number) {
	let s = 7;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
	const shown: number[] = [];
	let next = 1000;
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const w = Math.sin((2 * Math.PI * bpm * t) / 60000);
		const lamp = kind === "lamp" ? 1 + 0.03 * w : 1;
		const p = kind === "pulse" ? 0.008 * w : 0;
		// The leak: 2% of the lamp's swing lands on green alone, enough for POS to see a rhythm.
		const leak = kind === "lamp" ? 1 - 0.0006 * w : 1;
		const region = () => ({
			r: 150 * lamp * (1 - 0.3 * p) + noise(),
			g: 110 * lamp * leak * (1 - p) + noise(),
			b: 90 * lamp * (1 - 0.6 * p) + noise(),
		});
		check.push(t, [region(), region(), region()]);
		if (t >= next) {
			const st = check.getState();
			if (st.verdict === "measured" && st.bpm != null) shown.push(st.bpm);
			next += 1000;
		}
	}
	return shown;
}

describe("pulse check: flicker on the face itself, no wall needed", () => {
	it("never shows a lamp's rhythm, even with no wall beside the face", () => {
		const check = new PulseCheck();
		expect(feed(check, "lamp", 72, 45)).toEqual([]);
		expect(check.getState().faceFlicker).toBe(true);
	});

	it("shows a real pulse, with no wall beside the face", () => {
		const check = new PulseCheck();
		const shown = feed(check, "pulse", 72, 45);
		expect(shown.length).toBeGreaterThan(10);
		expect(shown.every((b) => Math.abs(b - 72) <= 3)).toBe(true);
		expect(check.getState().faceFlicker).toBe(false);
	});
});
