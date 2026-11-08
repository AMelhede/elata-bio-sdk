import { PULSE_CHECK_RULE_NAMES, resolvePulseCheckRules } from "../pulseCheck";
import { adaptivePos, peakOfSpectrum, pos, spectrum } from "../pulseCheckCore";

// A warm light (a night light): blue starved, so its channel is mostly camera noise. The pulse at 60 bpm lives in red and
// green. 16 s at 20 Hz (the check's rate), seeded. POS's fixed mix adds blue's noise in; the adaptive mix should not.
let seed = 5;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const N = 320;
const line = (x: number[]) => peakOfSpectrum(spectrum(x));
function warm() {
	const R: number[] = [], G: number[] = [], B: number[] = [];
	for (let k = 0; k < N; k++) {
		const p = Math.sin((2 * Math.PI * k) / 20);
		R.push(120 * (1 + 0.0010 * p + 0.0004 * gauss()));
		G.push(30 * (1 + 0.0030 * p + 0.0008 * gauss())); // noise per channel as 1/sqrt(level): shot noise
		B.push(6 * (1 + 0.0010 * p + 0.0018 * gauss()));
	}
	return [R, G, B] as const;
}

describe("rule adaptiveColour", () => {
	it("is off unless true, and is a named rule", () => {
		expect(resolvePulseCheckRules().adaptiveColour).toBe(false);
		expect(PULSE_CHECK_RULE_NAMES).toContain("adaptiveColour");
	});
	it("under a warm light the adaptive mix reads the 60 bpm pulse at least as cleanly as POS", () => {
		const [R, G, B] = warm();
		const a = line(adaptivePos(R, G, B)), p = line(pos(R, G, B));
		expect(Math.abs(a.bpm - 60)).toBeLessThan(3);
		expect(a.snrDb).toBeGreaterThanOrEqual(p.snrDb);
	});
	it("is blind to a brightness step all channels share", () => {
		const R: number[] = [], G: number[] = [], B: number[] = [];
		for (let k = 0; k < N; k++) { const s = k > 160 ? 1.05 : 1; R.push(100 * s); G.push(80 * s); B.push(60 * s); }
		expect(Math.max(...adaptivePos(R, G, B).map(Math.abs))).toBeLessThan(1e-9);
	});
});
