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
	it("every rule is on unless set to false", () => {
		expect(resolvePulseCheckRules()).toEqual({
			wallBandEdge: true,
			lightFamily: true,
			faceFlicker: true,
			lightTaint: true,
			screenLight: true,
			headMotion: true,
			darkWall: true,
			clockBack: true,
			faintWall: true,
			restBand: true,
			followerClamp: false, // off by default: a weak pass (see the rule)
		});
		expect(resolvePulseCheckRules({ lightTaint: false }).lightTaint).toBe(false);
		expect(new PulseCheck().rules.lightTaint).toBe(true);
	});

	it("wallBandEdge: a light straddling the band's edge is seen only with the switch on", () => {
		// A light at 42 a minute (0.7 Hz, the band's floor) puts its strongest bin just below the
		// band, so the old in-band local-maximum search finds no line at all.
		const all = resolvePulseCheckRules();
		const off = resolvePulseCheckRules({ wallBandEdge: false });
		for (const bpm of [180, 179, 42]) expect(wallCarries(litWall(bpm), 30000, bpm, all)).toBe(true);
		expect(wallCarries(litWall(42), 30000, 42, off)).toBe(false);
	});

	it("faintWall: a lamp the wall shows only 8 dB above its noise is the lamp's with the switch on, not with it off", () => {
		// A 0.1% swing on a grey wall at 72.5 a minute stands about 8 dB above the wall's noise: under the
		// old 12 dB bar, over the 6 dB one. Measured 2026-10-20 (browser, test.26, no pulse in the face): a
		// lamp at 72.5 with a colour part on a dim wall showed as a heart rate in 74 to 100 of every 100
		// seconds, its wall line about 7 dB. A 0.07% swing (about 5 dB) stays below both bars.
		const all = resolvePulseCheckRules();
		const off = resolvePulseCheckRules({ faintWall: false });
		expect(wallCarries(litWall(72.5, 0.001), 30000, 72.5, all)).toBe(true);
		expect(wallCarries(litWall(72.5, 0.001), 30000, 72.5, off)).toBe(false);
		expect(wallCarries(litWall(72.5, 0.0007), 30000, 72.5, all)).toBe(false);
		expect(wallCarries(litWall(72.5, 0.03), 30000, 72.5, off)).toBe(true);
	});

	it("lightFamily: a light at 60 owns 180 only with the switch on", () => {
		const all = resolvePulseCheckRules();
		const off = resolvePulseCheckRules({ lightFamily: false });
		expect(wallCarries(litWall(60), 30000, 180, all)).toBe(true);
		expect(wallCarries(litWall(60), 30000, 180, off)).toBe(false);
		expect(wallCarries(litWall(60), 30000, 60, off)).toBe(true);
	});

	it("faceFlicker: under mains flicker it is the rule that keeps 180 off the screen", () => {
		// Measured 2026-10-08: with every rule on nothing shows; with faceFlicker alone off, 180
		// shows for 4 s; turning off any other single rule changes nothing on this fixture. screenLight
		// (added later) also withholds this lamp, whose smooth swing steps all three regions alike every
		// frame, so it is off here to judge the rules this test was written for. faintWall (added
		// 2026-10-20) withholds this lamp too, from the wall at 6 dB, so it is off here for the same reason;
		// with it on and both of those off, nothing shows (its own catch on this fixture).
		expect(shownSeconds({})).toEqual([]);
		expect(shownSeconds({ screenLight: false, faceFlicker: false, faintWall: false }).length).toBeGreaterThanOrEqual(3);
		expect(shownSeconds({ screenLight: false, faceFlicker: false })).toEqual([]);
		expect(shownSeconds({ faceFlicker: false })).toEqual([]);
		for (const rule of ["wallBandEdge", "lightFamily", "lightTaint"] as const)
			expect(shownSeconds({ screenLight: false, faintWall: false, [rule]: false })).toEqual([]);
	});

	it("lightTaint: seconds the wall carries build no proof, so a dip in the wall line lets far less out", () => {
		// With faceFlicker off (the wall rules alone): 19 s shown without the taint, 4 with it.
		// screenLight and faintWall off as well: each withholds this lamp on its own (see above).
		const without = shownSeconds({ screenLight: false, faceFlicker: false, faintWall: false, lightTaint: false });
		const withTaint = shownSeconds({ screenLight: false, faceFlicker: false, faintWall: false });
		expect(without.length).toBeGreaterThanOrEqual(15);
		expect(withTaint.length).toBeLessThanOrEqual(5);
	});
});
