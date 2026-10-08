import { PulseCheck, type PulseCheckRules, type PulseCheckState } from "../pulseCheck";
import {
	OWN_PULSE_COLOUR_SWITCH,
	OWN_PULSE_SWAP_MIN_WALL,
	type RawRoiSample,
	estimateOwnPulse,
} from "../pulseCheckCore";

// Jest provides require; this package's tests carry no Node type declarations.
declare const require: (id: string) => unknown;

// Rule darkWall. Damaged colour (OWN_PULSE_COLOUR_SWITCH) is read as green minus the wall, which
// assumes the light on the face is on the wall too. The fixture breaks that: a generated video with
// no person, a chromatic pulse at 70 a minute on a face lit by a screen flickering at 90, beside a
// dark wall the screen does not reach (level about 0.06). 0.15.0-test.5 showed 88 to 91 on it in
// the browser for 100 s, window method greenMinusWall, colour damage about 30, while the package's
// own processor read 71 throughout. The first 41 s of what that build handed PulseCheck.push.
//
// Where the bar comes from (measured offline 2026-10-08 with a scratch copy of the check, the bar
// set by an environment variable, on the package's own estimator):
// - this video: 67 to 72 with the bar at 0.15 (its wall level 0.06);
// - 55 held-out recordings across three cameras (a public rPPG set, against its reference pulse):
//   a number for 22 people instead of 20, wrong seconds 28 of 322 instead of 26 of 333;
// - the 35 recordings of the test lead, against a chest strap: identical (366 right, 17 wrong
//   seconds);
// - wall levels of real windows where the swap fired: held-out min 0.017, p5 0.048, median 1.9;
//   the test lead's min 0.045, p1 0.30, median 1.56. No clean gap, so the bar is set where the
//   outcome on real people does not change and the known failure is excluded.
const fx = require("./fixtures/screen90-pulse70-darkwall.json") as { rows: number[][] };

/** The fixture replayed through a check with these rules: its state once a second. */
function replay(rules: PulseCheckRules): PulseCheckState[] {
	const check = new PulseCheck({ rules });
	const out: PulseCheckState[] = [];
	let next = fx.rows[0][0] + 1000;
	for (const r of fx.rows) {
		check.push(
			r[0],
			[
				{ r: r[1], g: r[2], b: r[3] },
				{ r: r[4], g: r[5], b: r[6] },
				{ r: r[7], g: r[8], b: r[9] },
			],
			{ r: r[10], g: r[11], b: r[12] },
		);
		if (r[0] >= next) {
			out.push(check.getState());
			next += 1000;
		}
	}
	return out;
}

const shown = (states: PulseCheckState[]) => states.flatMap((s) => (s.bpm != null ? [s.bpm] : []));

describe("PulseCheck rule darkWall: a screen light on the face, a dark wall beside it", () => {
	it("with the rule off, shows the screen's 90, read by green minus the wall", () => {
		const states = replay({ darkWall: false });
		const bpm = shown(states);
		expect(bpm.length).toBeGreaterThanOrEqual(15);
		expect(bpm.every((b) => b >= 88 && b <= 91)).toBe(true);
		expect(states.filter((s) => s.bpm != null).every((s) => s.windowMethod === "greenMinusWall")).toBe(true);
	});

	it("with it on (the default), shows the pulse's 70, read by colour", () => {
		const states = replay({});
		const bpm = shown(states);
		expect(bpm.length).toBeGreaterThanOrEqual(15);
		expect(bpm.every((b) => b >= 67 && b <= 73)).toBe(true);
		const judged = states.filter((s) => s.windowMethod != null);
		expect(judged.length).toBeGreaterThan(20);
		expect(judged.every((s) => s.windowMethod === "pos")).toBe(true);
		// Damaged colour all the same: it is the wall's level, not the damage, that keeps POS.
		expect(judged.every((s) => (s.windowColourDamage ?? 0) >= OWN_PULSE_COLOUR_SWITCH)).toBe(true);
		expect(judged.every((s) => s.windowWallLevel != null && s.windowWallLevel > 0.05 && s.windowWallLevel < 0.07)).toBe(true);
	});
});

// A dark camera's damaged colour, as the runner hands it over (each channel on 0..1): blue crushed
// to 4 of 255, rounded to whole units and noisy, a pulse at 66 and a room light swinging 2% at 96
// that lights the wall too. The wall's R, G and B each a third of `wallLevel`.
function darkCamera(wallLevel: number): RawRoiSample[] {
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
	const rows: RawRoiSample[] = [];
	for (let t = 0; t <= 20000; t += 1000 / 30) {
		const p = 0.008 * Math.sin((2 * Math.PI * 66 * t) / 60000);
		const light = 1 + 0.02 * Math.sin((2 * Math.PI * 96 * t) / 60000);
		const px = (v: number) => Math.round(v * light + noise()) / 255;
		const region = () => [px(150 * (1 - 0.3 * p)), px(110 * (1 - p)), px(4 * (1 - 0.6 * p))];
		const w = (wallLevel / 3) * light;
		rows.push([t, ...region(), ...region(), ...region(), w, w, w] as unknown as RawRoiSample);
	}
	return rows;
}

describe("estimateOwnPulse: green minus the wall only over a wall at OWN_PULSE_SWAP_MIN_WALL or brighter", () => {
	it("the bar is 0.15 (between the screen-light video's wall at 0.06 and where real captures change)", () => {
		expect(OWN_PULSE_SWAP_MIN_WALL).toBe(0.15);
	});

	it("keeps POS just under the bar, however damaged the colour", () => {
		const e = estimateOwnPulse(darkCamera(OWN_PULSE_SWAP_MIN_WALL * 0.95), 16);
		expect(e?.colourDamage ?? 0).toBeGreaterThanOrEqual(OWN_PULSE_COLOUR_SWITCH);
		expect(e?.wallLevel ?? 0).toBeCloseTo(OWN_PULSE_SWAP_MIN_WALL * 0.95, 2);
		expect(e?.method).toBe("pos");
	});

	it("swaps just over it, and finds the pulse", () => {
		const e = estimateOwnPulse(darkCamera(OWN_PULSE_SWAP_MIN_WALL * 1.05), 16);
		expect(e?.colourDamage ?? 0).toBeGreaterThanOrEqual(OWN_PULSE_COLOUR_SWITCH);
		expect(e?.method).toBe("greenMinusWall");
		expect(Math.abs((e?.bpm ?? 0) - 66)).toBeLessThanOrEqual(4);
	});

	it("swaps over any wall seen with the bar at 0 (the rule off)", () => {
		const e = estimateOwnPulse(darkCamera(0.06), 16, undefined, OWN_PULSE_COLOUR_SWITCH, 0);
		expect(e?.method).toBe("greenMinusWall");
	});

	it("reports no wall level when the wall was not seen throughout", () => {
		const rows = darkCamera(1).map((r, i) => (i === 400 ? ([...r.slice(0, 10), Number.NaN, Number.NaN, Number.NaN] as unknown as RawRoiSample) : r));
		const e = estimateOwnPulse(rows, 16);
		expect(e?.wallSeen).toBe(false);
		expect(e?.wallLevel).toBeNull();
		expect(e?.method).toBe("pos");
	});
});
