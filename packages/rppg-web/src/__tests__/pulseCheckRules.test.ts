import { PulseCheck, type PulseCheckRules, resolvePulseCheckRules, wallCarries } from "../pulseCheck";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// Each light rule behind its own switch, each shown to catch something with the switch on that
// gets through with it off. The fixture: a face with no pulse and the wall beside it, lit by
// 120 Hz mains filmed at 9 fps (the light folds to 180 a minute), recorded by Peak on its fake
// camera; synthetic, no person in it.
const fx = require("./fixtures/mains-120hz-9fps-wall.json") as {
	rawRois: number[][];
	background: number[][];
};

/** Seconds at which a rate was shown, replaying the fixture through a check with these rules. */
function shownSeconds(rules: PulseCheckRules): number[] {
	const wallAt = new Map(fx.background.map((w) => [w[0], w]));
	const check = new PulseCheck({ rules });
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
	return shown;
}

/** A grey wall lit by a light flickering at `bpm` a minute, 30 s at 30 fps. */
function litWall(bpm: number, amp = 0.03): [number, number, number, number][] {
	let s = 7;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
	const wall: [number, number, number, number][] = [];
	for (let t = 0; t <= 30000; t += 1000 / 30) {
		const g = 1 + amp * Math.sin((2 * Math.PI * bpm * t) / 60000);
		wall.push([t, 120 * g + noise(), 120 * g + noise(), 120 * g + noise()]);
	}
	return wall;
}

describe("PulseCheck light rules, one switch each", () => {
	it("every rule is on unless set to false, but the ones off unless set to true", () => {
		expect(resolvePulseCheckRules()).toEqual({
			screenLight: true,
			foreheadPool: false,
			coherentFusion: false,
			restBand: true,
			moreReadings: false,
			blinkGate: false,
			clearWindows: true,
			shortStreak: true,
			steadyLight: true,
			roomLight: true,
			followRecent: false,
		});
		expect(resolvePulseCheckRules({ restBand: false }).restBand).toBe(false);
		expect(new PulseCheck().rules.restBand).toBe(true);
	});





});
