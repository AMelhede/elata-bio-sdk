import { PulseCheck } from "../pulseCheck";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// A face with no pulse and the wall beside it, lit by 120 Hz mains filmed at 9 fps: the light folds
// to 3.0 Hz (180 a minute). Recorded by Peak on its fake camera (same region and wall colours this
// check is fed); Peak, which shares this rule, committed 179 on it (2026-10-07). The wall carried the
// light at 13 to 20 dB for two minutes and dipped to 2 to 4 dB for up to 5 s at a time.
const fx = require("./fixtures/mains-120hz-9fps-wall.json") as {
	rawRois: number[][];
	background: number[][];
};

describe("PulseCheck: a second the wall carries is not evidence of a pulse", () => {
	it("never shows a rate under mains flicker, through the seconds the wall line dips", () => {
		const wallAt = new Map(fx.background.map((w) => [w[0], w]));
		const check = new PulseCheck();
		const shown: number[] = [];
		let next = 1000;
		for (const r of fx.rawRois) {
			const w = wallAt.get(r[0]);
			check.push(
				r[0],
				[
					{ r: r[1], g: r[2], b: r[3] },
					{ r: r[4], g: r[5], b: r[6] },
					{ r: r[7], g: r[8], b: r[9] },
				],
				w ? { r: w[1], g: w[2], b: w[3] } : undefined,
			);
			if (r[0] >= next) {
				if (check.getState().bpm != null) shown.push(Math.round(r[0] / 1000));
				next += 1000;
			}
		}
		expect(shown).toEqual([]);
	});
});
