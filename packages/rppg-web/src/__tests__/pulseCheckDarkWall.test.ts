import { DemoRunner } from "../demoRunner";
import type { Frame, FrameSource } from "../frameSource";
import {
	PulseCheck,
	type PulseCheckRules,
	type PulseCheckState,
	WALL_GAPS,
	WallTracker,
	wallPatchFromLandmarks,
} from "../pulseCheck";
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
// that lights the wall too. The wall's R, G and B each a third of `wallLevel` unless a colour is given.
function darkCamera(
	wallLevel: number,
	seconds = 20,
	/** The wall's colour, scaled by `wallLevel`: grey by default, each channel a third of the level. */
	colour: Rgb = { r: 1 / 3, g: 1 / 3, b: 1 / 3 },
): RawRoiSample[] {
	let s = 11;
	const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
	const rows: RawRoiSample[] = [];
	for (let t = 0; t <= seconds * 1000; t += 1000 / 30) {
		const p = 0.008 * Math.sin((2 * Math.PI * 66 * t) / 60000);
		const light = 1 + 0.02 * Math.sin((2 * Math.PI * 96 * t) / 60000);
		const px = (v: number) => Math.round(v * light + noise()) / 255;
		const region = () => [px(150 * (1 - 0.3 * p)), px(110 * (1 - p)), px(4 * (1 - 0.6 * p))];
		const w = (k: number) => wallLevel * k * light;
		rows.push([t, ...region(), ...region(), ...region(), w(colour.r), w(colour.g), w(colour.b)] as unknown as RawRoiSample);
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

type Rgb = { r: number; g: number; b: number };
const level = (c: Rgb) => c.r + c.g + c.b;
const regionsOf = (r: readonly number[]): Rgb[] => [
	{ r: r[1], g: r[2], b: r[3] },
	{ r: r[4], g: r[5], b: r[6] },
	{ r: r[7], g: r[8], b: r[9] },
];

/**
 * Rows replayed through a check, the wall handed over as DemoRunner hands it: each frame's patch
 * read (`patch(row)`: which of WALL_GAPS, and its colour as the camera read it) goes through one
 * WallTracker, and push gets the tracker's continuous wall and the patch as read. The state once a second.
 */
function throughTracker(
	rows: readonly (readonly number[])[],
	patch: (row: readonly number[]) => { gap: number; rgb: Rgb },
	rules: PulseCheckRules = {},
): PulseCheckState[] {
	const check = new PulseCheck({ rules });
	const tracker = new WallTracker();
	const out: PulseCheckState[] = [];
	let next = rows[0][0] + 1000;
	for (const r of rows) {
		const p = patch(r);
		const w = tracker.track(p.gap, p.rgb);
		check.push(r[0], regionsOf(r), w.rgb, undefined, undefined, w.raw);
		if (r[0] >= next) {
			out.push(check.getState());
			next += 1000;
		}
	}
	return out;
}

// The review of 0.15.0-test.7: DemoRunner hands the check its wall through WallTracker, which
// rescales a new patch to carry on from the old patch's level (so the wall's rhythm does not step),
// and keeps that scale for the runner's lifetime. Judged on that rescaled wall, rule darkWall saw
// the brighter patch's level after one switch to a darker patch: the screen-light fixture with its
// first second read through a patch at level 0.6 showed 22 seconds at 88.3 to 90.6 with the rule on,
// the false 90 back. The rule must judge the wall as the camera sees it.
describe("rule darkWall judges the wall the camera sees, not the tracker's rescaled wall", () => {
	const t0 = fx.rows[0][0];
	const fixtureWall = (r: readonly number[]): Rgb => ({ r: r[10], g: r[11], b: r[12] });
	// The first second through a brighter patch (level 0.6), then the fixture's own dark wall.
	const brightThenDark = (r: readonly number[]) =>
		r[0] < t0 + 1000 ? { gap: 1, rgb: { r: 0.2, g: 0.2, b: 0.2 } } : { gap: 0, rgb: fixtureWall(r) };

	it("the tracker carries the dark patch on at the bright patch's level, and hands the patch over as read", () => {
		const tracker = new WallTracker();
		tracker.track(1, { r: 0.2, g: 0.2, b: 0.2 });
		const dark = fixtureWall(fx.rows[100]);
		const w = tracker.track(0, dark);
		expect(level(w.rgb)).toBeCloseTo(0.6, 6);
		expect(w.raw).toEqual(dark);
		expect(level(w.raw)).toBeLessThan(0.07);
	});

	it("the reviewer's case: a bright patch for 1 s, then the dark wall, still shows the pulse's 70 by colour", () => {
		const states = throughTracker(fx.rows, brightThenDark);
		const bpm = shown(states);
		expect(bpm.length).toBeGreaterThanOrEqual(15);
		expect(bpm.every((b) => b >= 67 && b <= 73)).toBe(true);
		const judged = states.filter((s) => s.windowMethod != null);
		expect(judged.length).toBeGreaterThan(20);
		expect(judged.every((s) => s.windowMethod === "pos")).toBe(true);
		// A 16 s window holding the bright second: (0.6 + 15 x 0.06) / 16 = 0.094, still under the bar.
		expect(judged.every((s) => (s.windowWallLevel ?? 1) < OWN_PULSE_SWAP_MIN_WALL)).toBe(true);
	});

	it("the same case with the rule off shows the screen's 90 (the case is the failure)", () => {
		const bpm = shown(throughTracker(fx.rows, brightThenDark, { darkWall: false }));
		expect(bpm.length).toBeGreaterThanOrEqual(15);
		expect(bpm.every((b) => b >= 88 && b <= 91)).toBe(true);
	});

	it("dark to bright: a dark patch for 1 s, then a lit wall, swaps once the wall seen is lit", () => {
		const rows = darkCamera(1, 30);
		const states = throughTracker(rows, (r) =>
			r[0] < 1000
				? { gap: 1, rgb: { r: r[10] * 0.06, g: r[11] * 0.06, b: r[12] * 0.06 } }
				: { gap: 0, rgb: { r: r[10], g: r[11], b: r[12] } },
		);
		const judged = states.filter((s) => s.windowMethod != null);
		expect(judged.length).toBeGreaterThanOrEqual(10);
		expect(judged.every((s) => s.windowMethod === "greenMinusWall")).toBe(true);
		// The tracker carries the lit wall on at the dark patch's 0.06; the camera sees about 1.
		expect(judged.every((s) => (s.windowWallLevel ?? 0) > 0.9)).toBe(true);
		expect(judged.every((s) => Math.abs((s.windowBpm ?? 0) - 66) <= 4)).toBe(true);
	});
});

// Where the bar sits against walls people sit in front of. Real windows where the swap fired had wall
// levels with a median of 1.56 to 1.9 and a first percentile of 0.30 (see the head of this file), so
// a normally lit room must keep the swap: a bar raised to 0.5 or 1.0 would take it from dim rooms.
describe("rule darkWall keeps the swap for a normally lit wall", () => {
	it.each([0.45, 0.95, 1.5])("a wall at level %p swaps and finds the pulse", (lvl) => {
		const s = throughTracker(darkCamera(lvl), (r) => ({ gap: 0, rgb: { r: r[10], g: r[11], b: r[12] } }));
		const judged = s.filter((x) => x.windowMethod != null);
		expect(judged.length).toBeGreaterThanOrEqual(4);
		expect(judged.every((x) => x.windowMethod === "greenMinusWall")).toBe(true);
		expect(judged.every((x) => Math.abs((x.windowBpm ?? 0) - 66) <= 4)).toBe(true);
	});
});

// A wall is rarely grey: a warm wall under warm light has far more red than blue. Its level is R + G + B,
// so these two sit either side of the bar while three times any one channel lands on the wrong side
// of it (3 x red or green lifts the first over; 3 x green or blue drops the second under).
describe("rule darkWall reads a coloured wall's level as R + G + B", () => {
	const under: Rgb = { r: 0.08, g: 0.055, b: 0.005 }; // 0.14
	const over: Rgb = { r: 0.12, g: 0.045, b: 0.005 }; // 0.17

	it("the two walls sit either side of the bar", () => {
		expect(level(under)).toBeLessThan(OWN_PULSE_SWAP_MIN_WALL);
		expect(level(over)).toBeGreaterThan(OWN_PULSE_SWAP_MIN_WALL);
		for (const k of ["r", "g", "b"] as const) {
			expect(3 * under[k] >= OWN_PULSE_SWAP_MIN_WALL || 3 * over[k] < OWN_PULSE_SWAP_MIN_WALL).toBe(true);
		}
	});

	it.each([
		["under", "pos", under],
		["over", "greenMinusWall", over],
	] as const)("through the check, the wall %s the bar is read by %s", (_, method, wall) => {
		const rows = darkCamera(1, 20, wall);
		const s = throughTracker(rows, (r) => ({ gap: 0, rgb: { r: r[10], g: r[11], b: r[12] } }));
		const judged = s.filter((x) => x.windowMethod != null);
		expect(judged.length).toBeGreaterThanOrEqual(4);
		expect(judged.every((x) => x.windowMethod === method)).toBe(true);
		expect(judged.every((x) => Math.abs((x.windowWallLevel ?? 0) - level(wall)) < 0.005)).toBe(true);
	});

	it.each([
		["under", "pos", under],
		["over", "greenMinusWall", over],
	] as const)("offline, from a recording's wall columns alone, the wall %s the bar is read by %s", (_, method, wall) => {
		const e = estimateOwnPulse(darkCamera(1, 20, wall), 16);
		expect(e?.colourDamage ?? 0).toBeGreaterThanOrEqual(OWN_PULSE_COLOUR_SWITCH);
		expect(e?.method).toBe(method);
	});
});

// The runner's side: DemoRunner reads the wall beside the face through its WallTracker and must hand
// the check both the tracker's continuous wall and the patch as the camera read it. Frames here: a
// dark grey room (15 of 255 a channel), skin regions, and a fixed face mesh. For the first frames the
// nearest patch (WALL_GAPS[0]) is covered by skin, so the tracker reads the next one, painted a lit
// grey (150); then that one is covered and the tracker moves back to the dark nearest patch.
describe("DemoRunner hands the check the wall as the camera read it", () => {
	class Source implements FrameSource {
		onFrame: ((frame: Frame) => void) | null = null;
		async start(): Promise<void> {}
		async stop(): Promise<void> {}
	}
	const W = 160;
	const H = 120;
	const ROIS = [
		{ x: 72, y: 36, w: 16, h: 8 },
		{ x: 62, y: 60, w: 10, h: 10 },
		{ x: 88, y: 60, w: 10, h: 10 },
	];
	const mesh = Array.from({ length: 478 }, (_, i) => ({
		x: 0.35 + 0.3 * ((i % 22) / 21),
		y: 0.25 + 0.55 * (Math.floor(i / 22) / 21),
		z: 0,
	}));
	const SKIN = [181, 135, 110];
	const DARK = 15;
	const LIT = 150;
	function frame(i: number, coverFirst: boolean): Frame {
		const data = new Uint8ClampedArray(W * H * 4);
		const box = (b: { x: number; y: number; w: number; h: number }, rgb: number[]) => {
			for (let y = b.y; y < b.y + b.h; y++)
				for (let x = b.x; x < b.x + b.w; x++) data.set([rgb[0], rgb[1], rgb[2], 255], (y * W + x) * 4);
		};
		box({ x: 0, y: 0, w: W, h: H }, [DARK, DARK, DARK]);
		const near = wallPatchFromLandmarks(mesh, W, H, WALL_GAPS[0]);
		const next = wallPatchFromLandmarks(mesh, W, H, WALL_GAPS[1]);
		if (!near || !next) throw new Error("no room for the patches");
		box(next, coverFirst ? [LIT, LIT, LIT] : SKIN);
		if (coverFirst) box(near, SKIN);
		for (const r of ROIS) box(r, SKIN);
		return { data, width: W, height: H, timestampMs: i * 33, rois: ROIS, landmarks: mesh } as unknown as Frame;
	}

	it("after the patch changes, the continuous wall stays lit and the wall as read is the dark patch", async () => {
		const check = new PulseCheck();
		const push = jest.spyOn(check, "push");
		const source = new Source();
		const proc = { pushFusedSample: jest.fn(), pushSampleRgbMeta: jest.fn(), getMetrics: () => ({ bpm: null }), reset: jest.fn() };
		const runner = new DemoRunner(source, proc as never, {
			pulseChecker: check,
			sampleRate: 30,
			roiSmoothingAlpha: 0.25,
			useSkinMask: true,
			requireFace: true,
		});
		await runner.start();
		for (let i = 0; i < 20; i++) source.onFrame?.(frame(i, i < 10));
		await runner.stop();
		const calls = push.mock.calls;
		expect(calls).toHaveLength(20);
		const lit = (3 * LIT) / 255;
		const dark = (3 * DARK) / 255;
		for (const c of calls.slice(0, 10)) {
			expect(level(c[2] as Rgb)).toBeCloseTo(lit, 3);
			expect(level(c[5] as Rgb)).toBeCloseTo(lit, 3);
		}
		for (const c of calls.slice(10)) {
			expect(level(c[2] as Rgb)).toBeCloseTo(lit, 3);
			expect(level(c[5] as Rgb)).toBeCloseTo(dark, 3);
		}
	});
});
